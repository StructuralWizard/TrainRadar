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

/** Favoritos' order: trains first, then stations, each as the user sorted them. */
export function favouritesInOrder(list) {
  return [...list.filter((f) => f.type === "train"), ...list.filter((f) => f.type === "station")];
}

/**
 * Move `f` to position `to` among the favourites of its own type (trains and
 * stations are sorted separately). Returns a new list, trains first.
 */
export function moveFavourite(list, f, to) {
  const ordered = favouritesInOrder(list);
  const same = ordered.filter((x) => x.type === f.type);
  const i = same.findIndex((x) => favKey(x) === favKey(f));
  if (i < 0) return ordered;
  const j = Math.max(0, Math.min(same.length - 1, Math.trunc(Number(to) || 0)));
  if (i === j) return ordered;
  const moved = [...same];
  moved.splice(j, 0, ...moved.splice(i, 1));
  const other = ordered.filter((x) => x.type !== f.type);
  return f.type === "train" ? [...moved, ...other] : [...other, ...moved];
}

/** The favourite `dir` (+1 / −1) places from `f` in Favoritos' order, or null. */
export function neighbourFavourite(list, f, dir) {
  const ordered = favouritesInOrder(list);
  const i = ordered.findIndex((x) => favKey(x) === favKey(f));
  if (i < 0) return null;
  return ordered[i + dir] ?? null;
}
