// Run with: node --test web/js/reports.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { distM, lineDistM, monthlyToken, nonceText, placeCheck, reportResolved, trainReports, trustFor } from "./reports.js";

// A straight track north from London Euston, roughly.
const line = [[-0.1337, 51.5282], [-0.1337, 51.6282]];
const trip = {
  line,
  stops: [
    { name: "London Euston", lon: -0.1337, lat: 51.5282, time: 10_000 },
    { name: "Watford Junction", lon: -0.1337, lat: 51.6282, time: 11_200 },
  ],
};
const train = { lon: -0.1337, lat: 51.57, delay: 0 };
const fix = (lon, lat, accuracy = 10) => ({ lon, lat, accuracy });

test("distances", () => {
  assert.ok(Math.abs(distM([-0.1337, 51.5282], [-0.1337, 51.6282]) - 11120) < 30);
  assert.ok(lineDistM([-0.1337 + 0.002, 51.57], line) < 150);
});

test("on the train: by its track and near where the app places it", () => {
  assert.deepEqual(placeCheck("delay", fix(-0.1337, 51.575), train, trip, 10_600), { where: "train", station: "", band: "1000", acc: "20" });
  // Off the track.
  assert.equal(placeCheck("delay", fix(-0.12, 51.575), train, trip, 10_600).error, "where");
  // On the track but far from the train.
  assert.equal(placeCheck("delay", fix(-0.1337, 51.62), train, trip, 10_600).error, "where");
});

test("at a station: near one of its stops, around its time there", () => {
  const atWatford = fix(-0.1335, 51.6283, 50);
  assert.deepEqual(placeCheck("cancel", atWatford, train, trip, 11_000), { where: "station", station: "Watford Junction", band: "300", acc: "100" });
  // Two hours early, or long after: no.
  assert.equal(placeCheck("cancel", atWatford, train, trip, 11_200 - 2 * 3600).error, "where");
  assert.equal(placeCheck("cancel", atWatford, train, trip, 11_200 + 2 * 3600).error, "where");
  // "Hasn't come" can't be sent from the train.
  assert.equal(placeCheck("cancel", fix(-0.1337, 51.575), train, trip, 10_600).error, "where");
  // A rough fix isn't enough.
  assert.equal(placeCheck("delay", fix(-0.1337, 51.575, 900), train, trip, 10_600).error, "accuracy");
});

test("the token changes each month; the nonce matches the server's", () => {
  const a = monthlyToken(null, Date.UTC(2026, 10, 28));
  assert.equal(a.month, "2026-11");
  assert.match(a.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(monthlyToken(a, Date.UTC(2026, 10, 30)), a);
  assert.notEqual(monthlyToken(a, Date.UTC(2026, 11, 1)).token, a.token);
  const b = { country: "uk", trip: "T", kind: "delay", where: "train", station: "", at: 1, token: "x" };
  assert.equal(nonceText(b), "report|uk|T|delay|train||1|x");
});

test("counts from reports.json, the worst first, only above the threshold", () => {
  const doc = { on: true, trips: { T: { delay: { n: 4, last: 1 }, incident: { n: 5, last: 2 }, cancel: { n: 2, last: 3 } } } };
  assert.deepEqual(trainReports(doc, "T").map((r) => r.kind), ["incident", "delay"]);
  assert.deepEqual(trainReports(doc, "U"), []);
  assert.deepEqual(trainReports(null, "T"), []);
});

test("official data newer than the reports can resolve them; accidents never", () => {
  const last = 1_000_000_000_000; // ms
  const after = last / 1000 + 120;
  const delay = { kind: "delay", n: 3, last };
  assert.equal(reportResolved(delay, { delay: 60, official_at: after }), true);
  assert.equal(reportResolved(delay, { delay: 600, official_at: after }), false);
  // Official data from before the reports says nothing about them.
  assert.equal(reportResolved(delay, { delay: 0, official_at: last / 1000 - 60 }), false);
  assert.equal(reportResolved(delay, { delay: 0 }), false);
  assert.equal(reportResolved(delay, { delay: 0, official_at: after, timetable_only: true }), false);
  const cancel = { kind: "cancel", n: 3, last };
  assert.equal(reportResolved(cancel, { delay: 900, official_at: after }), true);
  assert.equal(reportResolved(cancel, { canceled: true, official_at: after }), false);
  assert.equal(reportResolved({ kind: "incident", n: 5, last }, { delay: 0, official_at: after }), false);
});

test("the trust line needs enough cases, and says 'earlier' only when it often was", () => {
  const stats = { kinds: { delay: { shown: 40, confirmed: 82, earlier: 60, earlierMin: 6 }, cancel: { shown: 5, confirmed: 100 }, incident: { shown: 30, confirmed: 40, earlier: 10, earlierMin: 3 } } };
  assert.deepEqual(trustFor(stats, "delay"), { confirmed: 82, earlierMin: 6 });
  assert.equal(trustFor(stats, "cancel"), null);
  assert.deepEqual(trustFor(stats, "incident"), { confirmed: 40, earlierMin: null });
  assert.equal(trustFor(null, "delay"), null);
});
