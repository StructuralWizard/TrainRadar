// The website's world view, live part: every ten minutes, how many trains
// each country has live data for, read from the status.json files the
// pollers already write to the live bucket (Spain's backend/, the UK's
// backend-uk/, and this Worker's countries). No call to any provider: R2
// reads only. Written to world/live.json, which the page reads instead of
// every country's status.json; the timetable side (stations, lines,
// trains by half hour, the network) is data/world.json from the deploy.

/** Each country's status.json in the live bucket. */
export const STATUS_KEYS = {
  es: "rt/status.json",
  uk: "uk/rt/status.json",
  ...Object.fromEntries(
    ["ie", "fr", "fi", "no", "nl", "ch", "pl", "se", "cz", "dk", "de", "be", "au", "nz", "sg", "jp"].map((c) => [c, `${c}/rt/status.json`]),
  ),
};
export const WORLD_KEY = "world/live.json";
/** Written on the cron's minutes divisible by this. */
export const EVERY_MIN = 10;
/** A status older than this isn't live any more. */
export const STALE_MS = 15 * 60_000;

/** How many trains a status.json says have live data: the largest trip
 * updates or vehicle positions feed's kept entities; null when it doesn't
 * say. */
export function liveCount(st) {
  const n = Object.entries(st?.feeds || {})
    .filter(([name]) => /trip_updates|vehicle_positions|tu_|vp_/.test(name))
    .map(([, f]) => f.kept ?? f.entities)
    .filter(Number.isFinite);
  return n.length ? Math.max(...n) : null;
}

export async function writeWorld(env, now = Date.now()) {
  const countries = {};
  for (const [code, key] of Object.entries(STATUS_KEYS)) {
    try {
      const o = await env.LIVE.get(key);
      if (!o) continue;
      const st = JSON.parse(await o.text());
      const at = Date.parse(st.updatedAt || st.generatedAt || "") || null;
      const fresh = at !== null && now - at < STALE_MS;
      countries[code] = { live: fresh ? liveCount(st) : null, ok: fresh && st.ok !== false, updatedAt: at ? new Date(at).toISOString() : null };
    } catch {
      countries[code] = { live: null, ok: false, updatedAt: null };
    }
  }
  const doc = { updatedAt: new Date(now).toISOString(), everyMinutes: EVERY_MIN, countries };
  await env.LIVE.put(WORLD_KEY, JSON.stringify(doc), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=300" },
  });
  return doc;
}
