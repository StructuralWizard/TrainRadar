// Places to search and jump to: cities, provinces and autonomous
// communities of Spain, plus the matching rules for station names
// (accents and case ignored, words in any order, small typos forgiven).
//
// Province and community boxes are [south, west, north, east] in degrees,
// rounded outwards from the official boundaries (IGN, via
// github.com/codeforgermany/click_that_hood). City centres are the town
// centre; `r` is the radius in km that counts as "in the city".

/** Lower case, no accents, punctuation as spaces. */
export function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Edit distance with swaps of neighbours (optimal string alignment). */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Short words that say nothing about the place ("de", "la"…).
const STOP = new Set(["de", "del", "la", "las", "el", "los", "l", "d", "i", "y", "a", "en"]);

/**
 * How well `query` matches `name` (both raw text): 100 exact, 90 the name
 * starts with it, 80 every word starts a word of the name (any order), 70
 * inside, 40–60 with typos (one per 4–6 letters), -1 no match.
 */
export function matchScore(query, name) {
  const q = fold(query);
  const n = fold(name);
  if (!q || !n) return -1;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  const words = n.split(" ");
  const qw = q.split(" ").filter((w) => w && !STOP.has(w));
  if (!qw.length) return n.includes(q) ? 70 : -1;
  if (qw.every((w) => words.some((x) => x.startsWith(w)))) return 80;
  if (n.includes(q)) return 70;
  // Typos: each query word near the start of some word of the name.
  let cost = 0;
  for (const w of qw) {
    if (w.length < 3) {
      if (!words.some((x) => x.startsWith(w))) return -1;
      continue;
    }
    const allow = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
    let best = allow + 1;
    for (const x of words) {
      // The whole word, or its start when the query word is cut short.
      for (const part of new Set([x, x.slice(0, w.length - 1), x.slice(0, w.length), x.slice(0, w.length + 1)])) {
        if (part) best = Math.min(best, editDistance(w, part, allow));
      }
    }
    if (best > allow) return -1;
    cost += best;
  }
  return Math.max(40, 60 - 10 * cost);
}

/** Distance in km between two points (lat/lon degrees). */
export function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  const y = (lat2 - lat1) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * The stations of a city: within its radius, or named after it within
 * 30 km ("Getafe Industrial"). Nearest the centre first.
 */
export function cityStations(city, stations) {
  const names = [city.name, ...(city.alt || [])].map(fold);
  return stations
    .map((s) => ({ s, d: km(city.lat, city.lon, s.lat, s.lon) }))
    .filter(({ s, d }) => d <= city.r || (d <= 30 && names.some((n) => ` ${fold(s.name)} `.includes(` ${n} `))))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);
}

/** Box [s, w, n, e] around some points, or null. */
export function boxOf(points) {
  if (!points.length) return null;
  return [Math.min(...points.map((p) => p.lat)), Math.min(...points.map((p) => p.lon)), Math.max(...points.map((p) => p.lat)), Math.max(...points.map((p) => p.lon))];
}

/**
 * Search everything: `stations` [{id, name, lat, lon}], plus the cities,
 * provinces and communities below. Up to `limit` of {kind, item, score},
 * best first; a city beats its own stations, a station beats a province
 * of the same name only when it matches better.
 */
export function searchPlaces(query, stations, limit = 8, kinds = ["city", "station", "province", "community"]) {
  if (fold(query).length < 2) return [];
  const out = [];
  const add = (kind, item, names, bonus) => {
    let best = -1;
    for (const n of names) best = Math.max(best, matchScore(query, n));
    if (best >= 0) out.push({ kind, item, score: best + bonus });
  };
  if (kinds.includes("city")) for (const c of CITIES) add("city", c, [c.name, ...c.alt], 3);
  if (kinds.includes("station")) for (const s of stations) add("station", s, [s.name], 0);
  if (kinds.includes("province")) for (const p of PROVINCES) add("province", p, [p.name, ...p.alt], 1);
  if (kinds.includes("community")) for (const c of COMMUNITIES) add("community", c, [c.name, ...c.alt], 1);
  const rank = { city: 0, station: 1, province: 2, community: 3 };
  out.sort((a, b) => b.score - a.score || rank[a.kind] - rank[b.kind] || a.item.name.localeCompare(b.item.name, "es"));
  return out.slice(0, limit);
}

