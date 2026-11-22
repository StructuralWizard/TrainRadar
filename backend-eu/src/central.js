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

export const PL = {
  code: "pl",
  prefix: "pl/rt/",
  base: "https://pdp-api.plk-sa.pl/api/v1/",
  // Every 2 minutes: 720 calls a day, within the Basic package (1,000).
  cycleMs: 120_000,
  feeds: [
    {
      name: "trip_updates.pb",
      path: "operations?pageSize=5000&withPlanned=true",
      every: 1,
      convert: (bytes, now) =>
        tripUpdatesFeed(polishUpdates(JSON.parse(new TextDecoder().decode(bytes))), Math.floor(now / 1000)),
    },
  ],
  source: "PKP Polskie Linie Kolejowe S.A., Otwarte Dane Kolejowe (pdp-api.plk-sa.pl), as GTFS-Realtime",
  enabled: (env) => env.PL_ENABLED === "true" && !!env.PL_PLK_API_KEY,
  missing: (env) => (env.PL_PLK_API_KEY ? null : "no API key (PL_PLK_API_KEY)"),
  headers: (env) => ({ "x-api-key": env.PL_PLK_API_KEY, accept: "application/json", "user-agent": CLIENT }),
  keep: () => null,
};
