// Export/import of the user's own data (phase C5): one versioned JSON file,
// saved through the share sheet (Android) or as a download (web). No
// location samples, ever. Import validates and merges without duplicates.

import { favKey, parseFavourites } from "./favourites.js";
import { parseTrips } from "./trips.js";

export const BACKUP_SCHEMA = 1;
const SETTINGS = ["lang", "basemap"];

export function backupName(now = new Date()) {
  return `trainradar-backup-${now.toISOString().slice(0, 10).replace(/-/g, "")}.json`;
}

export function makeBackup({ favourites = [], trips = [], settings = {} }, now = new Date()) {
  const s = Object.fromEntries(SETTINGS.filter((k) => typeof settings[k] === "string").map((k) => [k, settings[k]]));
  return JSON.stringify({ app: "trainradar", schema: BACKUP_SCHEMA, exportedAt: now.toISOString(), favourites, trips, settings: s }, null, 2);
}

/** Parse a backup file. Throws with a short reason when it isn't one. */
export function parseBackup(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error("not JSON");
  }
  if (!b || b.app !== "trainradar") throw new Error("not a TrainRadar backup");
  if (!Number.isInteger(b.schema) || b.schema < 1) throw new Error("unknown format");
  if (b.schema > BACKUP_SCHEMA) throw new Error("made by a newer version of the app");
  const settings = {};
  for (const k of SETTINGS) if (typeof b.settings?.[k] === "string" && b.settings[k].length < 20) settings[k] = b.settings[k];
  return { favourites: parseFavourites(JSON.stringify(b.favourites || [])), trips: parseTrips(JSON.stringify({ schema: 1, trips: b.trips || [] })), settings };
}

/** Favourites after an import: current ones first, then new ones, up to
 * `limit`. Returns `{ list, added, skipped }`. */
export function mergeFavourites(current, incoming, limit) {
  const list = [...current];
  const keys = new Set(current.map(favKey));
  let added = 0;
  let skipped = 0;
  for (const f of incoming) {
    if (keys.has(favKey(f))) continue;
    if (list.length >= limit) {
      skipped += 1;
      continue;
    }
    list.push(f);
    keys.add(favKey(f));
    added += 1;
  }
  return { list, added, skipped };
}

/** Trips after an import: every trip once (by id), oldest first. */
export function mergeTrips(current, incoming) {
  const ids = new Set(current.map((t) => t.id));
  return [...current, ...incoming.filter((t) => !ids.has(t.id))].sort((a, b) => a.startedAt - b.startedAt);
}
