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
  return {
    put: async (k, v, o) => put.set(k, { v, o }),
    get: async (k) => (put.has(k) ? { arrayBuffer: async () => put.get(k).v } : null),
    store: put,
  };
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

test("France: SNCF's feeds, no key, everything kept; alternating every 30 s", async () => {
  const { FR } = await import("../src/france.js");
  assert.deepEqual([0, 1, 2, 3].map((n) => feedFor(n, FR).name), ["alerts.pb", "trip_updates.pb", "alerts.pb", "trip_updates.pb"]);
  const calls = [];
  const raw = feed(tripUpdate("a", "OCESN6601F", null), tripUpdate("b", "OCESN860261F", null));
  const fetchFn = async (url, init) => (calls.push({ url, init }), new Response(raw, { status: 200 }));
  const LIVE = fakeBucket();
  const state = { ...emptyState(), minute: 1 };
  const s = await runCycle({ state, env: { LIVE }, fetchFn, now: Date.parse("2026-11-23T09:00:00Z"), country: FR });
  assert.equal(s.ok, true, s.error);
  assert.equal(calls[0].url, "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates");
  assert.equal(s.feeds["trip_updates.pb"].kept, 2);
  assert.deepEqual([...LIVE.store.get("fr/rt/trip_updates.pb").v], [...raw]);
  assert.match(JSON.parse(LIVE.store.get("fr/rt/status.json").v).source, /SNCF/);
  assert.ok(!FR.enabled({}) && FR.enabled({ FR_ENABLED: "true" }));
});

test("the Worker re-arms only the countries switched on", async () => {
  const { default: worker, COUNTRIES } = await import("../src/index.js");
  assert.deepEqual(Object.keys(COUNTRIES), ["ie", "fr", "fi", "no", "nl", "ch", "pl", "se", "cz", "dk", "de", "be", "au", "nz", "sg", "jp"]);
  const asked = [];
  const env = {
    FR_ENABLED: "true",
    IE_ENABLED: "true", // but no key: Ireland stays off
    FEED_INGEST: { idFromName: (n) => n, get: (id) => ({ fetch: async (u) => asked.push([id, u]) }) },
  };
  // A minute off the world view's ten (that write is tested on its own).
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 0, 1, 12, 1) }, env);
  assert.deepEqual(asked, [["fr", "https://ingest/ensure?c=fr"]]);
});

test("Norway: only Vy's, Go-Ahead's, SJ's and Flytoget's trains and alerts", async () => {
  const { NO, isNorwegianRailAlert } = await import("../src/nordic.js");
  const vy = tripUpdate("a", "VYG:ServiceJourney:1913_819010-R");
  const flt = tripUpdate("b", "FLT:ServiceJourney:1-2614-3736-20261122");
  const bus = tripUpdate("c", "RUT:ServiceJourney:31-123");
  const out = filterFeed(feed(vy, flt, bus), NO.keep("trip_updates.pb"));
  assert.equal(out.kept, 2);
  const alerts = filterFeed(feed(alert("x", string(2, "VYG:Line:R14")), alert("y", string(2, "VYX:Line:FB1"))), isNorwegianRailAlert);
  assert.equal(alerts.kept, 1, "Vy's trains, not Vy's express buses");
  // Every 20 s: GPS, trip updates each minute, alerts every five.
  const names = [1, 2, 3, 15].map((n) => feedFor(n, NO).name);
  assert.deepEqual(names, ["vehicle_positions.pb", "vehicle_positions.pb", "trip_updates.pb", "alerts.pb"]);
  assert.equal(NO.headers()["ET-Client-Name"], "metranos-trainradar");
});

test("Finland and the Netherlands: no key, a header naming the app, everything kept", async () => {
  const { FI, NL } = await import("../src/nordic.js");
  assert.deepEqual([0, 1].map((n) => feedFor(n, FI).name), ["trip_updates.pb", "vehicle_positions.pb"]);
  assert.ok(FI.headers()["Digitraffic-User"]);
  assert.equal(feedFor(7, NL).path, "trainUpdates.pb");
  assert.match(NL.headers()["user-agent"], /TrainRadar/);
  for (const c of [FI, NL]) assert.equal(c.keep("trip_updates.pb"), null);
});

