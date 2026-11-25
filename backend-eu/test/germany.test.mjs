import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BoardState, berlinIso, parseBoard, produce, resetState, resetStations, DE } from "../src/germany.js";
import { fields, str, sub } from "../src/protobuf.js";
import { runCycle, emptyState } from "../src/cycle.js";

const board = JSON.parse(readFileSync(new URL("./fixtures/de-board.json", import.meta.url), "utf8"));
const T = (s) => Date.parse(s);

test("Germany: the board's window in German local time", () => {
  assert.equal(berlinIso(T("2026-11-25T08:31:00Z")), "2026-11-25T09:31:00+01:00");
  assert.equal(berlinIso(T("2026-07-01T08:31:00Z")), "2026-07-01T10:31:00+02:00");
});

test("Germany: departures with their DHID, number, delay and cancellation", () => {
  const e = parseBoard(board);
  assert.equal(e.length, 2, "a stop place the board doesn't name is skipped");
  assert.deepEqual(
    { id: e[0].id, number: e[0].number, category: e[0].category, stop: e[0].stop.stopId, late: (e[0].stop.best - e[0].stop.sched) / 1000, real: e[0].stop.real, platform: e[0].stop.platform },
    { id: "j-ice-1104", number: "1104", category: "ICE", stop: "de:09162:100", late: 240, real: true, platform: "23" },
  );
  assert.equal(e[1].stop.cancelled, true);
});

test("Germany: journeys keyed by number, delay only from forecasts, expiry", () => {
  const st = new BoardState();
  const now = T("2026-11-25T08:35:00Z");
  st.apply(parseBoard(board), now);
  const tu = st.tripUpdates();
  const ice = tu.find((u) => u.tripId === "#1104");
  assert.equal(ice.startDate, "20261125");
  assert.equal(ice.label, "ICE 1104");
  assert.equal(ice.stops[0].departureDelay, 240);
  const re = tu.find((u) => u.tripId === "#4012");
  assert.equal(re.stops[0].departureDelay, null, "a scheduled time is no delay");
  assert.equal(re.stops[0].skipped, true);
  // Later: gone two hours after its last departure.
  assert.equal(st.expire(T("2026-11-25T11:00:00Z")), 2);
  assert.equal(BoardState.from(JSON.parse(JSON.stringify(st))).journeys.size, 0);
});

test("Germany: a cycle asks for the next stations with the keys in headers only", async () => {
  resetState();
  resetStations();
  const stations = Array.from({ length: 100 }, (_, i) => `de:00000:${i}`).join("\n");
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    if (url.endsWith("boards.txt")) return new Response(stations);
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(board), { headers: { "content-type": "application/json" } });
  };
  const m = new Map();
  const LIVE = { put: async (k, v) => m.set(k, v), get: async (k) => (m.has(k) ? { text: async () => String(m.get(k)), arrayBuffer: async () => m.get(k) } : null) };
  const env = { DE_ENABLED: "true", DE_DB_CLIENT_ID: "id-x", DE_DB_API_KEY: "key-y", LIVE };
  assert.equal(DE.enabled(env), true);
  const state = emptyState();
  const cycle = await runCycle({ state, env, fetchFn, now: T("2026-11-25T08:31:00Z"), country: DE });
  assert.equal(state.feeds["trip_updates.pb"].ok, true, cycle.error);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0].body.stopPlaceOrStation.dhids.length, 15);
  assert.equal(calls[0].body.timeWindow.timeStart, "2026-11-25T09:26:00+01:00");
  for (const c of calls) {
    assert.equal(c.init.headers["DB-Api-Key"], "key-y");
    assert.ok(!c.url.includes("key-y") && !c.url.includes("id-x"));
  }
  const pb = m.get("de/rt/trip_updates.pb");
  const ids = fields(pb).filter((f) => f.field === 2).map((f) => str(sub(sub(f.value, 3), 1), 1));
  assert.deepEqual(ids.sort(), ["#1104", "#4012"]);
  // The next cycle goes on from station 90.
  calls.length = 0;
  await runCycle({ state, env, fetchFn, now: T("2026-11-25T08:31:06Z"), country: DE });
  assert.equal(calls[0].body.stopPlaceOrStation.dhids[0], "de:00000:90");
});

test("Germany: refused keys stop the country until the longest backoff", async () => {
  resetState();
  resetStations();
  const fetchFn = async (url) => (url.endsWith("boards.txt") ? new Response("de:1:1") : new Response("no", { status: 401 }));
  const LIVE = { put: async () => {}, get: async () => null };
  const state = emptyState();
  const now = T("2026-11-25T08:31:00Z");
  const c = await runCycle({ state, env: { DE_ENABLED: "true", DE_DB_CLIENT_ID: "a", DE_DB_API_KEY: "secret-b", LIVE }, fetchFn, now, country: DE });
  assert.equal(c.ok, false);
  assert.ok(!String(c.error).includes("secret-b"));
  assert.equal(state.nextAt, now + 30 * 60_000);
});
