// Cab-ride videos on YouTube at each station (docs/plan-cab-rides.md):
// <country data>/cabrides.json, written by tools/cabrides/build.py from
// refdata/cabrides/. Stations are matched by name, normalised the way the
// database's station keys are (lower case, no accents or punctuation).
// Rows are text only and open YouTube at the moment: no thumbnails or
// embedded player, so nothing loads from Google until the user taps.

/** A station name as the database's station_key: build_all.py's norm(). */
export function norm(name) {
  let n = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  n = n.replace(/&/g, " ").replace(/['’]/g, "");
  n = n.replace(/^(estacion|estacio|apeadero) de /, "");
  return n.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Words that differ between the app's names and the videos' only in form. */
function canon(k) {
  return k
    .replace(/\bhauptbahnhof\b/g, "hbf")
    .replace(/\b(railway station|train station|station|stazione|estacion|gare|bahnhof|bf)$/g, "")
    .replace(/^(gare de|gare d|stazione di|bahnhof) /, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Separators between two names in one stop (not a plain hyphen, which
 * many names have: "Budapest-Déli"). */
const PARTS = /\s+[-–—]\s+|\s*[\/→]\s*|\s*->\s*|\s*–\s*|\s*—\s*/;

/** The YouTube address that opens video `id` at `t` seconds. */
export const videoUrl = (id, t) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.max(0, Math.round(t))}s`;

/** "41:10" or "1:02:05". */
export function clock(t) {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** An index over one country's file: station key → [video, stop index]. */
export function indexRides(doc) {
  const alias = doc?.alias || {};
  const videos = (doc?.videos || []).map(([id, title, channel, quality, view, stops]) => ({
    id,
    title,
    channel,
    quality,
    view,
    stops: stops.map(([key, name, t, real]) => ({ key: canon(key), name, t, real: !!real })),
  }));
  const at = new Map();
  const add = (k, vi, si) => {
    if (!k) return;
    if (!at.has(k)) at.set(k, []);
    const l = at.get(k);
    if (!l.some(([v, s]) => v === vi && s === si)) l.push([vi, si]);
  };
  videos.forEach((v, vi) =>
    v.stops.forEach((s, si) => {
      add(s.key, vi, si);
      // "Solothurn / Soleure", or a chapter naming a stretch, "Jyväskylä –
      // Rautpohja": each part too.
      const parts = s.name.split(PARTS);
      if (parts.length > 1) for (const part of parts) add(canon(norm(part)), vi, si);
    }),
  );
  return { videos, at, alias };
}

/** The station key the videos use for an app station name, or null. */
export function stationKey(idx, name) {
  const hit = (n) => {
    const k = canon(idx.alias[n] || n);
    if (idx.at.has(k)) return k;
    const a = idx.alias[k];
    return a && idx.at.has(canon(a)) ? canon(a) : null;
  };
  const n = norm(name);
  // As it is; without a short suffix (a Swiss canton "Renens VD", "Bf",
  // Hungarian "pu", Slovak "zast."); or the part before a spaced dash,
  // "Madrid-Puerta de Atocha - Almudena Grandes".
  const tries = [n, n.replace(/ ([a-z]{2}|bf|obec|zast)$/, "")];
  const dash = String(name || "").split(/\s+[-–—]\s+/);
  if (dash.length > 1) tries.push(norm(dash[0]));
  for (const k of tries) {
    const h = hit(k);
    if (h) return h;
  }
  return null;
}

/** Videos that pass a station, best first, one moment each:
 * [{ id, title, channel, t, real, url }]. */
export function videosAt(idx, name) {
  const k = idx && stationKey(idx, name);
  if (!k) return [];
  const seen = new Set();
  const out = [];
  for (const [vi, si] of idx.at.get(k)) {
    if (seen.has(vi)) continue;
    seen.add(vi);
    const v = idx.videos[vi];
    const s = v.stops[si];
    out.push({ id: v.id, title: v.title, channel: v.channel, t: s.t, real: s.real, url: videoUrl(v.id, s.t) });
  }
  return out;
}

/**
 * A video of the stretch a train is on: one that passes its previous stop
 * and then its next one (at most four stations apart), opened where the
 * train is between them. `stops`: [{ name, time }] (unix seconds), `next`
 * the next stop's name, `now` unix seconds. { id, title, channel, t, url }
 * or null; `t` is always an estimate.
 */
export function videoForTrain(idx, stops, next, now) {
  if (!idx || !Array.isArray(stops) || stops.length < 2) return null;
  let b = -1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].name !== next) continue;
    if (b < 0 || Math.abs(stops[i].time - now) < Math.abs(stops[b].time - now)) b = i;
  }
  if (b < 1) return null;
  const A = stops[b - 1];
  const B = stops[b];
  const ka = stationKey(idx, A.name);
  const kb = stationKey(idx, B.name);
  if (!ka || !kb) return null;
  const span = B.time - A.time;
  const p = span > 0 ? Math.min(1, Math.max(0, (now - A.time) / span)) : 0;
  for (const [vi, si] of idx.at.get(ka)) {
    const v = idx.videos[vi];
    const sj = v.stops.findIndex((s, j) => j > si && j - si <= 4 && s.key === kb);
    if (sj < 0) continue;
    const t = v.stops[si].t + p * (v.stops[sj].t - v.stops[si].t);
    return { id: v.id, title: v.title, channel: v.channel, t, url: videoUrl(v.id, t) };
  }
  return null;
}

/** Kilometres between two [lon, lat]. */
function km(a, b) {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return 6371 * Math.hypot(x, y);
}

/**
 * The stretches the videos film, for the map's "Videos from the cab" layer:
 * one GeoJSON FeatureCollection of lines between consecutive filmed
 * stations the app has (a station the app lacks is skipped over, but not a
 * gap longer than `maxKm`: no line across the country) and points at those
 * stations, each with `n`, how many videos pass. `stations`: [{ name, lon,
 * lat }], the country's stations.
 */
export function ridesGeoJson(idx, stations, maxKm = 40) {
  const empty = { type: "FeatureCollection", features: [] };
  if (!idx || !Array.isArray(stations)) return empty;
  const at = new Map(); // station key → [lon, lat]
  for (const st of stations) {
    const k = stationKey(idx, st.name);
    if (k && !at.has(k) && Number.isFinite(st.lon) && Number.isFinite(st.lat)) at.set(k, [st.lon, st.lat]);
  }
  const segs = new Map(); // "a|b" (sorted keys) → { coords, n }
  const filmed = new Map(); // station key → videos passing
  idx.videos.forEach((v) => {
    let prev = null;
    const seen = new Set();
    for (const s of v.stops) {
      const p = at.get(s.key);
      if (!p) continue;
      if (!seen.has(s.key)) {
        seen.add(s.key);
        filmed.set(s.key, (filmed.get(s.key) || 0) + 1);
      }
      if (prev && prev.key !== s.key && km(prev.p, p) <= maxKm) {
        const id = [prev.key, s.key].sort().join("|");
        const seg = segs.get(id) || { coords: [prev.p, p], n: 0 };
        seg.n++;
        segs.set(id, seg);
      }
      prev = { key: s.key, p };
    }
  });
  const features = [];
  for (const seg of segs.values()) features.push({ type: "Feature", properties: { n: seg.n }, geometry: { type: "LineString", coordinates: seg.coords } });
  for (const [k, n] of filmed) features.push({ type: "Feature", properties: { n }, geometry: { type: "Point", coordinates: at.get(k) } });
  return { type: "FeatureCollection", features };
}

let loading = null;
let loadedFor = "";
/** One country's file, fetched once: from the first of `bases` (the
 * site's data folder, then the app's own copy) that has it; null if none. */
export function loadRides(bases) {
  const list = (Array.isArray(bases) ? bases : [bases]).filter(Boolean);
  const key = list.join(" ");
  if (loading && loadedFor === key) return loading;
  loadedFor = key;
  const get = async () => {
    for (const base of list) {
      try {
        const r = await fetch(`${base.replace(/\/?$/, "/")}cabrides.json`);
        if (r.ok) return indexRides(await r.json());
      } catch {
        // offline, or not there: the next one
      }
    }
    return null;
  };
  loading = get();
  return loading;
}
