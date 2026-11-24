// M3/M5 countries (docs/europe/registrations.md).
//
// Switzerland: opentransportdata.swiss's GTFS-Realtime (every operator in
// the country, filtered to trains) and its GTFS service alerts, unplanned
// and planned, merged into one alerts.pb. Each API has its own key, sent in
// the Authorization header (never in a URL); the limits are per key: trip
// updates 5 calls a minute, unplanned alerts 2 a minute and 3,000 a day,
// planned alerts 48 a day.
//
// Poland: PKP PLK's open railway data API publishes live running as JSON
// (/api/v1/operations); the Worker turns it into GTFS-Realtime trip updates
// whose trip and stop ids are the timetable's (tools/plk-gtfs.py). Key in
// the X-API-Key header.

import { alertTargets, entityTrip } from "./gtfsrt.js";
import { tripUpdatesFeed } from "./encode.js";

const CLIENT = "Metranos-TrainRadar";

/** Swiss train routes and trips: route ids "91-…" (and a few "93-…"), trip
 * ids ".ojp-91-…" (checked against the 2026 GTFS: 916 of 969 "91-" routes
 * are trains, every train route is "91-" or "93-"). */
const SWISS_RAIL = /(^|[.-])9[13]-/;
export const isSwissRailId = (id) => SWISS_RAIL.test(id || "");
export const isSwissRail = (entity) => {
  const { tripId, routeId } = entityTrip(entity);
  return isSwissRailId(routeId) || isSwissRailId(tripId);
};
/** Alerts about trains, or about places only (stations): not bus lines. */
export const isSwissRailAlert = (entity) => {
  const targets = alertTargets(entity);
  const lines = targets.filter((t) => t.route || t.tripId || t.tripRoute);
  return lines.length === 0 || lines.some((t) => isSwissRailId(t.route) || isSwissRailId(t.tripId) || isSwissRailId(t.tripRoute));
};

const swissKey = {
  "trip_updates.pb": "CH_OTD_GTFSRT_KEY",
  "alerts_unplanned.pb": "CH_OTD_GTFSSA_KEY",
  "alerts_planned.pb": "CH_OTD_GTFSSA_PLANNED_KEY",
};

export const CH = {
  code: "ch",
  prefix: "ch/rt/",
  base: "https://api.opentransportdata.swiss/la/",
  cycleMs: 20_000,
  // Trip updates every 20 s (3 calls a minute of the 5 allowed); unplanned
  // alerts every minute in their place; planned ones every 30 minutes.
  feeds: [
    { name: "trip_updates.pb", path: "gtfs-rt", every: 1 },
    { name: "alerts_planned.pb", path: "gtfs-sa-planned", every: 90, part: "alerts.pb" },
    { name: "alerts_unplanned.pb", path: "gtfs-sa", every: 3, part: "alerts.pb" },
  ],
  parts: { "alerts.pb": ["alerts_unplanned.pb", "alerts_planned.pb"] },
  source: "opentransportdata.swiss (Open Data Platform Mobility Switzerland), GTFS-Realtime and GTFS service alerts",
  enabled: (env) => env.CH_ENABLED === "true" && !!env.CH_OTD_GTFSRT_KEY,
  missing: (env) => (env.CH_OTD_GTFSRT_KEY ? null : "no API key (CH_OTD_GTFSRT_KEY)"),
  /** The feed's own key, or none (that feed is skipped). */
  ready: (env, feed) => !!env[swissKey[feed.name]],
  headers: (env, feed) => ({
    authorization: `Bearer ${env[swissKey[feed?.name] || "CH_OTD_GTFSRT_KEY"]}`,
    "user-agent": CLIENT,
    accept: "application/octet-stream",
    "accept-encoding": "gzip, br",
  }),
  keep: (name) => (name === "trip_updates.pb" ? isSwissRail : isSwissRailAlert),
};

/** PLK's local times ("2026-11-22T08:15:00") are Polish wall-clock time:
 * the delay is given in minutes, so only the date is read from them. */
const ymd = (d) => String(d || "").slice(0, 10).replaceAll("-", "");

/** PLK /operations JSON → trip updates (seconds), keyed like the timetable:
 * trip `<scheduleId>_<orderId>`, stops by PLK station id. Only stations a
 * train has passed (with an actual time) or that are cancelled. */
