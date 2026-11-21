// Where the app was left (map, and the train or station open), so it opens
// there next time. Kept on the device only (localStorage).

export const VIEW_KEY = "lastView";
/** A train or station left open longer ago than this isn't reopened. */
export const DETAIL_MAX_AGE_MS = 6 * 3_600_000;

const ID = /^[A-Za-z0-9._-]{1,40}$/;

function validDetail(d) {
  if (d?.type === "train" && ID.test(String(d.number ?? ""))) return { type: "train", number: String(d.number) };
  if (d?.type === "station" && ID.test(String(d.id ?? ""))) return { type: "station", id: String(d.id) };
  return null;
}

/** The view to save: `{country, center: [lon, lat], zoom, detail?}`. */
export function encodeView({ country, center, zoom, detail = null }, now = Date.now()) {
  return JSON.stringify({ country, center: center.map((x) => Math.round(x * 1e5) / 1e5), zoom: Math.round(zoom * 100) / 100, detail: validDetail(detail), at: now });
}

/**
 * The saved view for `country`, or null. The map position is always
 * restored; the open train or station only when recent.
 */
export function decodeView(json, { country, now = Date.now() } = {}) {
  let v;
  try {
    v = JSON.parse(json || "null");
  } catch {
    return null;
  }
  if (!v || v.country !== country || !Array.isArray(v.center)) return null;
  const [lon, lat] = v.center.map(Number);
  const zoom = Number(v.zoom);
  if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 85 && zoom >= 0 && zoom <= 22)) return null;
  const fresh = Number.isFinite(v.at) && now - v.at >= 0 && now - v.at < DETAIL_MAX_AGE_MS;
  return { center: [lon, lat], zoom, detail: fresh ? validDetail(v.detail) : null };
}
