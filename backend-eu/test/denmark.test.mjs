import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JourneyState, parseSiriEt } from "../src/siri.js";
import { fields, str, sub } from "../src/protobuf.js";
import { tripUpdatesFeed } from "../src/encode.js";

const xml = readFileSync(new URL("./fixtures/dk-siri-et.xml", import.meta.url), "utf8");
const T = (s) => Date.parse(s);

test("SIRI-ET: Rejseplanen's journeys, their numbers and calls", () => {
  const js = parseSiriEt(xml);
  assert.equal(js.length, 3);
  const [re, ic, gone] = js;
  assert.deepEqual(
    { ref: re.ref, date: re.date, operator: re.operator, line: re.line, train: re.train, direction: re.direction, destination: re.destination, cancelled: re.cancelled },
    { ref: "4402-8600341600000", date: "2026-11-24", operator: "DSB", line: "Re 4402", train: "4402", direction: "1", destination: "Køge Nord St.", cancelled: false },
  );
  assert.equal(re.stops.length, 3);
  assert.deepEqual(
    { stop: re.stops[0].stopRef, order: re.stops[0].order, name: re.stops[0].name, dep: re.stops[0].aimedDep, exp: re.stops[0].expDep, platform: re.stops[0].platform },
    { stop: "8600810", order: 1, name: "Næstved St.", dep: T("2026-11-24T04:06:00Z"), exp: T("2026-11-24T04:06:00Z"), platform: "5" },
  );
  // Recorded calls (actual times) first, then estimated; a cancelled call.
  assert.equal(ic.stops[0].passed, true);
  assert.equal(ic.stops[0].expDep - ic.stops[0].aimedDep, 180_000);
  assert.equal(ic.stops[1].cancelled, true);
  assert.equal(ic.cancelled, false, "a cancelled call doesn't cancel the journey");
  assert.equal(gone.cancelled, true);
});

test("journey state: later updates replace calls; finished journeys expire", () => {
  const st = new JourneyState();
  const now = T("2026-11-24T05:00:00Z");
  st.apply(parseSiriEt(xml), now);
  assert.equal(st.journeys.size, 3);
  // A later message: the IC is 6 minutes late at Aarhus now.
  const later = xml.replace("2026-11-24T08:24:00+01:00", "2026-11-24T08:26:00+01:00");
  st.apply(parseSiriEt(later).slice(1, 2), now + 60_000);
  const ic = st.journeys.get("1035-8600626600000");
  assert.equal(ic.stops.length, 3);
  assert.equal(ic.stops[2].expArr - ic.stops[2].aimedArr, 360_000);
  // An hour after its last call a journey goes; the IC (to 08:26) stays.
  assert.equal(st.expire(T("2026-11-24T06:30:00Z")), 2);
  assert.deepEqual([...st.journeys.keys()], ["1035-8600626600000"]);
  // Survives a cold start through JSON.
  const back = JourneyState.from(JSON.parse(JSON.stringify(st)));
  assert.equal(back.journeys.get("1035-8600626600000").train, "1035");
});

test("journey state → GTFS-Realtime trip updates, with the train number and delays", () => {
  const st = new JourneyState();
  st.apply(parseSiriEt(xml), T("2026-11-24T05:00:00Z"));
  const bytes = tripUpdatesFeed(st.tripUpdates(), 1795000000);
  const ents = fields(bytes).filter((f) => f.field === 2);
  assert.equal(ents.length, 3);
  const tu = sub(ents[1].value, 3);
  assert.equal(str(sub(tu, 1), 1), "1035-8600626600000");
  assert.equal(str(sub(tu, 1), 3), "20261124");
  assert.equal(str(sub(tu, 3), 2), "1035", "train number as the vehicle label");
  const stus = fields(tu).filter((f) => f.field === 2);
  assert.equal(stus.length, 3);
  const firstDep = sub(stus[0].value, 3);
  assert.equal(fields(firstDep).find((f) => f.field === 1).value, 180, "3 min late leaving København H");
  assert.equal(fields(stus[1].value).find((f) => f.field === 5).value, 1, "a cancelled call is SKIPPED");
  // The cancelled journey: schedule_relationship CANCELED (3).
  assert.equal(fields(sub(sub(ents[2].value, 3), 1)).find((f) => f.field === 4).value, 3);
});

