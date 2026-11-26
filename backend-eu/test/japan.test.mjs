import { test } from "node:test";
import assert from "node:assert/strict";
import { JP } from "../src/japan.js";
import { NZ } from "../src/newzealand.js";
import { REFUSED_REST_MS, dailyCap, emptyState, retryAfterMs, runCycle } from "../src/cycle.js";
import { tripUpdatesFeed } from "../src/encode.js";

const bucket = () => ({
  m: new Map(),
  async put(k, v) {
    this.m.set(k, v);
  },
  async get(k) {
    const v = this.m.get(k);
    return v == null ? null : { arrayBuffer: async () => v, text: async () => String(v) };
  },
});
const T0 = Date.UTC(2026, 10, 26, 3, 0, 0);
const pb = () => tripUpdatesFeed([], Math.floor(T0 / 1000)); // a header only

test("JP: Toei's public GTFS-Realtime, no key, every 15 s: GPS every 30 s, delays every 40 s, alerts every 2 minutes", async () => {
  assert.equal(JP.enabled({ JP_ENABLED: "true" }), true);
  assert.equal(JP.enabled({}), false);
  assert.equal(JP.missing({}), null);
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response(pb(), { status: 200 });
  };
  const env = { JP_ENABLED: "true", LIVE: bucket() };
  const state = emptyState();
  for (let i = 0; i < 8; i++) {
    const s = await runCycle({ state, env, fetchFn, now: T0 + i * JP.cycleMs, country: JP });
    assert.equal(s.ok, true, s.error);
  }
  const paths = seen.map((x) => x.url.replace("https://api-public.odpt.org/api/v4/gtfs/realtime/", ""));
  assert.equal(paths.filter((p) => p.endsWith("_vehicle")).length, 4);
  assert.equal(paths.filter((p) => p.endsWith("_trip_update")).length, 3);
  assert.equal(paths.filter((p) => p.endsWith("_alert")).length, 1);
  assert.equal(seen[0].init.headers["user-agent"], "Metranos-TrainRadar");
  assert.ok(env.LIVE.m.get("jp/rt/vehicle_positions.pb"));
  // 5,760 calls a day planned, a quarter of ODPT's 24,000.
  assert.equal(Math.round(86_400_000 / JP.cycleMs), 5_760);
  assert.ok(dailyCap(JP) < 24_000 / 3);
});

test("cycle: a 429 pauses even a rotating country, as long as Retry-After asks", async () => {
  const env = { JP_ENABLED: "true", LIVE: bucket() };
  const state = emptyState();
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return new Response("slow down", { status: 429, headers: { "retry-after": "600" } });
  };
  const s = await runCycle({ state, env, fetchFn, now: T0, country: JP });
  assert.equal(s.ok, false);
  assert.match(s.error, /HTTP 429/);
  assert.ok(state.nextAt >= T0 + 600_000);
  // The next turns make no call until then.
  for (let i = 1; i < 30; i++) await runCycle({ state, env, fetchFn, now: T0 + i * 15_000, country: JP });
  assert.equal(calls, 1);
  assert.equal(retryAfterMs("120"), 120_000);
  assert.equal(retryAfterMs(new Date(T0 + 60_000).toUTCString(), T0), 60_000);
  assert.equal(retryAfterMs(""), null);
});

test("cycle: a feed that refuses us (403) rests 30 minutes; the others keep their turns", async () => {
  const env = { NZ_ENABLED: "true", NZ_METLINK_API_KEY: "k1", NZ_AT_API_KEY: "k2", LIVE: bucket() };
  const state = emptyState();
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    return url.includes("servicealerts") ? new Response("no", { status: 403 }) : new Response(tripUpdatesFeed([], Math.floor(T0 / 1000)), { status: 200 });
  };
  const turn = NZ.feeds.length;
  for (let i = 0; i < turn * 3; i++) await runCycle({ state, env, fetchFn, now: T0 + i * NZ.cycleMs, country: NZ });
  // Each alerts feed was asked once in the first turn, then rested.
  assert.equal(asked.filter((u) => u.includes("servicealerts")).length, 2);
  assert.ok(asked.filter((u) => !u.includes("servicealerts")).length >= turn * 3 - 6);
  assert.equal(state.nextAt, null);
  // After the rest, asked again.
  const later = T0 + REFUSED_REST_MS + 60_000;
  for (let i = 0; i < turn; i++) await runCycle({ state, env, fetchFn, now: later + i * NZ.cycleMs, country: NZ });
  assert.equal(asked.filter((u) => u.includes("servicealerts")).length, 4);
});

test("cycle: no more than the daily cap of calls, whatever calls the cycle", async () => {
  const env = { JP_ENABLED: "true", LIVE: bucket() };
  const state = emptyState();
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return new Response(pb(), { status: 200 });
  };
  const cap = dailyCap(JP);
  // A fault: the cycle runs every second instead of every 15.
  for (let i = 0; i < cap + 50; i++) await runCycle({ state, env, fetchFn, now: T0 + i * 1000, country: JP });
  assert.equal(calls, cap);
  const s = await runCycle({ state, env, fetchFn, now: T0 + (cap + 60) * 1000, country: JP });
  assert.match(s.error, /daily call cap/);
  // A new UTC day: calls again.
  await runCycle({ state, env, fetchFn, now: Date.UTC(2026, 10, 27, 0, 0, 5), country: JP });
  assert.equal(calls, cap + 1);
});
