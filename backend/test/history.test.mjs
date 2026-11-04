import { test } from "node:test";
import assert from "node:assert/strict";
import { historyApi, parseDays } from "../src/api.js";
import {
  addDays,
  addMonths,
  aggregateDay,
  archiveKey,
  archiveMonth,
  backupDay,
  backupKey,
  dailyJob,
  dbStats,
  gunzip,
  madridDate,
  retire,
  writeTrips,
} from "../src/history.js";
import worker from "../src/index.js";
import { fakeD1, fakeR2 } from "./fakes.mjs";

function trip(date, id, over = {}) {
  return {
    service_date: date,
    trip_id: id,
    train_no: "19",
    line: "10-C5",
    product: "CERCANIAS",
    origin_id: "A",
    dest_id: "C",
    sched_dep: 1000,
    sched_arr: 2000,
    arr_delay_min: 0,
    max_delay_min: 0,
    last_delay_min: 0,
    cancelled: 0,
    stops_json: JSON.stringify([["A", 1000, 0, 1], ["B", 1500, null, 0], ["C", 2000, 0, 1]]),
    source_quality: "renfe_tu",
    ...over,
  };
}

test("dates in Madrid", () => {
  assert.equal(madridDate(Date.UTC(2026, 10, 1, 23, 30)), "2026-11-02", "00:30 CET");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addMonths("2026-01", -12), "2025-01");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("finished runs are stored; the same run again replaces it", async () => {
  const db = fakeD1();
  assert.equal(await writeTrips(db, [trip("2026-11-01", "t1"), trip("2026-11-01", "t2")]), 2);
  await writeTrips(db, [trip("2026-11-01", "t1", { arr_delay_min: 7 })]);
  const rows = db.raw.prepare("SELECT trip_id, arr_delay_min FROM trips ORDER BY trip_id").all();
  assert.deepEqual(rows.map((r) => [r.trip_id, r.arr_delay_min]), [["t1", 7], ["t2", 0]]);
});

test("daily aggregates per line and station", async () => {
  const db = fakeD1();
  const d = "2026-11-01";
  await writeTrips(db, [
    trip(d, "a", { arr_delay_min: 0 }),
    trip(d, "b", { arr_delay_min: 6, stops_json: JSON.stringify([["A", 1, 2, 0], ["C", 2, 6, 0]]) }),
    trip(d, "c", { arr_delay_min: null, last_delay_min: 20 }), // arrival unseen: last delay
    trip(d, "d", { cancelled: 1, arr_delay_min: null }),
    trip(d, "e", { line: "60000-71801", product: "AVE", arr_delay_min: 3 }),
  ]);
  const agg = await aggregateDay(db, d);
  assert.deepEqual(agg, { lines: 2, stations: 2, trips: 5 }, "B never has a known delay");
  const c5 = db.raw.prepare("SELECT * FROM line_daily WHERE line = '10-C5'").get();
  assert.equal(c5.trips, 4);
  assert.equal(c5.cancelled, 1);
  assert.equal(c5.on_time, 1);
  assert.equal(c5.late_5, 2);
  assert.equal(c5.late_15, 1);
  assert.equal(c5.median_delay, 6);
  const sC = db.raw.prepare("SELECT * FROM station_daily WHERE stop_id = 'C'").get();
  assert.equal(sC.calls, 4, "a, b, c, e (not the cancelled one)");
  // Idempotent.
  await aggregateDay(db, d);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM line_daily").get().n, 2);
});

test("backups, monthly archive in parts, retention after 12 months", async () => {
  const db = fakeD1();
  const archive = fakeR2();
  // 2025-10: 31 days × 40 runs with ~5 KB of stop data each (≈ 6 MB of gzip).
  const noise = (i) => Array.from({ length: 120 }, (_, k) => [`S${(i * 7919 + k * 104729) % 99991}`, i * k, (i + k) % 37, k % 2]);
  for (const date of Array.from({ length: 31 }, (_, i) => addDays("2025-10-01", i))) {
    await writeTrips(db, Array.from({ length: 40 }, (_, i) => trip(date, `t${i}`, { stops_json: JSON.stringify(noise(i + date.length * Number(date.slice(8)))) })));
  }
  await writeTrips(db, [trip("2026-11-01", "recent")]);
  assert.equal(await backupDay(db, archive, "2025-10-05"), 40);
  assert.ok(archive.objects.has(backupKey("2025-10-05")));

  const rows = await archiveMonth(db, archive, "2025-10");
  assert.equal(rows, 31 * 40);
  const file = archive.objects.get(archiveKey("2025-10")).body;
  const lines = (await gunzip(file)).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 31 * 40, "concatenated gzip members read as one file");
  assert.equal(new Set(lines.map((l) => `${l.service_date}|${l.trip_id}`)).size, 31 * 40);

  // Nov 2026: months before Nov 2025 leave D1 (archived first).
  const retired = await retire(db, archive, "2026-11-04");
  assert.deepEqual(retired, ["2025-10"]);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM trips").get().n, 1);
  const st = await dbStats(db);
  assert.equal(st.trips, 1);
  assert.ok(st.bytes > 0);
});