test("Denmark's cycle: login, receive until empty, complete each message, write the topic's trip updates", async () => {
  const { DK, resetToken, resetStates } = await import("../src/denmark.js");
  const { runCycle, emptyState } = await import("../src/cycle.js");
  resetToken();
  resetStates();
  const store = new Map();
  const LIVE = {
    put: async (k, v) => store.set(k, v),
    get: async (k) => (store.has(k) ? { text: async () => store.get(k), arrayBuffer: async () => store.get(k) } : null),
  };
  const calls = [];
  let left = 2;
  const fetchFn = async (url, init = {}) => {
    calls.push([init.method || "GET", url, init.body ? String(init.body) : ""]);
    if (url.startsWith("https://login.microsoftonline.com/")) return Response.json({ access_token: "t0k", expires_in: 3600 });
    if (url.endsWith("/messages/head?timeout=1")) {
      if (left <= 0) return new Response(null, { status: 204 });
      left--;
      return new Response(xml, { status: 201, headers: { BrokerProperties: JSON.stringify({ MessageId: `m${left}`, LockToken: `l${left}` }) } });
    }
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    throw new Error(`unexpected ${url}`);
  };
  const env = { LIVE, DK_ENABLED: "true", DK_NAP_CLIENT_SECRET: "s3cret" };
  const state = emptyState();
  const s = await runCycle({ state, env, fetchFn, now: Date.parse("2026-11-24T05:00:00Z"), country: DK });
  assert.equal(s.ok, true, s.error);
  assert.equal(s.fetched, "tu_785.pb");
  // The secret only in the token request's body; the bearer token on the bus.
  const login = calls.filter((c) => c[1].includes("login.microsoftonline.com"));
  assert.equal(login.length, 1);
  assert.match(login[0][2], /client_secret=s3cret/);
  assert.ok(calls.every((c) => c[1].includes("login.") || !c[1].includes("s3cret") && !c[2].includes("s3cret")));
  assert.equal(calls.filter((c) => c[0] === "DELETE").length, 2, "both messages completed");
  assert.ok(store.has("dk/rt/tu_785.pb") && store.has("dk/rt/trip_updates.pb") && store.has("dk/rt/state-785.json"));
  assert.equal(fields(store.get("dk/rt/trip_updates.pb")).filter((f) => f.field === 2).length, 3);
  // Nothing waiting (the night): fine, not a failure.
  const quiet = await runCycle({ state, env, fetchFn, now: Date.parse("2026-11-24T05:00:05Z"), country: DK });
  assert.equal(quiet.ok, true, quiet.error);
});

test("Denmark: a refused login stops the country for the longest wait, without the secret in the error", async () => {
  const { DK, resetToken } = await import("../src/denmark.js");
  const { runCycle, emptyState, BACKOFF_MAX_MS } = await import("../src/cycle.js");
  resetToken();
  const LIVE = { put: async () => {}, get: async () => null };
  const fetchFn = async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
  const state = emptyState();
  const now = Date.parse("2026-11-24T05:00:00Z");
  const s = await runCycle({ state, env: { LIVE, DK_ENABLED: "true", DK_NAP_CLIENT_SECRET: "s3cret" }, fetchFn, now, country: DK });
  assert.equal(s.ok, false);
  assert.match(s.error, /login refused \(HTTP 401\).*new service account/);
  assert.ok(!s.error.includes("s3cret"));
  assert.equal(state.nextAt, now + BACKOFF_MAX_MS);
});