test("Switzerland: only trains; each API's own key in the Authorization header", async () => {
  const { CH, isSwissRailId } = await import("../src/central.js");
  assert.ok(isSwissRailId("91-10-A-j26-1") && isSwissRailId(".ojp-91-10-A.1.TA.1.j26") && !isSwissRailId("92-31-j26-1"));
  const calls = [];
  const raw = feed(tripUpdate("a", ".ojp-91-10-A.1.TA.1.j26", null), tripUpdate("b", ".ojp-92-31-B.1.TA.4.j26", "92-31-j26-1"));
  const fetchFn = async (url, init) => (calls.push({ url, init }), new Response(raw, { status: 200 }));
  const LIVE = fakeBucket();
  const env = { LIVE, CH_OTD_GTFSRT_KEY: "rt-key", CH_OTD_GTFSSA_KEY: "sa-key" };
  const s = await runCycle({ state: { ...emptyState(), minute: 1 }, env, fetchFn, now: Date.parse("2026-11-23T09:00:00Z"), country: CH });
  assert.equal(s.ok, true, s.error);
  assert.equal(calls[0].url, "https://api.opentransportdata.swiss/la/gtfs-rt");
  assert.equal(calls[0].init.headers.authorization, "Bearer rt-key");
  assert.ok(!calls[0].url.includes("key"));
  assert.equal(s.feeds["trip_updates.pb"].kept, 1);
  // Minute 3: unplanned alerts, with their own key; they make up alerts.pb.
  const a = feed(alert("x", string(2, "91-10-A-j26-1")), alert("y", string(2, "92-31-j26-1")), alert("z", string(1, "11")));
  const fetchA = async (url, init) => (calls.push({ url, init }), new Response(a, { status: 200 }));
  const s3 = await runCycle({ state: { ...emptyState(), minute: 3 }, env, fetchFn: fetchA, now: Date.parse("2026-11-23T09:01:00Z"), country: CH });
  assert.equal(s3.ok, true, s3.error);
  assert.equal(calls[1].url, "https://api.opentransportdata.swiss/la/gtfs-sa");
  assert.equal(calls[1].init.headers.authorization, "Bearer sa-key");
  assert.equal(s3.feeds["alerts_unplanned.pb"].kept, 2); // the train line's, and the one about no line
  assert.deepEqual([...LIVE.store.get("ch/rt/alerts.pb").v], [...LIVE.store.get("ch/rt/alerts_unplanned.pb").v]);
  // Minute 90: planned alerts, but without their key the main feed instead.
  const s90 = await runCycle({ state: { ...emptyState(), minute: 90 }, env, fetchFn, now: Date.parse("2026-11-23T09:30:00Z"), country: CH });
  assert.equal(s90.fetched, "trip_updates.pb");
  assert.ok(!CH.enabled({ CH_ENABLED: "true" }) && CH.enabled({ CH_ENABLED: "true", CH_OTD_GTFSRT_KEY: "k" }));
});

