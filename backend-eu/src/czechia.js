// Czechia: live data for PID's trains (Prague Integrated Transport: Prague
// and Central Bohemia) from Golemio, the City of Prague's data platform.
// Its GTFS-Realtime feeds are open (no key) and hold every PID vehicle
// (buses, trams, metro, trains): kept here to trains, whose vehicle id is
// "train-<national train number>". The rest of the country goes by
// timetable. The app matches the trains to CIS JŘ's timetable by that
// number (engine: nordic::Czechia).

import { sub, str } from "./protobuf.js";

const CLIENT = "Metranos-TrainRadar";

/** A trip update's (field 3) or vehicle position's (field 8) vehicle id. */
function vehicleId(entity) {
  const tu = sub(entity, 3);
  if (tu) return str(sub(tu, 3), 1);
  const vp = sub(entity, 4);
  return vp ? str(sub(vp, 8), 1) : "";
}
export const isCzechTrain = (entity) => vehicleId(entity).startsWith("train-");

export const CZ = {
  code: "cz",
  prefix: "cz/rt/",
  base: "https://api.golemio.cz/v2/vehiclepositions/gtfsrt/",
  cycleMs: 20_000,
  // GPS (about 0.5 MB) on most cycles; trip updates (about 4 MB, every PID
  // vehicle) every minute.
  feeds: [
    { name: "vehicle_positions.pb", path: "vehicle_positions.pb", every: 1 },
    { name: "trip_updates.pb", path: "trip_updates.pb", every: 3 },
  ],
  source: "ROPID / Golemio (Prague Integrated Transport), GTFS-Realtime",
  // The Worker's CZ_ENABLED is set from the GitHub variable CZ_LIVE_ENABLED.
  enabled: (env) => env.CZ_ENABLED === "true",
  missing: () => null,
  headers: () => ({ "user-agent": `${CLIENT} (+https://mytrainradar.com)`, accept: "application/x-protobuf" }),
  keep: () => isCzechTrain,
};
