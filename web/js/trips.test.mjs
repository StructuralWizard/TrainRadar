import { test } from "node:test";
import assert from "node:assert/strict";
import { GONE_MS, activeTrip, completeFromRun, needsArrival, runForTrip, claimText, monthlyStats, parseTrips, serializeTrips, startTrip, tripsCsv, updateTrip } from "./trips.js";

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
  const csv = tripsCsv([...trips, { ...done("2026-11-04", 2), origin: "=HYPERLINK(1)", destination: 'Sants, "Barcelona"' }], "en");
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "date,train,origin,destination,scheduled_arrival,arrival_delay_min,max_delay_min,source");
  assert.equal(lines.length, 5, "open trip left out");
  assert.equal(lines[4], `2026-11-04,C5 1,"'=HYPERLINK(1)","Sants, ""Barcelona""",09:00,2,2,renfe`);
  const esCsv = tripsCsv([...trips, { ...done("2026-11-04", 2), destination: "Sants; Barcelona" }], "es").trim().split("\n");
  assert.equal(esCsv[0], "fecha;tren;origen;destino;llegada_prevista;retraso_llegada_min;retraso_maximo_min;fuente");
  assert.equal(esCsv[3], "2026-11-02;C5 1;A;B;09:00;1;1;estimado");
  assert.equal(esCsv[4], '2026-11-04;C5 1;A;"Sants; Barcelona";09:00;2;2;renfe');
  assert.deepEqual(parseTrips(serializeTrips(trips)), trips);
  assert.deepEqual(parseTrips(JSON.stringify(trips)).length, 4, "older bare-array format migrates");
  assert.deepEqual(parseTrips("{oops"), []);
  assert.deepEqual(parseTrips(JSON.stringify({ schema: 1, trips: [{ id: 1 }, null] })), []);
});

test("a trip whose arrival the app missed is completed from the server's run", () => {
  const sched = (h, m) => Date.UTC(2026, 10, 8, h - 1, m) / 1000;
  const trip = {
    id: "x", day: "2026-11-08", trainNo: "19", label: "C5 19", origin: "A", destination: "C", schedArr: sched(9, 0),
    stops: [{ name: "A", sched: sched(8, 30), delayMin: 2 }, { name: "B", sched: sched(8, 45), delayMin: null }, { name: "C", sched: sched(9, 0), delayMin: null }],
    lastDelayMin: 2, maxDelayMin: 2, arrDelayMin: null, estimated: true, endedAt: Date.UTC(2026, 10, 8, 8, 30),
  };
  const now = trip.endedAt + 3_600_000;
  assert.ok(needsArrival(trip, now));
  assert.ok(!needsArrival(trip, trip.endedAt + 4 * 86_400_000), "too old: stop asking");
  const runs = [
    { date: "2026-11-07", sched_dep: sched(8, 30) - 86_400, sched_arr: sched(9, 0) - 86_400, arr_delay_min: 0, stops: [] },
    { date: "2026-11-08", sched_dep: sched(8, 30), sched_arr: sched(9, 0) + 60, arr_delay_min: 9, max_delay_min: 11, last_delay_min: 9, source_quality: "renfe_tu",
      stops: [{ stopId: "a", sched: sched(8, 30), delay: 1 }, { stopId: "b", sched: sched(8, 45), delay: 11 }, { stopId: "c", sched: sched(9, 0) + 60, delay: 9 }] },
  ];
  const run = runForTrip(trip, runs);
  assert.equal(run.date, "2026-11-08", "the same day's run, by scheduled arrival");
  const t = completeFromRun(trip, run);
  assert.equal(t.arrDelayMin, 9);
  assert.equal(t.maxDelayMin, 11);
  assert.deepEqual(t.stops.map((s) => s.delayMin), [2, 11, 9], "what the app saw is kept");
  assert.equal(t.estimated, false);
  assert.ok(t.fromServer && t.arrivalChecked && !needsArrival(t, now));
  assert.equal(runForTrip(trip, runs.slice(0, 1)), null);
  assert.equal(completeFromRun(trip, null), trip, "not there yet: ask again later");
  assert.ok(completeFromRun(trip, null, { final: true }).arrivalChecked);
});

test("one trip per train and day: found again → the same trip; old duplicates merged", () => {
  const now = Date.UTC(2026, 10, 8, 9, 0);
  const info = { number: "13911", route: "MD", origin: "Málaga", destination: "Sevilla", delay: 600, delay_source: "estimated" };
  let list = startTrip([], info, { stops: [] }, now, "auto");
  list = list.map((t) => updateTrip(t, null, now + GONE_MS + 1)); // left the feed: ended
  assert.ok(list[0].endedAt);
  list = startTrip(list, info, { stops: [] }, now + GONE_MS + 60_000, "auto");
  assert.equal(list.length, 1, "not logged twice");
  assert.equal(list[0].endedAt, null, "carried on");
  const arrived = [{ ...list[0], endedAt: now + 9e6, arrDelayMin: 5 }];
  assert.equal(startTrip(arrived, info, { stops: [] }, now + 1e7), arrived, "already arrived: left alone");
  const dup = (id, extra) => ({ id, day: "2026-11-08", trainNo: "13911", stops: [], arrDelayMin: null, endedAt: 1, startedAt: 1, ...extra });
  const merged = parseTrips(JSON.stringify({ schema: 1, trips: [dup("a", { arrDelayMin: 7 }), dup("b", { startedAt: 2 }), { ...dup("c"), trainNo: "1" }] }));
  assert.deepEqual(merged.map((t) => t.id), ["a", "c"], "the one with the arrival is kept");
});
