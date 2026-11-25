// Australia: New South Wales and Victoria's GTFS-Realtime, GPS vehicle
// positions, trip updates and alerts, as one country's files.
//
// New South Wales: Transport for NSW (Sydney Trains, NSW TrainLink, Sydney
// Metro), the key AU_NSW_API_KEY (AGENTS.md) only in the Authorization
// header ("apikey …"). Which version of each answered and matched the
// timetable (tools/au/nsw-probe.mjs, Nov 2026): Sydney Trains v2, NSW
// TrainLink v1, Sydney Metro v2; alerts v2 for all three. The default quota
// is 60,000 calls a day.
//
// Victoria: Transport Victoria's open data API (Metro Trains, V/Line), the
// key AU_VIC_API_KEY only in the KeyID header; 24 calls a minute per feed.
// On with the Worker's AU_VIC_LIVE (GitHub variable AU_VIC_LIVE_ENABLED);
// when it's off, Victoria's turns go to Sydney Trains' GPS.
//
// One call every 5 s, the two states in turn: each state's call every 10 s
// (New South Wales: 8,640 calls a day). Sydney Trains' GPS and Melbourne's
// Metro GPS every other call of their state (every 20 s), each other feed
// every minute or two. Each operator's feed is a part of the country's
// vehicle_positions.pb, trip_updates.pb and alerts.pb.

const CLIENT = "Metranos-TrainRadar";
const NSW = "https://api.transport.nsw.gov.au/";
const VIC = "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/";

const part = (name, path, file, state = "nsw") => ({ name, path, part: file, state });
const VP_SYD = part("vp_sydneytrains.pb", "v2/gtfs/vehiclepos/sydneytrains", "vehicle_positions.pb");
const VP_NSW = part("vp_nswtrains.pb", "v1/gtfs/vehiclepos/nswtrains", "vehicle_positions.pb");
const VP_METRO = part("vp_metro.pb", "v2/gtfs/vehiclepos/metro", "vehicle_positions.pb");
const TU_SYD = part("tu_sydneytrains.pb", "v2/gtfs/realtime/sydneytrains", "trip_updates.pb");
const TU_NSW = part("tu_nswtrains.pb", "v1/gtfs/realtime/nswtrains", "trip_updates.pb");
const TU_METRO = part("tu_metro.pb", "v2/gtfs/realtime/metro", "trip_updates.pb");
const AL_SYD = part("al_sydneytrains.pb", "v2/gtfs/alerts/sydneytrains", "alerts.pb");
const AL_NSW = part("al_nswtrains.pb", "v2/gtfs/alerts/nswtrains", "alerts.pb");
const AL_METRO = part("al_metro.pb", "v2/gtfs/alerts/metro", "alerts.pb");

const VP_MTM = part("vp_vic_metro.pb", "metro/vehicle-positions", "vehicle_positions.pb", "vic");
const VP_VL = part("vp_vic_vline.pb", "vline/vehicle-positions", "vehicle_positions.pb", "vic");
const TU_MTM = part("tu_vic_metro.pb", "metro/trip-updates", "trip_updates.pb", "vic");
const TU_VL = part("tu_vic_vline.pb", "vline/trip-updates", "trip_updates.pb", "vic");
const AL_MTM = part("al_vic_metro.pb", "metro/service-alerts", "alerts.pb", "vic");
const AL_VL = part("al_vic_vline.pb", "vline/service-alerts", "alerts.pb", "vic");

/** New South Wales: one turn of 16 calls, in order. */
const TURN = [
  VP_SYD, TU_SYD, VP_SYD, VP_NSW, VP_SYD, TU_NSW, VP_SYD, VP_METRO,
  VP_SYD, TU_METRO, VP_SYD, TU_SYD, VP_SYD, AL_SYD, VP_SYD, AL_NSW,
];
// Metro's alerts on every other turn, in place of NSW TrainLink's.
const TURN2 = TURN.map((f) => (f === AL_NSW ? AL_METRO : f));
const NSW_CALLS = [...TURN, ...TURN2];

/** Victoria: 16 calls, twice. */
const VTURN = [
  VP_MTM, TU_MTM, VP_MTM, VP_VL, VP_MTM, TU_VL, VP_MTM, AL_MTM,
  VP_MTM, TU_MTM, VP_MTM, VP_VL, VP_MTM, TU_VL, VP_MTM, AL_VL,
];
const VIC_CALLS = [...VTURN, ...VTURN];

/** The two states in turn: New South Wales, Victoria, … (64 calls). */
const FEEDS = NSW_CALLS.flatMap((f, i) => [f, VIC_CALLS[i]]);

const vicOn = (env) => env.AU_VIC_LIVE === "true" && !!env.AU_VIC_API_KEY;

export const AU = {
  code: "au",
  prefix: "au/rt/",
  base: NSW,
  cycleMs: 5_000,
  rotate: true,
  feeds: FEEDS,
  parts: {
    "vehicle_positions.pb": [VP_SYD.name, VP_NSW.name, VP_METRO.name, VP_MTM.name, VP_VL.name],
    "trip_updates.pb": [TU_SYD.name, TU_NSW.name, TU_METRO.name, TU_MTM.name, TU_VL.name],
    "alerts.pb": [AL_SYD.name, AL_NSW.name, AL_METRO.name, AL_MTM.name, AL_VL.name],
  },
  source:
    "Transport for NSW (Sydney Trains, NSW TrainLink, Sydney Metro) and Transport Victoria (Metro Trains, V/Line), GTFS-Realtime, CC BY 4.0",
  // The Worker's AU_ENABLED is set from the GitHub variable AU_NSW_LIVE_ENABLED.
  enabled: (env) => env.AU_ENABLED === "true" && !!env.AU_NSW_API_KEY,
  missing: (env) => (env.AU_NSW_API_KEY ? null : "no API key (AU_NSW_API_KEY)"),
  // Victoria's turn, while it's off, goes to the first feed (Sydney Trains' GPS).
  ready: (env, feed) => feed.state !== "vic" || vicOn(env),
  url: (env, feed) => (feed.state === "vic" ? VIC : NSW) + feed.path,
  headers: (env, feed) =>
    feed?.state === "vic"
      ? { KeyID: env.AU_VIC_API_KEY, "user-agent": CLIENT, accept: "application/x-protobuf" }
      : { authorization: `apikey ${env.AU_NSW_API_KEY}`, "user-agent": CLIENT, accept: "application/x-google-protobuf" },
  keep: () => null,
};
