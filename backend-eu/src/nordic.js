// M2 countries (docs/europe/registrations.md): Finland (Fintraffic's
// Digitraffic), Norway (Entur) and the Netherlands (OVapi). Open data with no
// key; each asks clients to name themselves in a header, so we send a
// generic name (AGENTS.md: no personal details to outside services).
//
// Each cycle fetches one feed: the first feed every cycle, the others every
// `every` cycles (cycle.js feedFor), within each provider's fair use.

import { alertTargets, entityTrip } from "./gtfsrt.js";

const CLIENT = "Metranos-TrainRadar";

/** Finland (CC BY 4.0): GPS of every running train, and delays. */
export const FI = {
  code: "fi",
  prefix: "fi/rt/",
  base: "https://rata.digitraffic.fi/api/v1/trains/",
  cycleMs: 15_000,
  // GPS every 30 s, trip updates every 30 s, alternating.
  feeds: [
    { name: "vehicle_positions.pb", path: "gtfs-rt-locations", every: 1 },
    { name: "trip_updates.pb", path: "gtfs-rt-updates", every: 2 },
  ],
  source: "Fintraffic / digitraffic.fi, GTFS-Realtime, CC BY 4.0",
  enabled: (env) => env.FI_ENABLED === "true",
  missing: () => null,
  // Without Digitraffic-User, Digitraffic throttles (HTTP 429).
  headers: () => ({ "Digitraffic-User": CLIENT, accept: "application/x-protobuf" }),
  keep: () => null,
};

/** Norway's rail operators in Entur's national feeds: Vy, Go-Ahead Nordic,
 * SJ Norge and Flytoget (codespaces VYG, GOA, SJN, FLT). */
const RAIL = new Set(["VYG", "GOA", "SJN", "FLT"]);
const codespace = (id) => (id || "").split(":")[0];
export const isNorwegianRail = (entity) => RAIL.has(codespace(entityTrip(entity).tripId));
export const isNorwegianRailAlert = (entity) =>
  alertTargets(entity).some((t) => [t.agency, t.route, t.tripId].some((id) => RAIL.has(codespace(id))));

/** Norway (NLOD): every operator in the country, filtered to trains. */
export const NO = {
  code: "no",
  prefix: "no/rt/",
  base: "https://api.entur.io/realtime/v1/gtfs-rt/",
  cycleMs: 20_000,
  // GPS on most cycles; trip updates (about 5 MB) every minute; alerts
  // every five minutes.
  feeds: [
    { name: "vehicle_positions.pb", path: "vehicle-positions", every: 1 },
    { name: "alerts.pb", path: "alerts", every: 15 },
    { name: "trip_updates.pb", path: "trip-updates", every: 3 },
  ],
  source: "Entur AS, GTFS-Realtime, NLOD",
  enabled: (env) => env.NO_ENABLED === "true",
  missing: () => null,
  headers: () => ({ "ET-Client-Name": CLIENT.toLowerCase(), accept: "application/x-protobuf" }),
  keep: (name) => (name === "alerts.pb" ? isNorwegianRailAlert : isNorwegianRail),
};

/** The Netherlands (CC0): every Dutch rail operator's delays, with
 * platform changes; regenerated every minute. */
export const NL = {
  code: "nl",
  prefix: "nl/rt/",
  base: "https://gtfs.ovapi.nl/nl/",
  cycleMs: 60_000,
  feeds: [{ name: "trip_updates.pb", path: "trainUpdates.pb", every: 1 }],
  source: "OVapi (gtfs.ovapi.nl), from the NDOV national data, CC0",
  enabled: (env) => env.NL_ENABLED === "true",
  missing: () => null,
  headers: () => ({ "user-agent": `${CLIENT} (+https://mytrainradar.com)`, accept: "application/x-protobuf" }),
  keep: () => null,
};
