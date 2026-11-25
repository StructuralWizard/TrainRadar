import { test } from "node:test";
import assert from "node:assert/strict";
import { AU } from "../src/australia.js";
import { feedFor } from "../src/ireland.js";
import { runCycle, emptyState } from "../src/cycle.js";

test("NSW: Sydney Trains' GPS every other call, every feed within a turn, the quota kept", () => {
  const names = AU.feeds.map((f) => f.name);
  assert.equal(names.filter((n) => n === "vp_sydneytrains.pb").length, AU.feeds.length / 2);
  for (const n of Object.values(AU.parts).flat()) assert.ok(names.includes(n), n);
  assert.ok((86_400_000 / AU.cycleMs) < 60_000 * 0.5, "under half the daily quota");
  assert.equal(feedFor(0, AU).name, "vp_sydneytrains.pb");
  assert.equal(feedFor(1, AU).name, "tu_sydneytrains.pb");
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