test("daily job: last two days aggregated and backed up, last month archived once", async () => {
  const db = fakeD1();
  const archive = fakeR2();
  await writeTrips(db, [trip("2026-11-02", "x"), trip("2026-11-03", "y"), trip("2026-10-15", "z")]);
  const now = Date.parse("2026-11-04T02:40:00Z");
  const out = await dailyJob(db, archive, now);
  assert.deepEqual(out.days.map((d) => d.date), ["2026-11-02", "2026-11-03"]);
  assert.equal(out.archived.month, "2026-10");
  assert.ok(archive.objects.has(archiveKey("2026-10")));
  const again = await dailyJob(db, archive, now);
  assert.equal(again.archived, undefined, "archived once");
});

test("API: lines, line, station, train; days limits; bad ids", async () => {
  const db = fakeD1();
  const now = Date.parse("2026-11-04T10:00:00Z");
  await writeTrips(db, [
    trip("2026-11-03", "a", { train_no: "19", arr_delay_min: 4 }),
    trip("2026-11-02", "b", { train_no: "19", arr_delay_min: 12 }),
    trip("2026-10-01", "old", { train_no: "19" }),
  ]);
  await aggregateDay(db, "2026-11-03");
  await aggregateDay(db, "2026-11-02");
  const get = async (path) => {
    const r = await historyApi(new URL(`https://api.example${path}`), db, now);
    return { status: r.status, cache: r.headers.get("Cache-Control"), body: await r.json() };
  };
  const lines = await get("/v1/history/lines");
  assert.equal(lines.status, 200);
  assert.equal(lines.cache, "public, max-age=3600");
  assert.deepEqual([lines.body.from, lines.body.to], ["2026-10-28", "2026-11-03"]);
  assert.equal(lines.body.lines[0].trips, 2);
  const line = await get("/v1/history/line/10-C5?days=1");
  assert.deepEqual(line.body.days.map((d) => d.date), ["2026-11-03"]);
  const train = await get("/v1/history/train/00019?days=7");
  assert.equal(train.body.trainNo, "19");
  assert.deepEqual(train.body.runs.map((r) => r.arr_delay_min), [12, 4]);
  assert.equal(train.body.runs[0].stops[1].delay, null);
  assert.equal(train.body.runs[0].stops[0].estimated, true);
  assert.equal((await get("/v1/history/train/19?days=365")).body.runs.length, 3);
  const station = await get("/v1/history/station/C");
  assert.equal(station.body.days.length, 2);
  for (const bad of ["?days=0", "?days=366", "?days=abc", "?days=1e3"]) {
    assert.equal((await get(`/v1/history/lines${bad}`)).status, 400, bad);
  }
  assert.equal((await get("/v1/history/train/1%27%3B--")).status, 400);
  assert.equal((await get("/v1/history/nope")).status, 404);
  assert.equal((await get("/v1/history/line/a/b")).status, 404);
  assert.equal((await historyApi(new URL("https://x/v1/history/lines"), undefined)).status, 503);
  assert.equal(parseDays(null), 7);
});

test("Worker: API with CORS; summary and recorder status served", async () => {
  const db = fakeD1();
  const live = fakeR2();
  await live.put("rt/summary.json", "[]", { httpMetadata: { contentType: "application/json" } });
  const env = { HISTORY: db, LIVE: { get: async (k) => {
    const o = await live.get(k);
    return o && { body: new TextEncoder().encode(await o.text()), httpEtag: '"e"', customMetadata: {}, writeHttpMetadata() {} };
  } }, ALLOWED_ORIGINS: "https://trainradar.pages.dev" };
  const res = await worker.fetch(
    new Request("https://api.example/v1/history/lines?days=3", { headers: { Origin: "https://trainradar.pages.dev" } }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://trainradar.pages.dev");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual((await res.json()).lines, []);
  assert.equal((await worker.fetch(new Request("https://x/rt/summary.json"), env)).status, 200);
  assert.equal((await worker.fetch(new Request("https://x/rt/recorder.json"), env)).status, 503, "not written yet");
});

test("cron: daily job only on the daily schedule, recorder only when enabled", async () => {
  const calls = [];
  const ns = (name) => ({ idFromName: () => name, get: () => ({ fetch: async (u) => calls.push(`${name} ${new URL(u).pathname}`) }) });
  const ctx = { waitUntil: (p) => p };
  const env = { POLLER: ns("poller"), RECORDER: ns("recorder"), RECORDER_ENABLED: "false" };
  await worker.scheduled({ cron: "* * * * *" }, env, ctx);
  assert.deepEqual(calls, ["poller /ensure"]);
  calls.length = 0;
  env.RECORDER_ENABLED = "true";
  await worker.scheduled({ cron: "* * * * *" }, env, ctx);
  await worker.scheduled({ cron: "40 2 * * *" }, env, ctx);
  assert.deepEqual(calls, ["poller /ensure", "recorder /ensure", "recorder /daily"]);
});
