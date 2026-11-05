import { test } from "node:test";
import assert from "node:assert/strict";
import { GONE_MS, activeTrip, claimText, monthlyStats, parseTrips, serializeTrips, startTrip, tripsCsv, updateTrip } from "./trips.js";

// 08:00 Madrid on 5 Nov 2026 (CET = UTC+1).
const T0 = Date.UTC(2026, 10, 5, 7, 0) ;
const s = (h, m) => Date.UTC(2026, 10, 5, h - 1, m) / 1000;
const route = (delay) => ({ stops: [["Madrid", s(8, 0)], ["Zaragoza", s(9, 20)], ["Barcelona", s(10, 30)]].map(([name, t]) => ({ name, time: t + delay })) });
const info = (o) => ({ number: "03071", route: "AVE", origin: "Madrid", destination: "Barcelona", delay: 0, delay_source: "renfe", next_stop: "Zaragoza", ...o });

test("a trip from start to arrival: delay at each stop reached", () => {
  let trips = startTrip([], info({ delay: 120 }), route(120), T0);
  assert.equal(trips.length, 1);
  const t0 = trips[0];
  assert.equal(t0.label, "AVE 3071");
  assert.equal(t0.schedArr, s(10, 30), "schedule = expected − delay");
  assert.equal(startTrip(trips, info(), route(0), T0 + 1), trips, "already logging this train");
  let t = updateTrip(t0, info({ delay: 120, next_stop: "Zaragoza" }), T0 + 60_000);
  assert.deepEqual(t.stops.map((x) => x.delayMin), [2, null, null]);
  t = updateTrip(t, info({ delay: 600, next_stop: "Barcelona" }), T0 + 90 * 60_000);
  assert.deepEqual(t.stops.map((x) => x.delayMin), [2, 10, null]);
  t = updateTrip(t, info({ delay: 900, next_stop: null }), T0 + 160 * 60_000);
  assert.deepEqual(t.stops.map((x) => x.delayMin), [2, 10, 15]);
  assert.equal(t.arrDelayMin, 15);
  assert.equal(t.maxDelayMin, 15);
  assert.ok(t.endedAt);
  assert.equal(activeTrip([t], "3071"), undefined);
  assert.equal(updateTrip(t, info({ delay: 9999 }), T0 + 999), t, "a finished trip doesn't change");
});

test("a train that leaves the feed ends the trip after 15 min; GPS estimates are marked", () => {
  let [t] = startTrip([], info({ delay_source: "gps", delay: 300 }), route(300), T0);
  assert.equal(t.estimated, true);
  t = updateTrip(t, null, T0 + GONE_MS);
  assert.equal(t.endedAt, null);
  t = updateTrip(t, null, T0 + GONE_MS + 1);
  assert.ok(t.endedAt);
  assert.equal(t.arrDelayMin, null);
  assert.equal(t.lastDelayMin, 5);
});

test("stats per month, claim summary, CSV, storage", () => {
  const done = (day, d, est = false) => ({ id: day + d, day, trainNo: "1", label: "C5 1", origin: "A", destination: "B", schedArr: s(9, 0), stops: [], arrDelayMin: d, lastDelayMin: d, maxDelayMin: d, estimated: est, endedAt: 1 });
  const trips = [done("2026-10-03", 0), done("2026-11-01", 7), done("2026-11-02", 1, true), { ...done("2026-11-03", 50), endedAt: null }];
  assert.deepEqual(monthlyStats(trips), [
    { month: "2026-11", trips: 2, late: 1, known: 2, latePct: 50, avgDelay: 4 },
    { month: "2026-10", trips: 1, late: 0, known: 1, latePct: 0, avgDelay: 0 },
  ]);
  const es = claimText("es", trips[1]);
  assert.equal(es, "Tren C5 1, 01/11/2026, A → B. Llegada prevista 09:00; llegada real aproximada 09:07 (retraso 7 min, según los datos publicados por Renfe).");
  assert.match(claimText("en", trips[2]), /estimated by TrainRadar/);
  assert.doesNotMatch(es + claimText("en", trips[1]), /derecho|eligible|entitled|indemniz|compensat/i, "never states eligibility");
  const csv = tripsCsv([...trips, { ...done("2026-11-04", 2), origin: "=HYPERLINK(1)", destination: 'Sants, "Barcelona"' }]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "date,train,origin,destination,scheduled_arrival,arrival_delay_min,max_delay_min,source");
  assert.equal(lines.length, 5, "open trip left out");
  assert.equal(lines[4], `2026-11-04,C5 1,"'=HYPERLINK(1)","Sants, ""Barcelona""",09:00,2,2,renfe`);
  assert.deepEqual(parseTrips(serializeTrips(trips)), trips);
  assert.deepEqual(parseTrips(JSON.stringify(trips)).length, 4, "older bare-array format migrates");
  assert.deepEqual(parseTrips("{oops"), []);
  assert.deepEqual(parseTrips(JSON.stringify({ schema: 1, trips: [{ id: 1 }, null] })), []);
});