test("Poland: PLK's JSON becomes GTFS-Realtime trip updates with the timetable's ids", async () => {
  const { PL, polishUpdates } = await import("../src/central.js");
  const json = {
    trains: [
      {
        scheduleId: 26,
        orderId: 1234,
        operatingDate: "2026-11-23",
        trainStatus: "P",
        stations: [
          { stationId: 1, plannedSequenceNumber: 1, actualDeparture: "2026-11-23T08:02:00", departureDelayMinutes: 2 },
          { stationId: 2, plannedSequenceNumber: 2, actualArrival: "2026-11-23T08:40:00", arrivalDelayMinutes: -1 },
          { stationId: 3, plannedSequenceNumber: 3 },
        ],
      },
      { scheduleId: 26, orderId: 99, operatingDate: "2026-11-23", trainStatus: "X", stations: [] },
      { scheduleId: 26, orderId: 7, operatingDate: "2026-11-23", trainStatus: "S", stations: [{ stationId: 1 }] },
    ],
  };
  const u = polishUpdates(json);
  assert.equal(u.length, 2);
  assert.equal(u[0].tripId, "26_1234");
  assert.deepEqual(u[0].stops.map((s) => [s.stopId, s.arrivalDelay, s.departureDelay]), [["1", null, 120], ["2", -60, null]]);
  assert.ok(u[1].canceled);
  const calls = [];
  const fetchFn = async (url, init) => (calls.push({ url, init }), new Response(JSON.stringify(json), { status: 200 }));
  const LIVE = fakeBucket();
  const s = await runCycle({ state: { ...emptyState(), minute: 1 }, env: { LIVE, PL_PLK_API_KEY: "pl-key" }, fetchFn, now: Date.parse("2026-11-23T09:00:00Z"), country: PL });
  assert.equal(s.ok, true, s.error);
  assert.equal(calls[0].init.headers["x-api-key"], "pl-key");
  assert.ok(!calls[0].url.includes("pl-key"));
  const pb = LIVE.store.get("pl/rt/trip_updates.pb").v;
  const ents = fields(pb).filter((f) => f.field === 2);
  assert.equal(ents.length, 2);
  const trip = sub(sub(ents[0].value, 3), 1);
  assert.equal(str(trip, 1), "26_1234");
  assert.equal(str(trip, 3), "20261123");
  // The negative delay is a ten-byte int32, as protobuf writes it.
  const stus = fields(sub(ents[0].value, 3)).filter((f) => f.field === 2);
  const arr = sub(stus[1].value, 2);
  const raw = [...fields(arr)[0].raw];
  assert.equal(raw.length, 11); // key + ten bytes
  assert.equal(raw[1], 0xc4); // -60's low seven bits, continued
  assert.equal(raw[10], 0x01);
});

test("Sweden: one region a cycle, the key only in Trafiklab's URL, only our trains", async () => {
  const { SE, resetRailTrips } = await import("../src/sweden.js");
  resetRailTrips();
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("rail-trips.txt")) return new Response("121120100403513959\n55700000091179868\n", { status: 200 });
    if (url.includes("/skane/")) return new Response(feed(tripUpdate("a", "121120100403513959", null), tripUpdate("b", "121120100000000001", null)), { status: 200 });
    return new Response(feed(tripUpdate("c", "55700000091179868", null)), { status: 200 });
  };
  const LIVE = fakeBucket();
  const env = { LIVE, SE_TRAFIKLAB_RT_KEY: "se-key", SE_ENABLED: "true" };
  const s0 = await runCycle({ state: { ...emptyState(), minute: 0 }, env, fetchFn, now: 1_000, country: SE });
  assert.equal(s0.ok, true, s0.error);
  assert.equal(s0.fetched, "tu_skane.pb");
  const call = calls.find((c) => c.url.includes("samtrafiken"));
  assert.equal(call.url, "https://opendata.samtrafiken.se/gtfs-rt-sweden/skane/TripUpdatesSweden.pb?key=se-key");
  assert.equal(s0.feeds["tu_skane.pb"].kept, 1);
  // Next cycle, next region: trip_updates.pb holds both regions' trains.
  const s1 = await runCycle({ state: { ...emptyState(), minute: 4 }, env, fetchFn, now: 2_000, country: SE });
  assert.equal(s1.fetched, "tu_otraf.pb");
  const ids = fields(LIVE.store.get("se/rt/trip_updates.pb").v)
    .filter((f) => f.field === 2)
    .map((f) => str(sub(sub(f.value, 3), 1), 1));
  assert.deepEqual(ids.sort(), ["121120100403513959", "55700000091179868"]);
  // A refusal names the region, never the URL with the key.
  const s2 = await runCycle({
    state: { ...emptyState(), minute: 1 },
    env,
    fetchFn: async () => new Response("no", { status: 403 }),
    now: 3_000,
    country: SE,
  });
  assert.match(s2.error, /sl\/TripUpdatesSweden.pb: HTTP 403/);
  assert.equal(s2.nextCallAt, null); // the next region still has its turn
  assert.ok(!JSON.stringify(s2).includes("se-key"));
  assert.ok(!SE.enabled({ SE_ENABLED: "true" }) && SE.enabled({ SE_ENABLED: "true", SE_TRAFIKLAB_RT_KEY: "k" }));
});

