import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_KEY, liveCount, writeWorld } from "../src/world.js";
import worker from "../src/index.js";

const bucket = (init = {}) => ({
  m: new Map(Object.entries(init)),
  async put(k, v) {
    this.m.set(k, v);
  },
  async get(k) {
    const v = this.m.get(k);
    return v == null ? null : { text: async () => String(v), arrayBuffer: async () => v };
  },
});
const NOW = Date.UTC(2026, 10, 26, 8, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

test("world: live counts from the status files already in the bucket; stale ones count as none", async () => {
  const LIVE = bucket({
    "jp/rt/status.json": JSON.stringify({ updatedAt: iso(NOW - 30_000), ok: true, feeds: { "vehicle_positions.pb": { kept: 90 }, "trip_updates.pb": { kept: 88 }, "alerts.pb": { kept: 2 } } }),
    "nz/rt/status.json": JSON.stringify({ updatedAt: iso(NOW - 3_600_000), ok: true, feeds: { "vp_wlg.pb": { kept: 20 } } }),
    "rt/status.json": JSON.stringify({ generatedAt: iso(NOW - 20_000), feeds: { vehicle_positions: { ok: true } } }),
  });
  const doc = await writeWorld({ LIVE }, NOW);
  assert.deepEqual(doc.countries.jp, { live: 90, ok: true, updatedAt: iso(NOW - 30_000) });
  assert.equal(doc.countries.nz.live, null);
  assert.equal(doc.countries.nz.ok, false);
  assert.equal(doc.countries.es.live, null);
  assert.equal(doc.countries.es.ok, true);
  assert.equal(doc.countries.fr, undefined);
  assert.deepEqual(JSON.parse(LIVE.m.get(WORLD_KEY)), doc);
  assert.equal(liveCount({ feeds: { "tu_au.pb": { entities: 7 } } }), 7);
});

test("world: written by the minute cron every ten minutes only", async () => {
  const env = { LIVE: bucket(), FEED_INGEST: { idFromName: () => 1, get: () => ({ fetch: async () => new Response("ok") }) } };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 26, 8, 7) }, env);
  assert.equal(env.LIVE.m.has(WORLD_KEY), false);
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 26, 8, 10) }, env);
  assert.equal(env.LIVE.m.has(WORLD_KEY), true);
});
