// Run with: node --test backend-reports/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, judge, officialTrips, summary, track } from "../src/stats.js";
import { encodeTripUpdates } from "../../backend-uk/src/gtfsrt.js";

const NOW = Date.UTC(2026, 10, 28, 8, 0);
const s = (ms) => Math.round(ms / 1000);

test("the official file is read: trip, delay, cancelled, timestamp", () => {
  const pb = encodeTripUpdates(
    [
      { id: "1", tripId: "T1", startDate: "20261128", delay: 600, timestamp: s(NOW), stops: [] },
      { id: "2", tripId: "T2", startDate: "20261128", canceled: true, timestamp: s(NOW) },
      { id: "3", tripId: "T3", startDate: "20261128", timestamp: s(NOW), stops: [{ stopId: "X", delay: 120, time: s(NOW) }] },
    ],
    s(NOW),
  );
  const m = officialTrips(pb);
  assert.deepEqual(m.get("T1"), { delay: 600, canceled: false, ts: s(NOW) });
  assert.equal(m.get("T2").canceled, true);
  assert.equal(m.get("T3").delay, 120);
});

test("a shown count is confirmed by a later official delay, with how much earlier the travellers were", () => {
  const cases = track({}, { trips: { T1: { delay: { n: 3, last: NOW - 60_000 } } } }, NOW);
  // First check: the official data still says on time, from before the reports: undecided.
  let r = judge(cases, new Map([["T1", { delay: 0, canceled: false, ts: s(NOW - 10 * 60_000) }]]), NOW + 60_000);
  assert.equal(r.decided.length, 0);
  // 8 minutes later Network Rail has it 9 minutes late.
  r = judge(r.cases, new Map([["T1", { delay: 540, canceled: false, ts: s(NOW + 8 * 60_000) }]]), NOW + 9 * 60_000);
  assert.deepEqual(r.decided, [{ kind: "delay", outcome: "confirmed", shown: NOW, leadMs: 8 * 60_000 }]);
  assert.deepEqual(r.cases, {});
});

test("contradicted: on time, newer than the last report; already official: confirmed, not earlier", () => {
  const c1 = track({}, { trips: { T1: { delay: { n: 3, last: NOW } } } }, NOW);
  assert.equal(judge(c1, new Map([["T1", { delay: 30, canceled: false, ts: s(NOW + 5 * 60_000) }]]), NOW + 6 * 60_000).decided[0].outcome, "contradicted");
  const c2 = track({}, { trips: { T1: { cancel: { n: 3, last: NOW } } } }, NOW);
  const d = judge(c2, new Map([["T1", { delay: 900, canceled: false, ts: s(NOW - 60_000) }]]), NOW + 60_000).decided[0];
  assert.equal(d.outcome, "confirmed");
  assert.equal(d.leadMs, null);
});

test("incidents: confirmed by a big delay or a cancellation, never contradicted; unknown after 3 hours", () => {
  const c = track({}, { trips: { T1: { incident: { n: 5, last: NOW } } } }, NOW);
  let r = judge(c, new Map([["T1", { delay: 0, canceled: false, ts: s(NOW + 600_000) }]]), NOW + 700_000);
  assert.equal(r.decided.length, 0);
  r = judge(r.cases, new Map(), NOW + 3 * 3600_000 + 1);
  assert.equal(r.decided[0].outcome, "unknown");
  const c2 = track({}, { trips: { T1: { incident: { n: 5, last: NOW } } } }, NOW);
  assert.equal(judge(c2, new Map([["T1", { delay: null, canceled: true, ts: s(NOW + 60_000) }]]), NOW + 120_000).decided[0].outcome, "confirmed");
});

test("the 30-day summary: shares and minutes earlier, per kind", () => {
  const decided = [
    { kind: "delay", outcome: "confirmed", shown: NOW, leadMs: 6 * 60_000 },
    { kind: "delay", outcome: "confirmed", shown: NOW, leadMs: null },
    { kind: "delay", outcome: "contradicted", shown: NOW, leadMs: null },
    { kind: "delay", outcome: "unknown", shown: NOW, leadMs: null },
  ];
  const daily = aggregate({}, decided);
  assert.deepEqual(summary(daily, NOW).kinds.delay, { shown: 4, confirmed: 50, contradicted: 25, unknown: 25, earlier: 50, earlierMin: 6 });
  // Older than 30 days: left out.
  assert.deepEqual(summary(daily, NOW + 31 * 86400_000).kinds, {});
  // Nothing about phones in what's kept.
  assert.ok(!JSON.stringify(daily).includes("T1"));
});
