// Station boards at stations that Cercanías trains also serve (Chamartín,
// Sants, Atocha…): a dozen rows cover only the next few Cercanías minutes,
// so the few long-distance trains of the day (AVE, Avlo, Alvia, OUIGO…)
// fell off the list. Keep them, for the whole horizon, after the first rows.

/** Spain's long-distance timetables: Renfe AV/LD/MD and OUIGO. */
export const LONG_DISTANCE = new Set(["ld", "ouigo"]);

/** The first `first` rows, then up to `extra` later long-distance ones
 * (rows in time order; still in time order after). */
export function keepLongDistance(rows, first, extra = 12) {
  const head = rows.slice(0, first);
  const more = rows.slice(first).filter((r) => LONG_DISTANCE.has(r.region)).slice(0, extra);
  return [...head, ...more];
}
