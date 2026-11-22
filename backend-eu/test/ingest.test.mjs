import { test } from "node:test";
import assert from "node:assert/strict";
import { fields, str, sub } from "../src/protobuf.js";
import { filterFeed } from "../src/gtfsrt.js";
import { feedFor, irishRailTrips, isIrishRailAlert, isIrishRailRoute } from "../src/ireland.js";
import { emptyState, runCycle } from "../src/cycle.js";

// A tiny protobuf writer for test feeds.
const enc = new TextEncoder();
const varint = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const bytes = (field, b) => [...varint((field << 3) | 2), ...varint(b.length), ...b];
const string = (field, s) => bytes(field, [...enc.encode(s)]);
const int = (field, n) => [...varint(field << 3), ...varint(n)];
const header = bytes(1, [...string(1, "2.0"), ...int(3, 1795309671)]);
const tripUpdate = (id, tripId, routeId) =>
  bytes(2, [...string(1, id), ...bytes(3, [...bytes(1, [...string(1, tripId), ...(routeId ? string(5, routeId) : [])]), ...int(5, 120)])]);
const alert = (id, sel) => bytes(2, [...string(1, id), ...bytes(5, [...bytes(5, sel)])]);
const feed = (...entities) => Uint8Array.from([...header, ...entities.flat()]);

test("Irish Rail's route ids, and nobody else's", () => {
  for (const id of ["DUB-CORK-O", "DUB-DRO/DUN-I", "BRAY-HOWTH-I", "GALWAY-LIM-I"]) assert.ok(isIrishRailRoute(id), id);
  for (const id of ["03C_120_e_a", "4429_123", "", undefined, "DART"]) assert.ok(!isIrishRailRoute(id), String(id));
});

test("trip updates: only Irish Rail's, the header and bytes kept as they were", () => {
  const ir = tripUpdate("a", "6065_100", "DUB-CORK-O");
  const bus = tripUpdate("b", "6018_5", "03C_120_e_a");
  const noRoute = tripUpdate("c", "6065_101"); // same prefix as Irish Rail's: kept
  const otherNoRoute = tripUpdate("d", "6018_6");
  const raw = feed(ir, bus, noRoute, otherNoRoute);
  const out = filterFeed(raw, irishRailTrips(raw));
  assert.equal(out.total, 4);
  assert.equal(out.kept, 2);
  assert.deepEqual([...out.bytes], [...header, ...ir, ...noRoute]);
  const ids = fields(out.bytes).filter((f) => f.field === 2).map((f) => str(f.value, 1));
  assert.deepEqual(ids, ["a", "c"]);
  assert.equal(str(sub(out.bytes, 1), 1), "2.0");
});

test("alerts: about Irish Rail's agency, routes or trips", () => {
  const byAgency = alert("x", string(1, "IR"));
  const byRoute = alert("y", string(2, "DUB-SLIGO-O"));
  const byTrip = alert("z", bytes(4, [...string(1, "6065_9"), ...string(5, "MAL-COBH-O")]));
  const bus = alert("w", string(2, "03C_120_e_a"));
  const out = filterFeed(feed(byAgency, byRoute, byTrip, bus), isIrishRailAlert);
  assert.equal(out.kept, 3);
});

test("one call a minute: trip updates, and alerts every fifth minute", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map((n) => feedFor(n).name), [
    "alerts.pb", "trip_updates.pb", "trip_updates.pb", "trip_updates.pb", "trip_updates.pb", "alerts.pb", "trip_updates.pb", "alerts.pb",
  ]);
});

function fakeBucket() {
  const put = new Map();
  return { put: async (k, v, o) => put.set(k, { v, o }), store: put };
}

test("a cycle writes the filtered feed and status.json; the key only in a header", async () => {
  const calls = [];
  const raw = feed(tripUpdate("a", "6065_100", "DUB-CORK-O"), tripUpdate("b", "6018_5", "03C_120_e_a"));
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(raw, { status: 200 });
  };
  const LIVE = fakeBucket();
  const env = { IE_NTA_API_KEY: "secret-key", LIVE };
  const state = { ...emptyState(), minute: 1 };
  const status = await runCycle({ state, env, fetchFn, now: Date.parse("2026-11-23T09:00:00Z") });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.nationaltransport.ie/gtfsr/v2/TripUpdates");
  assert.ok(!calls[0].url.includes("secret-key"));
  assert.equal(calls[0].init.headers["x-api-key"], "secret-key");
  assert.equal(status.ok, true);
  assert.equal(status.feeds["trip_updates.pb"].kept, 1);
  assert.equal(status.feeds["trip_updates.pb"].renfeLastModified, "Mon, 23 Nov 2026 09:00:00 GMT");
  assert.ok(LIVE.store.has("ie/rt/trip_updates.pb"));
  const written = JSON.parse(LIVE.store.get("ie/rt/status.json").v);
  assert.equal(written.feeds["trip_updates.pb"].entities, 2);
  assert.ok(!JSON.stringify(written).includes("secret-key"));
});

test("a refused call backs off: no call until the wait is over", async () => {
  let n = 0;
  const fetchFn = async () => (n++, new Response("Too Many Requests", { status: 429 }));
  const env = { IE_NTA_API_KEY: "k", LIVE: fakeBucket() };
  const state = { ...emptyState(), minute: 1 };
  const t0 = Date.parse("2026-11-23T09:00:00Z");
  let s = await runCycle({ state, env, fetchFn, now: t0 });
  assert.equal(s.ok, false);
  assert.match(s.error, /HTTP 429/);
  assert.equal(s.failures, 1);
  s = await runCycle({ state, env, fetchFn, now: t0 + 30_000 });
  assert.equal(s.skipped, true);
  assert.equal(n, 1);
  await runCycle({ state, env, fetchFn, now: t0 + 61_000 });
  assert.equal(n, 2);
  assert.equal(state.failures, 2);
  assert.equal(state.nextAt, t0 + 61_000 + 120_000);
});

test("without a key: says so, calls nobody", async () => {
  let n = 0;
  const s = await runCycle({ state: emptyState(), env: { LIVE: fakeBucket() }, fetchFn: async () => (n++, new Response("")), now: 0 });
  assert.equal(s.ok, false);
  assert.match(s.error, /no API key/);
  assert.equal(n, 0);
});
