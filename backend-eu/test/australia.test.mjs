import { test } from "node:test";
import assert from "node:assert/strict";
import { AU } from "../src/australia.js";
import { feedFor } from "../src/ireland.js";
import { runCycle, emptyState } from "../src/cycle.js";

test("AU: the states in turn; Sydney Trains' GPS every other NSW call; every feed within a turn; quotas kept", () => {
  const names = AU.feeds.map((f) => f.name);
  const nsw = AU.feeds.filter((f) => f.state === "nsw");
  const vic = AU.feeds.filter((f) => f.state === "vic");
  assert.equal(nsw.length, vic.length);
  assert.equal(nsw.filter((f) => f.name === "vp_sydneytrains.pb").length, nsw.length / 2);
  for (const n of Object.values(AU.parts).flat()) assert.ok(names.includes(n), n);
  const perDay = 86_400_000 / AU.cycleMs;
  assert.ok(perDay / 2 < 60_000 * 0.5, "NSW: under half the daily quota");
  // Victoria: 24 calls a minute per feed at most.
  for (const f of new Set(vic)) {
    const perMin = (vic.filter((x) => x === f).length / AU.feeds.length) * (60_000 / AU.cycleMs);
    assert.ok(perMin <= 24, `${f.name}: ${perMin} a minute`);
  }
  assert.equal(feedFor(0, AU).name, "vp_sydneytrains.pb");
  assert.equal(feedFor(1, AU).name, "vp_vic_metro.pb");
  assert.equal(feedFor(2, AU).name, "tu_sydneytrains.pb");
});

test("VIC: the key in KeyID only, on Victoria's turns, and only when AU_VIC_LIVE is on", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response("no", { status: 401 });
  };
  const bucket = { put: async () => {}, get: async () => null };
  const base = { AU_ENABLED: "true", AU_NSW_API_KEY: "nsw-k", AU_VIC_API_KEY: "vic-k", LIVE: bucket };
  // Off: Victoria's turn goes to Sydney Trains' GPS.
  await runCycle({ state: { ...emptyState(), minute: 1 }, env: base, fetchFn, now: 0, country: AU });
  assert.equal(seen[0].url, "https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/sydneytrains");
  assert.equal(seen[0].init.headers.KeyID, undefined);
  // On.
  const c = await runCycle({ state: { ...emptyState(), minute: 1 }, env: { ...base, AU_VIC_LIVE: "true" }, fetchFn, now: 0, country: AU });
  assert.equal(seen[1].url, "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/vehicle-positions");
  assert.equal(seen[1].init.headers.KeyID, "vic-k");
  assert.equal(seen[1].init.headers.authorization, undefined);
  assert.ok(!seen[1].url.includes("vic-k") && !c.error.includes("vic-k"));
});

test("NSW: the key in the Authorization header only, never in the URL or an error", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response("no", { status: 403 });
  };
  const env = { AU_ENABLED: "true", AU_NSW_API_KEY: "secret-k", LIVE: { put: async () => {}, get: async () => null } };
  assert.equal(AU.enabled(env), true);
  const c = await runCycle({ state: emptyState(), env, fetchFn, now: 0, country: AU });
  assert.equal(seen[0].url, "https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/sydneytrains");
  assert.equal(seen[0].init.headers.authorization, "apikey secret-k");
  assert.ok(!c.error.includes("secret-k"));
});