/**
 * "Madrid a Sevilla", "de Bilbao a León", "Madrid - Sevilla", "Sants →
 * Girona", "Madrid to Seville": {from, to} texts, or null.
 */
export function parseRoute(query) {
  const q = String(query || "").trim();
  const m =
    q.match(/^from\s+(.+?)\s+to\s+(.+)$/i) ||
    q.match(/^(?:de(?:sde)?\s+)?(.+?)\s+(?:a|hasta|to)\s+(.+)$/i) ||
    q.match(/^(.+?)\s*(?:→|->|>|⇒)\s*(.+)$/) ||
    q.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return null;
  const from = m[1].trim();
  const to = m[2].trim();
  return fold(from).length >= 2 && fold(to).length >= 2 ? { from, to } : null;
}

/** A place by its jump code ("prov:28", "ccaa:md", "city:madrid"), or null. */
export function placeByCode(code) {
  const [kind, id] = String(code).split(":");
  if (kind === "prov") return PROVINCES.find((p) => p.code === id) || null;
  if (kind === "ccaa") return COMMUNITIES.find((c) => c.code === id) || null;
  if (kind === "city") return CITIES.find((c) => c.code === id) || null;
  return null;
}

/** The box to show for a city: its radius around the centre. */
export function cityBox(c) {
  const dLat = c.r / 111;
  const dLon = c.r / (111 * Math.cos((c.lat * Math.PI) / 180));
  return [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon];
}

export const COMMUNITIES = [
  { code: "an", name: "Andalucía", alt: [], bbox: [35.93, -7.53, 38.73, -1.63] },
  { code: "ar", name: "Aragón", alt: [], bbox: [39.84, -2.18, 42.93, 0.78] },
  { code: "as", name: "Asturias", alt: ["Principado de Asturias"], bbox: [42.88, -7.19, 43.67, -4.51] },
  { code: "cn", name: "Canarias", alt: [], bbox: [27.63, -18.17, 29.42, -13.33] },
  { code: "cb", name: "Cantabria", alt: [], bbox: [42.75, -4.86, 43.52, -3.15] },
  { code: "cl", name: "Castilla y León", alt: [], bbox: [40.08, -7.08, 43.24, -1.77] },
  { code: "cm", name: "Castilla-La Mancha", alt: [], bbox: [38.02, -5.41, 41.33, -0.91] },
  { code: "ct", name: "Cataluña", alt: ["Catalunya"], bbox: [40.52, 0.15, 42.86, 3.34] },
  { code: "ce", name: "Ceuta", alt: [], bbox: [35.16, -5.43, 35.92, -4.29] },
  { code: "md", name: "Comunidad de Madrid", alt: [], bbox: [39.88, -4.58, 41.17, -3.05] },
  { code: "vc", name: "Comunitat Valenciana", alt: ["Comunidad Valenciana"], bbox: [37.84, -1.53, 40.79, 0.7] },
  { code: "ex", name: "Extremadura", alt: [], bbox: [37.94, -7.55, 40.49, -4.64] },
  { code: "ga", name: "Galicia", alt: [], bbox: [41.8, -9.31, 43.8, -6.73] },
  { code: "ib", name: "Illes Balears", alt: ["Baleares"], bbox: [38.64, 1.15, 40.1, 4.33] },
  { code: "ri", name: "La Rioja", alt: [], bbox: [41.91, -3.14, 42.65, -1.67] },
  { code: "ml", name: "Melilla", alt: [], bbox: [35.26, -2.98, 35.33, -2.92] },
  { code: "nc", name: "Navarra", alt: ["Nafarroa"], bbox: [41.91, -2.5, 43.32, -0.72] },
  { code: "pv", name: "País Vasco", alt: ["Euskadi"], bbox: [42.47, -3.45, 43.46, -1.72] },
  { code: "mc", name: "Región de Murcia", alt: [], bbox: [37.37, -2.35, 38.76, -0.64] },
];

