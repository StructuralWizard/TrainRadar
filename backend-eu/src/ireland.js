// Ireland (docs/europe/ie.md): the National Transport Authority's
// GTFS-Realtime v2, for every operator in the country, filtered to
// Iarnród Éireann's trains. The key goes in the x-api-key header (never in a
// URL); the NTA allows one call per minute per key, for all its feeds
// together.

import { alertTargets, entityTrip } from "./gtfsrt.js";
import { fields } from "./protobuf.js";

export const IE = {
  code: "ie",
  prefix: "ie/rt/",
  base: "https://api.nationaltransport.ie/gtfsr/v2/",
  /** A little over a minute: the NTA allows one call per 60 s per key. */
  cycleMs: 61_000,
  // Trip updates every minute; alerts take the place of every fifth one.
  feeds: [
    { name: "trip_updates.pb", path: "TripUpdates", every: 1 },
    { name: "alerts.pb", path: "alerts", every: 5 },
  ],
  source: "National Transport Authority (Transport for Ireland), GTFS-Realtime v2, CC BY 4.0, provided as is",
  enabled: (env) => env.IE_ENABLED === "true" && !!env.IE_NTA_API_KEY,
  missing: (env) => (env.IE_NTA_API_KEY ? null : "no API key (IE_NTA_API_KEY)"),
  // The key in a header, never in the URL (AGENTS.md).
  headers: (env) => ({ "x-api-key": env.IE_NTA_API_KEY, accept: "application/x-protobuf", "cache-control": "no-cache" }),
  keep: (name, bytes) => (name === "alerts.pb" ? isIrishRailAlert : irishRailTrips(bytes)),
};

/** Irish Rail's route ids are names like "DUB-CORK-O" or "DUB-DRO/DUN-I";
 * every other operator's are codes like "03C_120_e_a" (checked against the
 * NTA's GTFS, 22 Nov 2026: 19 of 402 routes match, all Irish Rail's). */
const IR_ROUTE = /^[A-Z][A-Z/]*(-[A-Z/]+)+-[IO]$/;
export const isIrishRailRoute = (id) => IR_ROUTE.test(id || "");

/** Which of a country's feeds to fetch on cycle `n`: the first one whose
 * `every` divides n, among those fetched less often; else the main one. */
export function feedFor(n, country = IE) {
  // Sweden's regions: one after the other.
  if (country.rotate) return country.feeds[n % country.feeds.length];
  return country.feeds.find((f) => f.every > 1 && n % f.every === 0) || country.feeds[0];
}

/**
 * Keep Irish Rail's trip updates in feed `bytes`. The NTA's trip ids start
 * with the static file's version ("6065_"), shared by all of an operator's
 * trips: a trip without a route id is kept when its prefix is one that
 * Irish Rail's routed trips use.
 */
export function irishRailTrips(bytes) {
  const prefixes = new Set();
  for (const f of fields(bytes)) {
    if (f.field !== 2 || f.wire !== 2) continue;
    const { tripId, routeId } = entityTrip(f.value);
    if (isIrishRailRoute(routeId)) prefixes.add(tripId.split("_")[0]);
  }
  return (entity) => {
    const { tripId, routeId } = entityTrip(entity);
    return routeId ? isIrishRailRoute(routeId) : prefixes.has(tripId.split("_")[0]);
  };
}

/** Keep alerts about Irish Rail: its agency ("IR"), its routes or its trips. */
export function isIrishRailAlert(entity) {
  return alertTargets(entity).some((t) => t.agency === "IR" || isIrishRailRoute(t.route) || isIrishRailRoute(t.tripRoute));
}
