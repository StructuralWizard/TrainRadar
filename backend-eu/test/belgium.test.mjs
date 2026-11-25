import { test } from "node:test";
import assert from "node:assert/strict";
import { BE } from "../src/belgium.js";
import { feedFor } from "../src/ireland.js";
import { runCycle, emptyState } from "../src/cycle.js";

test("Belgium: trip updates every cycle, alerts every tenth", () => {
  assert.deepEqual([0, 1, 9, 10].map((n) => feedFor(n, BE).name), ["alerts.pb", "trip_updates.pb", "trip_updates.pb", "alerts.pb"]);
});

test("Belgium: the key in its header only, never in the URL or an error", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response("no", { status: 401 });
  };
  const env = { BE_ENABLED: "true", BE_SNCB_KEY: "secret-k", LIVE: { put: async () => {}, get: async () => null } };
  assert.equal(BE.enabled(env), true);
  assert.equal(BE.enabled({ BE_ENABLED: "true" }), false);
  const c = await runCycle({ state: { ...emptyState(), minute: 1 }, env, fetchFn, now: 0, country: BE });
  assert.equal(seen[0].url, "https://api-management-opendata-production.azure-api.net/api/gtfs/feed/nmbssncb/rt/trip-update?format=protobuf");
  assert.equal(seen[0].init.headers["Ocp-Apim-Subscription-Key"], "secret-k");
  assert.ok(!c.error.includes("secret-k"));
});