test("Czechia: only PID's trains (vehicle id train-N), from both of Golemio's feeds", async () => {
  const { CZ } = await import("../src/czechia.js");
  // A trip update with its vehicle (field 3), and a vehicle position (field 4) with its vehicle (field 8).
  const tu = (id, trip, vehicle) =>
    bytes(2, [...string(1, id), ...bytes(3, [...bytes(1, string(1, trip)), ...bytes(3, string(1, vehicle))])]);
  const vp = (id, trip, vehicle) =>
    bytes(2, [...string(1, id), ...bytes(4, [...bytes(1, string(1, trip)), ...bytes(8, string(1, vehicle))])]);
  const keep = CZ.keep("trip_updates.pb");
  assert.equal(filterFeed(feed(tu("a", "1030_9504_260309", "train-9504"), tu("b", "1781_241_261103", "service-3-1234")), keep).kept, 1);
  assert.equal(filterFeed(feed(vp("a", "1003_9504_260309", "train-9504"), vp("b", "22_1_1", "tram-9000")), keep).kept, 1);
  // GPS every 20 s, trip updates (every PID vehicle, about 4 MB) each minute; no key.
  assert.deepEqual([1, 2, 3].map((n) => feedFor(n, CZ).name), ["vehicle_positions.pb", "vehicle_positions.pb", "trip_updates.pb"]);
  assert.equal(CZ.enabled({ CZ_ENABLED: "true" }), true);
  assert.equal(CZ.missing({}), null);
});

test("Poland: every page at first, then only the changes (since), removals applied; 410 reads every page again", async () => {
  const { PL, resetPolishState } = await import("../src/central.js");
  resetPolishState();
  const train = (orderId, delay) => ({
    scheduleId: 26, orderId, operatingDate: "2026-11-24", trainStatus: "P",
    stations: [{ stationId: 1, plannedSequenceNumber: 1, actualDeparture: "2026-11-24T08:02:00", departureDelayMinutes: delay }],
  });
  const pages = { 1: [train(1, 1), train(2, 2)], 2: [train(3, 3)] };
  const calls = [];
  let delta = null;
  const fetchFn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.searchParams.get("since")) {
      if (delta === 410) return new Response("", { status: 410 });
      return Response.json({ dataVersion: "v2", trains: delta.trains, removedTrains: delta.removed, pagination: { hasNextPage: false } });
    }
    const p = Number(u.searchParams.get("page"));
    return Response.json({ dataVersion: "v1", trains: pages[p], pagination: { page: p, hasNextPage: p < 2 } });
  };
  const store = new Map();
  const LIVE = {
    put: async (k, v) => store.set(k, v),
    get: async (k) => (store.has(k) ? { text: async () => store.get(k), arrayBuffer: async () => store.get(k) } : null),
  };
  const env = { LIVE, PL_PLK_API_KEY: "pl-key" };
  const count = () => fields(store.get("pl/rt/trip_updates.pb")).filter((f) => f.field === 2).length;
  let now = Date.parse("2026-11-24T09:00:00Z");
  assert.equal((await runCycle({ state: { ...emptyState(), minute: 1 }, env, fetchFn, now, country: PL })).ok, true);
  assert.equal(calls.length, 2, "two pages");
  assert.equal(count(), 3);
  // The changes: train 2 later, train 3 gone, train 4 new; one call.
  delta = { trains: [train(2, 5), train(4, 0)], removed: [{ scheduleId: 26, orderId: 3, operatingDate: "2026-11-24" }] };
  calls.length = 0;
  now += 120_000;
  assert.equal((await runCycle({ state: { ...emptyState(), minute: 1 }, env, fetchFn, now, country: PL })).ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /since=v1/);
  assert.equal(count(), 3);
  const state = JSON.parse(store.get("pl/rt/state.json"));
  assert.equal(state.version, "v2");
  assert.equal(state.updates["26_2_20261124"].stops[0].departureDelay, 300);
  assert.ok(!state.updates["26_3_20261124"]);
  // PLK can't give the changes (410): every page again.
  delta = 410;
  calls.length = 0;
  now += 120_000;
  assert.equal((await runCycle({ state: { ...emptyState(), minute: 1 }, env, fetchFn, now, country: PL })).ok, true);
  assert.equal(calls.length, 3, "the refused delta, then two pages");
  assert.equal(count(), 3);
});

