// The recorder on the real engine (web/pkg) and the demo data (demo/data,
// demo/rt from tools/demo-gtfs.py + the fixture example, as in CI). Skips
// when either is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { RecorderCore, STALE_FEED_MS, manifestKey } from "../src/recorder.js";
import { Engine, initSync } from "../../web/pkg/engine.js";
import wasmModule from "../../web/pkg/engine_bg.wasm";
import { fakeD1, fakeR2 } from "./fakes.mjs";

const root = new URL("../../", import.meta.url);
const DATA = new URL(process.env.DEMO_DATA || "demo/data/", root);
const RT = new URL(process.env.DEMO_RT || "demo/rt/", root);
const skip = !wasmModule || !existsSync(DATA) || !existsSync(RT) ? "needs web/pkg and demo/{data,rt}" : false;
if (skip && process.env.REQUIRE_ENGINE) throw new Error(`recorder tests can't run: ${skip}`);

function makeEngine() {
  initSync({ module: wasmModule });
  return new Engine();
}

/** Fetch for the reference data, from demo/data, gzipped like the deploy. */
async function fetchData(url) {
  const name = new URL(url).pathname.split("/").pop();
  const file = new URL(name, DATA);
  if (!existsSync(file)) return new Response("nope", { status: 404 });
  let body = readFileSync(file);
  if (name.endsWith(".bin")) {
    body = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  }
  return new Response(body);
}

function memoryStorage() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), put: async (k, v) => m.set(k, v) };
}

/** The poller's bucket: every fixture feed, fetched at `fetchedAt`. */
async function liveBucket(fetchedAt) {
  const live = fakeR2();
  const feeds = {};
  for (const f of readdirSync(RT).filter((f) => f.endsWith(".pb"))) {
    await live.put(`rt/${f}`, readFileSync(new URL(f, RT)));
    feeds[f] = { ok: true, fetchedAt: new Date(fetchedAt).toISOString(), renfeLastModified: "Wed, 04 Nov 2026 10:00:00 GMT" };
  }
  await live.put("rt/status.json", JSON.stringify({ pollerEnabled: true, feeds }));
  return live;
}

test("records demo trains: summary, runs in progress, finished runs in D1, restart", { skip }, async () => {
  const now = statSync(new URL("vehicle_positions.pb", RT)).mtimeMs + 30_000;
  const live = await liveBucket(now - 5_000);
  const db = fakeD1();
  const storage = memoryStorage();
  const env = { RECORDER_ENABLED: "true", REFDATA_BASE: "https://site.example/data", LIVE: live, HISTORY: db };
  const core = new RecorderCore({ makeEngine, storage, env, fetchFn: fetchData });

  const first = await core.cycle(now);
  assert.equal(first.error, null);
  assert.ok(first.res.freshFeeds >= 4, JSON.stringify(first.res));
  assert.ok(first.res.active > 0, "runs in progress");
  const summary = JSON.parse(await (await live.get("rt/summary.json")).text());
  assert.ok(summary.length > 0);
  for (const s of summary) {
    assert.ok(["running", "stopped", "cancelled"].includes(s.status));
    assert.equal(typeof s.updatedAt, "number");
  }
  assert.ok(summary.some((s) => s.product === "CERCANIAS" && /^\d+-C/.test(s.line)), JSON.stringify(summary[0]));
  const status = JSON.parse(await (await live.get("rt/recorder.json")).text());
  assert.equal(status.ok, true);

  // Restart: a new object restores the runs in progress.
  await core.save();
  const again = new RecorderCore({ makeEngine, storage, env, fetchFn: fetchData });
  await again.ensureEngine(now);
  assert.equal(again.engine.recorderActive(), first.res.active);

  // The poller stops: feeds go stale, trains are dropped and, 3 h later,
  // every run is finished and stored.
  const later = now + STALE_FEED_MS + 60_000;
  const r1 = await again.cycle(later);
  assert.equal(r1.res.freshFeeds, 0);
  const r2 = await again.cycle(now + 4 * 3_600_000);
  assert.equal(r2.error, null);
  assert.equal(r2.res.active, 0);
  const rows = db.raw.prepare("SELECT * FROM trips").all();
  assert.equal(rows.length, first.res.active);
  for (const r of rows) {
    assert.match(r.service_date, /^\d{4}-\d\d-\d\d$/);
    assert.ok(["renfe_tu", "gps_estimate"].includes(r.source_quality));
    assert.ok(Array.isArray(JSON.parse(r.stops_json)));
  }
});

test("reference data is reloaded only when the deployed manifest changes", { skip }, async () => {
  const m = JSON.parse(readFileSync(new URL("manifest.json", DATA)));
  assert.equal(manifestKey(m), manifestKey(structuredClone(m)));
  const changed = structuredClone(m);
  changed.regions[0].file = "tt-ld.other.bin";
  assert.notEqual(manifestKey(m), manifestKey(changed));
});

test("disabled or broken: the error is reported, nothing thrown", { skip }, async () => {
  const live = fakeR2(); // no status.json yet
  const core = new RecorderCore({
    makeEngine,
    storage: memoryStorage(),
    env: { RECORDER_ENABLED: "true", REFDATA_BASE: "https://site.example/data/", LIVE: live },
    fetchFn: fetchData,
  });
  const r = await core.cycle(Date.now());
  assert.match(r.error, /status\.json/);
  const doc = JSON.parse(await (await live.get("rt/recorder.json")).text());
  assert.equal(doc.ok, false);
});
