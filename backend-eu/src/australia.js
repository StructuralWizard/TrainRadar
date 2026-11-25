// New South Wales: Transport for NSW's GTFS-Realtime (Sydney Trains, NSW
// TrainLink, Sydney Metro): GPS vehicle positions, trip updates and alerts,
// with the key AU_NSW_API_KEY (AGENTS.md) only in the Authorization header
// ("apikey …"). Which version of each answered and matched the timetable
// (tools/au/nsw-probe.mjs, Nov 2026): Sydney Trains v2, NSW TrainLink v1,
// Sydney Metro v2; alerts v2 for all three.
//
// The default quota is 60,000 calls a day: one call every 8 s (10,800 a
// day). Sydney Trains' GPS every other call (every 16 s), each other feed
// about every two minutes. Each operator's feed is a part of the country's
// vehicle_positions.pb, trip_updates.pb and alerts.pb.

const CLIENT = "Metranos-TrainRadar";

const part = (name, path, file) => ({ name, path, part: file });
const VP_SYD = part("vp_sydneytrains.pb", "v2/gtfs/vehiclepos/sydneytrains", "vehicle_positions.pb");
const VP_NSW = part("vp_nswtrains.pb", "v1/gtfs/vehiclepos/nswtrains", "vehicle_positions.pb");
const VP_METRO = part("vp_metro.pb", "v2/gtfs/vehiclepos/metro", "vehicle_positions.pb");
const TU_SYD = part("tu_sydneytrains.pb", "v2/gtfs/realtime/sydneytrains", "trip_updates.pb");
const TU_NSW = part("tu_nswtrains.pb", "v1/gtfs/realtime/nswtrains", "trip_updates.pb");
const TU_METRO = part("tu_metro.pb", "v2/gtfs/realtime/metro", "trip_updates.pb");
const AL_SYD = part("al_sydneytrains.pb", "v2/gtfs/alerts/sydneytrains", "alerts.pb");
const AL_NSW = part("al_nswtrains.pb", "v2/gtfs/alerts/nswtrains", "alerts.pb");
const AL_METRO = part("al_metro.pb", "v2/gtfs/alerts/metro", "alerts.pb");

/** One turn of 16 calls (128 s), in order. */
const TURN = [
  VP_SYD, TU_SYD, VP_SYD, VP_NSW, VP_SYD, TU_NSW, VP_SYD, VP_METRO,
  VP_SYD, TU_METRO, VP_SYD, TU_SYD, VP_SYD, AL_SYD, VP_SYD, AL_NSW,
];
// Metro's alerts on every other turn, in place of NSW TrainLink's.
const TURN2 = TURN.map((f) => (f === AL_NSW ? AL_METRO : f));

export const AU = {
  code: "au",
  prefix: "au/rt/",
  base: "https://api.transport.nsw.gov.au/",
  cycleMs: 8_000,
  rotate: true,
  feeds: [...TURN, ...TURN2],
  parts: {
    "vehicle_positions.pb": [VP_SYD.name, VP_NSW.name, VP_METRO.name],
    "trip_updates.pb": [TU_SYD.name, TU_NSW.name, TU_METRO.name],
    "alerts.pb": [AL_SYD.name, AL_NSW.name, AL_METRO.name],
  },
  source: "Transport for NSW, GTFS-Realtime (Sydney Trains, NSW TrainLink, Sydney Metro), CC BY 4.0",
  // The Worker's AU_ENABLED is set from the GitHub variable AU_NSW_LIVE_ENABLED.
  enabled: (env) => env.AU_ENABLED === "true" && !!env.AU_NSW_API_KEY,
  missing: (env) => (env.AU_NSW_API_KEY ? null : "no API key (AU_NSW_API_KEY)"),
  headers: (env) => ({
    authorization: `apikey ${env.AU_NSW_API_KEY}`,
    "user-agent": CLIENT,
    accept: "application/x-google-protobuf",
  }),
  keep: () => null,
};
