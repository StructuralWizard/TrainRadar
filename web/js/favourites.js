// Favourite trains and stations. Free: up to FREE_LIMIT (Pro, phase C5,
// lifts it). Stored with native.js `prefs` (Android backs it up).

export const FREE_LIMIT = 2;
export const STORAGE_KEY = "favourites";

const ID = /^[A-Za-z0-9._-]{1,40}$/;

export function favKey(f) {
  return f.type === "train" ? `train:${String(f.number).replace(/^0+/, "")}` : `station:${f.id}`;
}

/** Saved favourites, dropping anything malformed. */
export function parseFavourites(json) {
  let list;
  try {
    list = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const f of list) {
    let v = null;
    if (f?.type === "train" && ID.test(String(f.number ?? ""))) {
      v = { type: "train", number: String(f.number), label: String(f.label || f.number).slice(0, 80) };
    } else if (f?.type === "station" && ID.test(String(f.id ?? "")) && Number.isFinite(f.lon) && Number.isFinite(f.lat)) {
      v = { type: "station", id: String(f.id), name: String(f.name || f.id).slice(0, 80), lon: f.lon, lat: f.lat };
    }
    if (v && !seen.has(favKey(v))) {
      seen.add(favKey(v));
      out.push(v);
    }
  }
  return out;
}

export function isFavourite(list, f) {
  const k = favKey(f);
  return list.some((x) => favKey(x) === k);
}

/** Add or remove `f`. Returns `{list, added, full}`; `full` means it wasn't
 * added because the limit is reached. */
export function toggleFavourite(list, f, limit = FREE_LIMIT) {
  if (isFavourite(list, f)) return { list: list.filter((x) => favKey(x) !== favKey(f)), added: false, full: false };
  if (list.length >= limit) return { list, added: false, full: true };
  return { list: [...list, f], added: true, full: false };
}
