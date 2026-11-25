// New Zealand: Metlink's (Wellington) and Auckland Transport's
// GTFS-Realtime, cut to trains: GPS vehicle positions, trip updates and
// alerts. Keys (AGENTS.md), each only in its own request header:
// NZ_METLINK_API_KEY in x-api-key, NZ_AT_API_KEY in
// Ocp-Apim-Subscription-Key. Both answer in protobuf
// (tools/nz/rt-probe.mjs, Nov 2026), every mode in one feed: Metlink's
// trains are the trips "…__RAIL__…" and routes 2–6, Auckland's the routes
// E-W, S-C, O-W (Auckland One Rail) and HUIA (Te Huia).
//
// One call every 8 s, the two regions in turn: each region's GPS about
// every 32 s, trip updates every 48 s, alerts every 96 s (5,400 calls a
// day per key). Each region's feed is a part of the country's
// vehicle_positions.pb, trip_updates.pb and alerts.pb.

import { alertTargets, entityTrip } from "./gtfsrt.js";

const CLIENT = "Metranos-TrainRadar";
const WLG = "https://api.opendata.metlink.org.nz/v1/";
const AKL = "https://api.at.govt.nz/realtime/legacy/";

const part = (name, region, path, file) => ({ name, region, path, part: file });
const VP_WLG = part("vp_wlg.pb", "wlg", "gtfs-rt/vehiclepositions", "vehicle_positions.pb");
const VP_AKL = part("vp_akl.pb", "akl", "vehiclelocations", "vehicle_positions.pb");
const TU_WLG = part("tu_wlg.pb", "wlg", "gtfs-rt/tripupdates", "trip_updates.pb");
const TU_AKL = part("tu_akl.pb", "akl", "tripupdates", "trip_updates.pb");
const AL_WLG = part("al_wlg.pb", "wlg", "gtfs-rt/servicealerts", "alerts.pb");
const AL_AKL = part("al_akl.pb", "akl", "servicealerts", "alerts.pb");

/** One turn of 12 calls (96 s), in order. */
const TURN = [VP_AKL, VP_WLG, TU_AKL, TU_WLG, VP_AKL, VP_WLG, TU_AKL, TU_WLG, VP_AKL, VP_WLG, AL_AKL, AL_WLG];

const WLG_RAIL_ROUTES = new Set(["2", "3", "4", "5", "6"]);
/** A Metlink trip or route that is a train. */
export const isWellingtonRail = (tripId, routeId) =>
  (!!tripId && tripId.includes("__RAIL__")) || WLG_RAIL_ROUTES.has(routeId || "");
/** An Auckland Transport route that is a train. */
export const isAucklandRail = (routeId) => /^(E-W|S-C|O-W|HUIA)(-|$)/.test(routeId || "");

const railTrip = (region) => (entity) => {
  const { tripId, routeId } = entityTrip(entity);
  return region === "wlg" ? isWellingtonRail(tripId, routeId) : isAucklandRail(routeId);
};
/** Alerts that name a train line or trip (not stop-only notices: most are
 * about bus stops). */
const railAlert = (region) => (entity) =>
  alertTargets(entity).some((t) =>
    region === "wlg"
      ? isWellingtonRail(t.tripId, t.route || t.tripRoute)
      : isAucklandRail(t.route) || isAucklandRail(t.tripRoute),
  );

const FEEDS = [VP_WLG, VP_AKL, TU_WLG, TU_AKL, AL_WLG, AL_AKL];

export const NZ = {
  code: "nz",
  prefix: "nz/rt/",
  base: AKL,
  cycleMs: 8_000,
  rotate: true,
  feeds: TURN,
  parts: {
    "vehicle_positions.pb": [VP_WLG.name, VP_AKL.name],
    "trip_updates.pb": [TU_WLG.name, TU_AKL.name],
    "alerts.pb": [AL_WLG.name, AL_AKL.name],
  },
  source: "Metlink (Greater Wellington Regional Council) and Auckland Transport, GTFS-Realtime, CC BY 4.0",
  // The Worker's NZ_ENABLED is set from the GitHub variable NZ_LIVE_ENABLED.
  enabled: (env) => env.NZ_ENABLED === "true" && !!env.NZ_METLINK_API_KEY && !!env.NZ_AT_API_KEY,
  missing: (env) => {
    const no = ["NZ_METLINK_API_KEY", "NZ_AT_API_KEY"].filter((k) => !env[k]);
    return no.length ? `no API key (${no.join(", ")})` : null;
  },
  url: (env, feed) => (feed.region === "wlg" ? WLG : AKL) + feed.path,
  headers: (env, feed) => ({
    ...(feed.region === "wlg" ? { "x-api-key": env.NZ_METLINK_API_KEY } : { "Ocp-Apim-Subscription-Key": env.NZ_AT_API_KEY }),
    accept: "application/x-protobuf",
    "user-agent": CLIENT,
  }),
  keep: (name) => {
    const f = FEEDS.find((x) => x.name === name);
    if (!f) return null;
    return f.part === "alerts.pb" ? railAlert(f.region) : railTrip(f.region);
  },
};
