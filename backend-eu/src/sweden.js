// Sweden (M3): Trafiklab's GTFS Sweden 3 Realtime. The feeds come one per
// region (Skånetrafiken, SL, UL…), with every bus and tram in it; their trip
// ids are GTFS Sweden 3's, the static file our timetable is cut from. So:
// one region per cycle, in turn; keep the trips our timetable has (the
// list the deploy publishes as data/se/rail-trips.txt); and all regions'
// trains together make trip_updates.pb.
//
// Trafiklab takes its key only as `?key=` in the URL: an exception approved
// by the maintainer (AGENTS.md). The URL is never logged or stored; errors
// name the region.

import { entityTrip } from "./gtfsrt.js";

const CLIENT = "Metranos-TrainRadar";

/** Regions with realtime data (Trafiklab's GTFS Sweden 3 page, Nov 2026;
 * Halland's answered 404 on 22 Nov 2026),
 * the ones where trains run: Pågatåg and Öresundståg (skane), SL's
 * pendeltåg, Upptåget, Östgötapendeln, Krösatåg, Kustpilen, Tåg i
 * Bergslagen, Norrtåg… */
export const SE_REGIONS = [
  "skane",
  "sl",
  "ul",
  "otraf",
  "jlt",
  "krono",
  "klt",
  "blekinge",
  "varm",
  "orebro",
  "vastmanland",
  "dt",
  "xt",
  "dintur",
];

/** Our trains' trip ids, from the site (refreshed every 6 hours). */
const TRIPS_TTL_MS = 6 * 3_600_000;
let trips = { set: null, at: 0 };

export async function railTrips(env, fetchFn = fetch, now = Date.now()) {
  if (trips.set && now - trips.at < TRIPS_TTL_MS) return trips.set;
  const url = env.SE_RAIL_TRIPS_URL || "https://mytrainradar.com/data/se/rail-trips.txt";
  const r = await fetchFn(url, { headers: { "user-agent": CLIENT } });
  if (!r.ok) {
    if (trips.set) return trips.set; // keep the last list
    throw new Error(`rail-trips.txt: HTTP ${r.status}`);
  }
  trips = { set: new Set((await r.text()).split("\n").filter(Boolean)), at: now };
  return trips.set;
}
export const resetRailTrips = () => (trips = { set: null, at: 0 });

const feeds = SE_REGIONS.map((op) => ({ name: `tu_${op}.pb`, path: `${op}/TripUpdatesSweden.pb`, part: "trip_updates.pb" }));

export const SE = {
  code: "se",
  prefix: "se/rt/",
  base: "https://opendata.samtrafiken.se/gtfs-rt-sweden/",
  // A region every 8 s: each one about every 2 minutes, ~11,000 calls a
  // day (Silver allows 2 million a month).
  cycleMs: 8_000,
  rotate: true,
  feeds,
  parts: { "trip_updates.pb": feeds.map((f) => f.name) },
  source: "Samtrafiken / Trafiklab.se, GTFS Sweden 3 Realtime, CC0 1.0",
  enabled: (env) => env.SE_ENABLED === "true" && !!env.SE_TRAFIKLAB_RT_KEY,
  missing: (env) => (env.SE_TRAFIKLAB_RT_KEY ? null : "no API key (SE_TRAFIKLAB_RT_KEY)"),
  url: (env, feed) => `${SE.base}${feed.path}?key=${encodeURIComponent(env.SE_TRAFIKLAB_RT_KEY)}`,
  headers: () => ({ "user-agent": CLIENT, accept: "application/x-protobuf", "accept-encoding": "gzip" }),
  keep: async (_name, _bytes, { env, fetchFn, now }) => {
    const set = await railTrips(env, fetchFn, now);
    return (entity) => set.has(entityTrip(entity).tripId);
  },
};
