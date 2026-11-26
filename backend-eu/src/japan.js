// Japan: Toei's trains in Tokyo (Tokyo Metropolitan Bureau of
// Transportation), from the Public Transportation Open Data Center's public
// API (api-public.odpt.org): GTFS-Realtime positions, trip updates and
// alerts, CC BY 4.0, no key. Trip ids are the static GTFS's
// (Toei-Train-GTFS.zip; 87 of 87 matched, Nov 2026). Kōchi's trams
// (Tosaden) publish a timetable only.
//
// ODPT allows 60 calls a minute, 3,600 an hour and 24,000 a day per address
// (its X-RateLimit headers). One call every 15 s, in a turn of eight: GPS
// every 30 s, trip updates every 40 s, alerts every 2 minutes: 5,760 calls
// a day, a quarter of the daily allowance, so a shared Cloudflare address
// leaves room for others. A 429 backs off like any failure (cycle.js).
// Later, with a consumer key (JP_ODPT_CONSUMER_KEY, not yet approved):
// Tokyo Metro, JR East and the others on api.odpt.org under ODPT's Basic
// Licence.

const CLIENT = "Metranos-TrainRadar";
const BASE = "https://api-public.odpt.org/api/v4/gtfs/realtime/";

const VP = { name: "vehicle_positions.pb", path: "toei_odpt_train_vehicle" };
const TU = { name: "trip_updates.pb", path: "toei_odpt_train_trip_update" };
const AL = { name: "alerts.pb", path: "toei_odpt_train_alert" };

/** One turn of eight calls (2 minutes), in order. */
const TURN = [VP, TU, VP, TU, VP, TU, VP, AL];

export const JP = {
  code: "jp",
  prefix: "jp/rt/",
  base: BASE,
  cycleMs: 15_000,
  rotate: true,
  feeds: TURN,
  source: "Tokyo Metropolitan Bureau of Transportation (Toei) / 公共交通オープンデータセンター (ODPT), GTFS-Realtime, CC BY 4.0",
  // The Worker's JP_ENABLED is set from the GitHub variable JP_LIVE_ENABLED.
  enabled: (env) => env.JP_ENABLED === "true",
  missing: () => null,
  headers: () => ({ accept: "application/x-protobuf", "user-agent": CLIENT }),
  // Toei's feeds are its trains only: everything is kept.
  keep: () => null,
};