test("Poland: PLK's disruptions become alerts on their stations, every 15th cycle", async () => {
  const { PL, polishAlerts } = await import("../src/central.js");
  const json = {
    disruptions: [
      { disruptionId: 7, disruptionTypeCode: "utr_32", startStationId: 80416, endStationId: 33605, message: "Zamknięcie toru nr 1. Pociągi kursują jednym torem." },
      { disruptionId: 8, disruptionTypeCode: "utr_1", message: "", affectedRoutes: [{ scheduleId: 26, orderId: 1, stationId: 5100 }, { scheduleId: 26, orderId: 2, stationId: 5100 }] },
      { message: "no id" },
    ],
    disruptionTypes: { utr_32: "Zamknięcie toru", utr_1: "Awaria" },
    stations: { 80416: "Kraków Główny", 33605: "Warszawa Centralna" },
  };
  const a = polishAlerts(json);
  assert.equal(a.length, 2);
  assert.deepEqual(a[0].stops, ["80416", "33605"]);
  assert.equal(a[0].header, "Zamknięcie toru: Kraków Główny – Warszawa Centralna");
  assert.match(a[0].description, /jednym torem/);
  assert.deepEqual(a[1].stops, ["5100"]);
  assert.equal(a[1].header, "Awaria");
  // The operations' turn, except every 15th cycle.
  assert.deepEqual([1, 14, 15, 16, 30].map((n) => feedFor(n, PL).name), ["trip_updates.pb", "trip_updates.pb", "alerts.pb", "trip_updates.pb", "alerts.pb"]);
  const calls = [];
  const fetchFn = async (url, init) => (calls.push({ url, init }), Response.json(json));
  const store = new Map();
  const LIVE = { put: async (k, v) => store.set(k, v), get: async (k) => (store.has(k) ? { arrayBuffer: async () => store.get(k) } : null) };
  const s = await runCycle({ state: { ...emptyState(), minute: 15 }, env: { LIVE, PL_PLK_API_KEY: "pl-key" }, fetchFn, now: 0, country: PL });
  assert.equal(s.ok, true, s.error);
  assert.equal(calls[0].url, "https://pdp-api.plk-sa.pl/api/v1/disruptions");
  assert.equal(calls[0].init.headers["x-api-key"], "pl-key");
  assert.equal(fields(store.get("pl/rt/alerts.pb")).filter((f) => f.field === 2).length, 2);
});