export const PROVINCES = [
  { code: "15", name: "A Coruña", alt: ["La Coruña"], community: "ga", bbox: [42.45, -9.31, 43.8, -7.66] },
  { code: "02", name: "Albacete", alt: [], community: "cm", bbox: [38.02, -2.89, 39.42, -0.91] },
  { code: "03", name: "Alicante", alt: ["Alacant"], community: "vc", bbox: [37.84, -1.1, 38.89, 0.24] },
  { code: "04", name: "Almería", alt: [], community: "an", bbox: [35.93, -3.15, 37.92, -1.63] },
  { code: "33", name: "Asturias", alt: [], community: "as", bbox: [42.88, -7.19, 43.67, -4.51] },
  { code: "06", name: "Badajoz", alt: [], community: "ex", bbox: [37.94, -7.34, 39.46, -4.64] },
  { code: "08", name: "Barcelona", alt: [], community: "ct", bbox: [41.19, 1.35, 42.32, 2.78] },
  { code: "48", name: "Bizkaia", alt: ["Vizcaya"], community: "pv", bbox: [42.98, -3.45, 43.46, -2.41] },
  { code: "09", name: "Burgos", alt: [], community: "cl", bbox: [41.45, -4.34, 43.2, -2.51] },
  { code: "39", name: "Cantabria", alt: [], community: "cb", bbox: [42.75, -4.86, 43.52, -3.15] },
  { code: "12", name: "Castellón", alt: ["Castelló"], community: "vc", bbox: [39.71, -0.85, 40.79, 0.7] },
  { code: "51", name: "Ceuta", alt: [], community: "ce", bbox: [35.16, -5.43, 35.92, -4.29] },
  { code: "13", name: "Ciudad Real", alt: [], community: "cm", bbox: [38.34, -5.05, 39.58, -2.64] },
  { code: "16", name: "Cuenca", alt: [], community: "cm", bbox: [39.22, -3.17, 40.66, -1.14] },
  { code: "10", name: "Cáceres", alt: [], community: "ex", bbox: [39.03, -7.55, 40.49, -4.95] },
  { code: "11", name: "Cádiz", alt: [], community: "an", bbox: [36.0, -6.48, 37.06, -5.08] },
  { code: "14", name: "Córdoba", alt: [], community: "an", bbox: [37.18, -5.59, 38.73, -4.0] },
  { code: "20", name: "Gipuzkoa", alt: ["Guipúzcoa"], community: "pv", bbox: [42.89, -2.61, 43.4, -1.72] },
  { code: "17", name: "Girona", alt: ["Gerona"], community: "ct", bbox: [41.64, 1.72, 42.5, 3.34] },
  { code: "18", name: "Granada", alt: [], community: "an", bbox: [36.69, -4.33, 38.09, -2.2] },
  { code: "19", name: "Guadalajara", alt: [], community: "cm", bbox: [40.15, -3.55, 41.33, -1.53] },
  { code: "21", name: "Huelva", alt: [], community: "an", bbox: [36.79, -7.53, 38.21, -6.12] },
  { code: "22", name: "Huesca", alt: [], community: "ar", bbox: [41.34, -0.94, 42.93, 0.78] },
  { code: "07", name: "Illes Balears", alt: ["Baleares"], community: "ib", bbox: [38.64, 1.15, 40.1, 4.33] },
  { code: "23", name: "Jaén", alt: [], community: "an", bbox: [37.37, -4.29, 38.54, -2.43] },
  { code: "26", name: "La Rioja", alt: [], community: "ri", bbox: [41.91, -3.14, 42.65, -1.67] },
  { code: "35", name: "Las Palmas", alt: [], community: "cn", bbox: [27.73, -15.84, 29.42, -13.33] },
  { code: "24", name: "León", alt: [], community: "cl", bbox: [42.03, -7.08, 43.24, -4.73] },
  { code: "25", name: "Lleida", alt: ["Lérida"], community: "ct", bbox: [41.27, 0.32, 42.86, 1.86] },
  { code: "27", name: "Lugo", alt: [], community: "ga", bbox: [42.32, -8.0, 43.77, -6.81] },
  { code: "28", name: "Madrid", alt: [], community: "md", bbox: [39.88, -4.58, 41.17, -3.05] },
  { code: "52", name: "Melilla", alt: [], community: "ml", bbox: [35.26, -2.98, 35.33, -2.92] },
  { code: "30", name: "Murcia", alt: [], community: "mc", bbox: [37.37, -2.35, 38.76, -0.64] },
  { code: "29", name: "Málaga", alt: [], community: "an", bbox: [36.31, -5.61, 37.28, -3.76] },
  { code: "31", name: "Navarra", alt: ["Nafarroa"], community: "nc", bbox: [41.91, -2.5, 43.32, -0.72] },
  { code: "32", name: "Ourense", alt: ["Orense"], community: "ga", bbox: [41.8, -8.37, 42.58, -6.73] },
  { code: "34", name: "Palencia", alt: [], community: "cl", bbox: [41.75, -5.04, 43.06, -3.89] },
  { code: "36", name: "Pontevedra", alt: [], community: "ga", bbox: [41.86, -8.95, 42.86, -7.86] },
  { code: "37", name: "Salamanca", alt: [], community: "cl", bbox: [40.23, -6.94, 41.29, -5.08] },
  { code: "38", name: "Santa Cruz de Tenerife", alt: ["Tenerife"], community: "cn", bbox: [27.63, -18.17, 28.86, -16.11] },
  { code: "40", name: "Segovia", alt: [], community: "cl", bbox: [40.63, -4.73, 41.59, -3.2] },
  { code: "41", name: "Sevilla", alt: [], community: "an", bbox: [36.84, -6.54, 38.2, -4.65] },
  { code: "42", name: "Soria", alt: [], community: "cl", bbox: [41.05, -3.55, 42.15, -1.77] },
  { code: "43", name: "Tarragona", alt: [], community: "ct", bbox: [40.52, 0.15, 41.58, 1.65] },
  { code: "44", name: "Teruel", alt: [], community: "ar", bbox: [39.84, -1.81, 41.36, 0.3] },
  { code: "45", name: "Toledo", alt: [], community: "cm", bbox: [39.25, -5.41, 40.32, -2.9] },
  { code: "46", name: "Valencia", alt: ["València"], community: "vc", bbox: [38.68, -1.53, 40.21, -0.02] },
  { code: "47", name: "Valladolid", alt: [], community: "cl", bbox: [41.09, -5.52, 42.32, -3.98] },
  { code: "49", name: "Zamora", alt: [], community: "cl", bbox: [41.11, -7.04, 42.26, -5.22] },
  { code: "50", name: "Zaragoza", alt: [], community: "ar", bbox: [40.93, -2.18, 42.75, 0.39] },
  { code: "01", name: "Álava", alt: ["Araba"], community: "pv", bbox: [42.47, -3.29, 43.22, -2.23] },
  { code: "05", name: "Ávila", alt: [], community: "cl", bbox: [40.08, -5.74, 41.17, -4.16] },
];