export function polishUpdates(json) {
  const out = [];
  for (const t of json?.trains || []) {
    if (t.scheduleId == null || t.orderId == null) continue;
    const stops = [];
    for (const s of t.stations || []) {
      const passed = s.actualArrival || s.actualDeparture;
      if (!passed && !s.isCancelled) continue;
      const arr = s.arrivalDelayMinutes;
      const dep = s.departureDelayMinutes;
      stops.push({
        seq: s.plannedSequenceNumber ?? null,
        stopId: String(s.stationId),
        arrivalDelay: s.actualArrival && arr != null ? arr * 60 : null,
        departureDelay: s.actualDeparture && dep != null ? dep * 60 : null,
        skipped: !!s.isCancelled,
      });
    }
    const canceled = t.trainStatus === "X";
    if (!stops.length && !canceled) continue;
    out.push({
      id: `${t.scheduleId}_${t.orderId}_${ymd(t.operatingDate)}`,
      tripId: `${t.scheduleId}_${t.orderId}`,
      startDate: ymd(t.operatingDate),
      canceled,
      stops,
    });
  }
  return out;
}

/** Poland's live trains between cycles: { version, fullAt, updates: {id:
 * update} }, in memory and in R2 (pl/rt/state.json). */
let plState = null;
export const resetPolishState = () => (plState = null);
/** A full read every 6 hours; changes only (`since`) in between. */
const PL_FULL_MS = 6 * 3_600_000;
const PL_PAGE = 5000;
const PL_MAX_PAGES = 10;

async function plkPages(query, { env, fetchFn }) {
  const headers = PL.headers(env);
  const trains = [];
  let removed = [];
  let version = null;
  for (let page = 1; page <= PL_MAX_PAGES; page++) {
    const r = await fetchFn(`${PL.base}operations?pageSize=${PL_PAGE}&withPlanned=true&page=${page}${query}`, { headers });
    if (r.status === 410) return { gone: true };
    if (!r.ok) throw new Error(`operations (page ${page}): HTTP ${r.status}`);
    const j = await r.json();
    if (page === 1) {
      version = j.dataVersion || null;
      removed = j.removedTrains || [];
    }
    trains.push(...(j.trains || []));
    if (!j.pagination?.hasNextPage) return { trains, removed, version, pages: page };
  }
  throw new Error(`operations: more than ${PL_MAX_PAGES} pages`);
}

/** One cycle: every page every 6 hours, else the changes since the last
 * data version (PLK answers 410 when it can't: then every page). Keeps the
 * call count within the key's daily quota. */
async function polishCycle(ctx) {
  const { env, now } = ctx;
  if (!plState) {
    const o = await env.LIVE.get("pl/rt/state.json");
    plState = o ? JSON.parse(await o.text()) : { version: null, fullAt: 0, updates: {} };
  }
  let got = null;
  if (plState.version && now - plState.fullAt < PL_FULL_MS) {
    got = await plkPages(`&since=${encodeURIComponent(plState.version)}`, ctx);
    if (!got.gone) {
      for (const t of got.trains) {
        const id = `${t.scheduleId}_${t.orderId}_${String(t.operatingDate || "").slice(0, 10).replaceAll("-", "")}`;
        const [u] = polishUpdates({ trains: [t] });
        if (u) plState.updates[id] = u;
        else delete plState.updates[id];
      }
      for (const t of got.removed) {
        delete plState.updates[`${t.scheduleId}_${t.orderId}_${String(t.operatingDate || "").slice(0, 10).replaceAll("-", "")}`];
      }
    }
  }
  if (!got || got.gone) {
    got = await plkPages("", ctx);
    if (got.gone) throw new Error("operations: HTTP 410 without since");
    plState.updates = Object.fromEntries(polishUpdates({ trains: got.trains }).map((u) => [u.id, u]));
    plState.fullAt = now;
  }
  if (got.version) plState.version = got.version;
  await env.LIVE.put("pl/rt/state.json", JSON.stringify(plState), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
  return { bytes: tripUpdatesFeed(Object.values(plState.updates), Math.floor(now / 1000)), pages: got.pages };
}

export const PL = {
  code: "pl",
  prefix: "pl/rt/",
  base: "https://pdp-api.plk-sa.pl/api/v1/",
  // Every 2 minutes: one call (the changes), and every page every 6 hours:
  // about 740 calls a day, within the Basic package (1,000).
  cycleMs: 120_000,
  feeds: [{ name: "trip_updates.pb", path: "operations", every: 1, produce: polishCycle }],
  source: "PKP Polskie Linie Kolejowe S.A., Otwarte Dane Kolejowe (pdp-api.plk-sa.pl), as GTFS-Realtime",
  enabled: (env) => env.PL_ENABLED === "true" && !!env.PL_PLK_API_KEY,
  missing: (env) => (env.PL_PLK_API_KEY ? null : "no API key (PL_PLK_API_KEY)"),
  headers: (env) => ({ "x-api-key": env.PL_PLK_API_KEY, accept: "application/json", "user-agent": CLIENT }),
  keep: () => null,
};