test("Sweden: Trafikverket's calls become delays by train number; its key only in the body", async () => {
  const { SE, mergeAnnouncements, announcementUpdates, resetTrafikverket } = await import("../src/sweden.js");
  const a = (n, sig, act, t, extra = {}) => ({
    AdvertisedTrainIdent: n, ScheduledDepartureDateTime: "2026-11-25T00:00:00.000+01:00", LocationSignature: sig, ActivityType: act,
    AdvertisedTimeAtLocation: t, ...extra,
  });
  const calls = mergeAnnouncements({}, [
    a("1059", "Cst", "Avgang", "2026-11-25T08:00:00.000+01:00", { TimeAtLocation: "2026-11-25T08:02:00.000+01:00" }),
    a("1059", "Söc", "Ankomst", "2026-11-25T08:20:00.000+01:00", { TimeAtLocation: "2026-11-25T08:25:00.000+01:00" }),
    a("1059", "Nk", "Ankomst", "2026-11-25T09:00:00.000+01:00", { EstimatedTimeAtLocation: "2026-11-25T09:04:00.000+01:00" }),
    a("8701", "U", "Avgang", "2026-11-25T08:10:00.000+01:00", { EstimatedTimeAtLocation: "2026-11-25T08:13:00.000+01:00" }),
    a("42", "M", "Avgang", "2026-11-25T08:00:00.000+01:00", { Canceled: true }),
    a("42", "Lu", "Ankomst", "2026-11-25T08:10:00.000+01:00", { Canceled: true }),
  ]);
  const u = Object.fromEntries(announcementUpdates(calls).map((x) => [x.tripId, x]));
  assert.equal(u["#1059"].stops[0].arrivalDelay, 300); // the last call that happened
  assert.equal(u["#1059"].startDate, "20261125");
  assert.equal(u["#8701"].stops[0].departureDelay, 180); // none yet: the next expected
  assert.ok(u["#42"].canceled);
  // A deleted call goes.
  mergeAnnouncements(calls, [a("8701", "U", "Avgang", "2026-11-25T08:10:00.000+01:00", { Deleted: true })]);
  assert.ok(!announcementUpdates(calls).some((x) => x.tripId === "#8701"));
  // Through the cycle: the first time every call (changeid 0), then the changes.
  const now = Date.parse("2026-11-25T08:00:00Z");
  resetTrafikverket();
  const bodies = [];
  const fetchFn = async (url, init) => {
    if (url.endsWith("rail-trips.txt")) return new Response("x\n");
    assert.equal(url, "https://api.trafikinfo.trafikverket.se/v2/data.json");
    assert.ok(!url.includes("tv-key"));
    bodies.push(init.body);
    return Response.json({ RESPONSE: { RESULT: [{ TrainAnnouncement: [a("1059", "Cst", "Avgang", new Date(now).toISOString(), { TimeAtLocation: new Date(now + 60_000).toISOString() })], INFO: { LASTCHANGEID: "77" } }] } });
  };
  const store = new Map();
  const LIVE = { put: async (k, v) => store.set(k, v), get: async (k) => (store.has(k) ? { arrayBuffer: async () => store.get(k) } : null) };
  const env = { LIVE, SE_ENABLED: "true", SE_TRAFIKLAB_RT_KEY: "se-key", SE_TRAFIKVERKET_KEY: "tv-key" };
  const tvTurn = SE.feeds.findIndex((f) => f.name === "tu_trafikverket.pb");
  const s = await runCycle({ state: { ...emptyState(), minute: tvTurn }, env, fetchFn, now, country: SE });
  assert.equal(s.ok, true, s.error);
  assert.match(bodies[0], /authenticationkey="tv-key"/);
  assert.match(bodies[0], /changeid="0"/);
  const ids = fields(store.get("se/rt/trip_updates.pb")).filter((f) => f.field === 2).map((f) => str(sub(sub(f.value, 3), 1), 1));
  assert.deepEqual(ids, ["#1059"]);
  await runCycle({ state: { ...emptyState(), minute: tvTurn }, env, fetchFn, now: now + 24_000, country: SE });
  assert.match(bodies[1], /changeid="77"/);
  // A refusal never shows the key; without it, Trafikverket's turn goes to a region.
  const bad = await runCycle({ state: { ...emptyState(), minute: tvTurn }, env, fetchFn: async () => new Response("tv-key bad", { status: 401 }), now, country: SE });
  assert.match(bad.error, /Trafikverket TrainAnnouncement: HTTP 401/);
  assert.ok(!JSON.stringify(bad).includes("tv-key"));
  const noKey = await runCycle({ state: { ...emptyState(), minute: tvTurn }, env: { ...env, SE_TRAFIKVERKET_KEY: "" }, fetchFn: async () => new Response(new Uint8Array([10, 2, 49, 48])), now, country: SE });
  assert.equal(noKey.fetched, "tu_skane.pb");
});