// Cities with train stations: every provincial capital and the larger
// towns. [code, name, other names, lat, lon, radius km]
const CITY_ROWS = [
  ["a-coruna", "A Coruña", ["La Coruña", "Coruña"], 43.362, -8.411, 4],
  ["albacete", "Albacete", [], 38.995, -1.856, 4],
  ["alcala-de-henares", "Alcalá de Henares", [], 40.482, -3.364, 5],
  ["algeciras", "Algeciras", [], 36.128, -5.453, 4],
  ["alicante", "Alicante", ["Alacant"], 38.345, -0.483, 5],
  ["almeria", "Almería", [], 36.834, -2.464, 4],
  ["avila", "Ávila", [], 40.656, -4.700, 3],
  ["badajoz", "Badajoz", [], 38.879, -6.970, 4],
  ["badalona", "Badalona", [], 41.450, 2.247, 3],
  ["barcelona", "Barcelona", [], 41.387, 2.170, 7],
  ["bilbao", "Bilbao", ["Bilbo"], 43.263, -2.935, 5],
  ["burgos", "Burgos", [], 42.344, -3.697, 4],
  ["caceres", "Cáceres", [], 39.475, -6.372, 4],
  ["cadiz", "Cádiz", [], 36.529, -6.292, 3],
  ["cartagena", "Cartagena", [], 37.606, -0.986, 4],
  ["castellon", "Castellón de la Plana", ["Castellón", "Castelló", "Castelló de la Plana"], 39.986, -0.051, 4],
  ["ciudad-real", "Ciudad Real", [], 38.985, -3.927, 4],
  ["cordoba", "Córdoba", [], 37.888, -4.779, 5],
  ["cuenca", "Cuenca", [], 40.070, -2.137, 6],
  ["elche", "Elche", ["Elx"], 38.267, -0.698, 4],
  ["ferrol", "Ferrol", [], 43.484, -8.233, 3],
  ["figueres", "Figueres", ["Figueras"], 42.266, 2.961, 3],
  ["getafe", "Getafe", [], 40.306, -3.733, 4],
  ["gijon", "Gijón", ["Xixón"], 43.532, -5.661, 5],
  ["girona", "Girona", ["Gerona"], 41.979, 2.821, 4],
  ["granada", "Granada", [], 37.177, -3.599, 5],
  ["guadalajara", "Guadalajara", [], 40.633, -3.167, 6],
  ["huelva", "Huelva", [], 37.261, -6.945, 4],
  ["huesca", "Huesca", [], 42.136, -0.408, 3],
  ["irun", "Irún", ["Irun"], 43.338, -1.789, 3],
  ["jaen", "Jaén", [], 37.779, -3.785, 4],
  ["jerez", "Jerez de la Frontera", ["Jerez"], 36.686, -6.137, 5],
  ["hospitalet", "L'Hospitalet de Llobregat", ["Hospitalet", "L'Hospitalet"], 41.360, 2.100, 3],
  ["leon", "León", [], 42.599, -5.567, 4],
  ["lleida", "Lleida", ["Lérida"], 41.617, 0.620, 4],
  ["logrono", "Logroño", [], 42.465, -2.445, 4],
  ["lugo", "Lugo", [], 43.012, -7.556, 4],
  ["madrid", "Madrid", [], 40.417, -3.704, 9],
  ["malaga", "Málaga", [], 36.721, -4.421, 6],
  ["merida", "Mérida", [], 38.916, -6.344, 4],
  ["mostoles", "Móstoles", [], 40.322, -3.865, 4],
  ["murcia", "Murcia", [], 37.984, -1.128, 5],
  ["ourense", "Ourense", ["Orense"], 42.336, -7.864, 4],
  ["oviedo", "Oviedo", ["Uviéu"], 43.362, -5.849, 4],
  ["palencia", "Palencia", [], 42.010, -4.533, 3],
  ["pamplona", "Pamplona", ["Iruña", "Iruñea"], 42.812, -1.646, 5],
  ["ponferrada", "Ponferrada", [], 42.546, -6.596, 4],
  ["pontevedra", "Pontevedra", [], 42.431, -8.645, 4],
  ["sabadell", "Sabadell", [], 41.548, 2.107, 4],
  ["salamanca", "Salamanca", [], 40.965, -5.664, 4],
  ["san-sebastian", "San Sebastián", ["Donostia", "Donostia-San Sebastián"], 43.318, -1.981, 4],
  ["santander", "Santander", [], 43.462, -3.810, 4],
  ["santiago", "Santiago de Compostela", ["Santiago"], 42.878, -8.544, 4],
  ["segovia", "Segovia", [], 40.948, -4.118, 5],
  ["sevilla", "Sevilla", ["Seville"], 37.389, -5.984, 6],
  ["soria", "Soria", [], 41.764, -2.468, 3],
  ["tarragona", "Tarragona", [], 41.119, 1.245, 6],
  ["terrassa", "Terrassa", ["Tarrasa"], 41.563, 2.009, 4],
  ["teruel", "Teruel", [], 40.344, -1.106, 3],
  ["toledo", "Toledo", [], 39.862, -4.027, 4],
  ["valencia", "Valencia", ["València"], 39.470, -0.376, 6],
  ["valladolid", "Valladolid", [], 41.652, -4.724, 5],
  ["vigo", "Vigo", [], 42.240, -8.721, 5],
  ["vitoria", "Vitoria-Gasteiz", ["Vitoria", "Gasteiz"], 42.847, -2.672, 4],
  ["zamora", "Zamora", [], 41.503, -5.745, 3],
  ["zaragoza", "Zaragoza", ["Saragossa"], 41.649, -0.889, 6],
];

export const CITIES = CITY_ROWS.map(([code, name, alt, lat, lon, r]) => ({ code, name, alt, lat, lon, r }));
