// Origin → destination search: which stations stand for each end (a
// station, or every station of a city) and the trains between them, merged
// from the engine's per-pair answers (engine.commuteJson).
import { cityStations } from "./places.js";

/** At most this many stations per end: a city's main ones. */
export const MAX_ENDS = 10;

/**
 * The stations for one end: `{kind: "station", item}` → that station;
 * `{kind: "city", item}` → the city's stations, long-distance ones first
 * (services bit 1), then the nearest to the centre.
 */
export function endStations(end, stations, max = MAX_ENDS) {
  if (!end) return [];
  if (end.kind === "station") return [end.item];
  const list = cityStations(end.item, stations);
  const main = list.filter((s) => s.services & 1);
  const rest = list.filter((s) => !(s.services & 1));
  return [...main, ...rest].slice(0, max);
}

/**
 * Merge per-pair rows `[{from, to, rows}]` into one list: each train once
 * (its shortest ride between the two ends), not yet gone (`now` unix s),
 * by departure. Each row gains `from` and `to` (the stations).
 */
export function mergeRoutes(pairs, now, limit = 20) {
  const best = new Map();
  for (const { from, to, rows } of pairs) {
    for (const r of rows) {
      if (r.expected_dep < now - 60) continue;
      const k = `${r.trip_id}|${r.number}`;
      const ride = r.expected_arr - r.expected_dep;
      const prev = best.get(k);
      if (!prev || ride < prev.expected_arr - prev.expected_dep) best.set(k, { ...r, from, to });
    }
  }
  return [...best.values()].sort((a, b) => a.expected_dep - b.expected_dep || a.expected_arr - b.expected_arr).slice(0, limit);
}
