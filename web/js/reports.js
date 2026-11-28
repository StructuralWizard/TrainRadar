// Travellers' reports (docs/plan-crowd-reports.md), the UK only: "N
// travellers report a delay on this train". Reading the counts is for
// everyone (<cc>/rt/reports.json, from the live bucket). Sending is only in
// the Android app, with the user's consent, after a check ON THE PHONE that
// they're on the train or at one of its stations: the location fix never
// leaves the phone; only the check's result and rough bands are sent, with
// a Play Integrity token and a random token that changes every month.

/** What can be reported: where from, and the phones needed to show it
 * (the same as backend-reports/src/rules.js KINDS). */
export const REPORT_KINDS = {
  delay: { where: ["train", "station"], min: 3 },
  cancel: { where: ["station"], min: 3 },
  incident: { where: ["train", "station"], min: 5 },
};
/** Countries reports are taken in (backend-reports REPORT_COUNTRIES). */
export const REPORT_COUNTRIES = ["uk"];
const ON_TRAIN_M = 300; // from the train's track
const NEAR_TRAIN_M = 3000; // from where the app places the train
const AT_STATION_M = 400;
const BEFORE_S = 30 * 60; // at a station: from 30 min before the train's time…
const AFTER_S = 90 * 60; // …to 90 min after

const RAD = Math.PI / 180;
/** Metres between two [lon, lat] points (haversine). */
export function distM([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** Metres from point `p` to a polyline of [lon, lat] (flat-earth, fine at these distances). */
export function lineDistM(p, line) {
  if (!line?.length) return Infinity;
  if (line.length === 1) return distM(p, line[0]);
  const kx = 111320 * Math.cos(p[1] * RAD);
  const ky = 110540;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
    const bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

const band = (m) => (m < 300 ? "300" : m < 1000 ? "1000" : "3000");

/**
 * The on-phone check. `fix`: { lat, lon, accuracy } (metres); `info`: the
 * train (lon, lat, delay); `trip`: tripJson ({ line, stops: [{ name, lon,
 * lat, time }] }, times expected, Unix seconds). Returns what may be sent —
 * { where: "train" | "station", station, band, acc } — or { error }:
 * "accuracy" (fix too rough), "where" (neither on the train nor at one of
 * its stations around its time).
 */
export function placeCheck(kind, fix, info, trip, nowSecs) {
  const spec = REPORT_KINDS[kind];
  if (!spec || !fix) return { error: "where" };
  if (!(fix.accuracy <= 500)) return { error: "accuracy" };
  const acc = fix.accuracy <= 20 ? "20" : fix.accuracy <= 100 ? "100" : "500";
  const p = [fix.lon, fix.lat];
  if (spec.where.includes("train") && Number.isFinite(info?.lon)) {
    const near = distM(p, [info.lon, info.lat]);
    const track = trip?.line?.length ? lineDistM(p, trip.line) : near;
    if (near <= NEAR_TRAIN_M && track <= ON_TRAIN_M) return { where: "train", station: "", band: band(near), acc };
  }
  if (spec.where.includes("station")) {
    const delay = info?.delay || 0;
    let bestStop = null;
    let bestD = Infinity;
    for (const s of trip?.stops || []) {
      const sched = s.time - delay;
      if (nowSecs < sched - BEFORE_S || nowSecs > sched + AFTER_S) continue;
      const d = distM(p, [s.lon, s.lat]);
      if (d <= AT_STATION_M && d < bestD) {
        bestD = d;
        bestStop = s;
      }
    }
    if (bestStop) return { where: "station", station: bestStop.name, band: band(bestD), acc };
  }
  return { error: "where" };
}

/** What the Play Integrity nonce hashes (backend-reports rules.js nonceText). */
export function nonceText(b, dispute = false) {
  return dispute
    ? ["dispute", b.country, b.trip, b.kind, b.at, b.token].join("|")
    : ["report", b.country, b.trip, b.kind, b.where, b.where === "station" ? b.station : "", b.at, b.token].join("|");
}

/** base64url SHA-256 of `text`: the nonce. */
export async function sha256b64(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The phone's reporting token: random, new every calendar month (UTC).
 * `saved`: the stored { month, token } or null. Returns the one to use and
 * store. */
export function monthlyToken(saved, now = Date.now(), random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const month = new Date(now).toISOString().slice(0, 7);
  if (saved?.month === month && /^[A-Za-z0-9_-]{22,64}$/.test(saved.token || "")) return saved;
  const token = btoa(String.fromCharCode(...random(24))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { month, token };
}

/** A train's shown counts from reports.json: [{ kind, n, last }], biggest worry first. */
export function trainReports(doc, tripId) {
  const t = doc?.trips?.[tripId];
  if (!t) return [];
  return ["incident", "cancel", "delay"].filter((k) => t[k]?.n >= REPORT_KINDS[k].min).map((k) => ({ kind: k, n: t[k].n, last: t[k].last }));
}
