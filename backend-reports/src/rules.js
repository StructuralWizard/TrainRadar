// Travellers' reports (docs/plan-crowd-reports.md, UK only for now): the
// rules, pure so they can be tested. A report says "this train is late /
// hasn't come / had a serious incident", from a phone whose app checked, on
// the phone, that it was on the train or at one of its stations. No
// coordinates arrive here: only the check's result and rough bands.

/** What can be reported, where the reporter must be, and how many phones
 * must agree before it's shown. */
export const KINDS = {
  delay: { where: ["train", "station"], min: 3 },
  cancel: { where: ["station"], min: 3 },
  incident: { where: ["train", "station"], min: 5 },
};
/** Phones must agree within this window… */
export const AGREE_MS = 20 * 60_000;
/** …and a count stays shown until this long after the last report. */
export const SHOW_MS = 60 * 60_000;
/** Single reports are kept this long (abuse checks), then deleted. */
export const KEEP_MS = 48 * 3600_000;
/** One report per train and kind per phone in this time; 20 a day. */
export const REPEAT_MS = 10 * 60_000;
export const DAILY = 20;
const BANDS = ["300", "1000", "3000"];
const ACCURACY = ["20", "100", "500"];

// Plain text: no markup, quotes, backslashes or control characters.
const str = (v, max, re = /^[^<>"\\\u0000-\u001f\u007f]+$/u) => typeof v === "string" && v.length > 0 && v.length <= max && re.test(v);

/** The report in a request body, checked: { report } or { error }. */
export function validate(b, { countries, now }) {
  if (!b || typeof b !== "object") return { error: "body" };
  if (!countries.includes(b.country)) return { error: "country" };
  if (!str(b.trip, 120)) return { error: "trip" };
  if (!str(b.train, 16)) return { error: "train" };
  const kind = KINDS[b.kind];
  if (!kind) return { error: "kind" };
  if (!kind.where.includes(b.where)) return { error: "where" };
  if (b.where === "station" && !str(b.station, 80)) return { error: "station" };
  if (!BANDS.includes(b.band) || !ACCURACY.includes(b.acc)) return { error: "band" };
  if (!Number.isFinite(b.at) || Math.abs(now - b.at) > 5 * 60_000) return { error: "time" };
  if (!str(b.token, 64, /^[A-Za-z0-9_-]{22,64}$/)) return { error: "token" };
  if (typeof b.integrity !== "string" || !b.integrity || b.integrity.length > 8000) return { error: "integrity" };
  return {
    report: { country: b.country, trip: b.trip, train: b.train, kind: b.kind, where: b.where, station: b.where === "station" ? b.station : "", band: b.band, acc: b.acc, at: b.at },
  };
}

/** A "that's not right" on a shown count: { dispute } or { error }. */
export function validateDispute(b, { countries, now }) {
  if (!b || typeof b !== "object") return { error: "body" };
  if (!countries.includes(b.country)) return { error: "country" };
  if (!str(b.trip, 120)) return { error: "trip" };
  if (!KINDS[b.kind]) return { error: "kind" };
  if (!Number.isFinite(b.at) || Math.abs(now - b.at) > 5 * 60_000) return { error: "time" };
  if (!str(b.token, 64, /^[A-Za-z0-9_-]{22,64}$/)) return { error: "token" };
  if (typeof b.integrity !== "string" || !b.integrity || b.integrity.length > 8000) return { error: "integrity" };
  return { dispute: { country: b.country, trip: b.trip, kind: b.kind, at: b.at } };
}

/**
 * What the app hashed into the Play Integrity nonce: the request bound to
 * its token, so a token can't be reused for another report. The app builds
 * the same string (web/js/reports.js nonceText).
 */
export function nonceText(b, dispute = false) {
  return dispute
    ? ["dispute", b.country, b.trip, b.kind, b.at, b.token].join("|")
    : ["report", b.country, b.trip, b.kind, b.where, b.where === "station" ? b.station : "", b.at, b.token].join("|");
}

/** base64url (no padding) of SHA-256: the nonce, and the token's hash. */
export async function sha256b64(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Why this phone (hash `h`) can't report this now, or null. */
export function refused(log, h, r, now) {
  const mine = log.filter((e) => e.h === h);
  if (mine.filter((e) => now - e.at < 24 * 3600_000).length >= DAILY) return "daily";
  if (mine.some((e) => e.trip === r.trip && e.kind === r.kind && now - e.at < REPEAT_MS)) return "repeat";
  // Nobody is on two trains at once.
  if (r.where === "train" && mine.some((e) => e.where === "train" && e.trip !== r.trip && now - e.at < REPEAT_MS)) return "elsewhere";
  return null;
}

/** Drop what's older than KEEP_MS. */
export const prune = (list, now) => list.filter((e) => now - e.at < KEEP_MS);

/**
 * The published counts (`<cc>/rt/reports.json`): per trip and kind, the
 * phones that reported it in the last SHOW_MS, less those who said "not
 * right", shown only once `min` phones agreed within AGREE_MS. No tokens,
 * no stations, no times but the last report's.
 */
export function publish(log, disputes, now, on = true) {
  const groups = new Map();
  for (const e of log) {
    if (now - e.at >= SHOW_MS) continue;
    const k = `${e.trip}\u0000${e.kind}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const trips = {};
  for (const [k, list] of groups) {
    const [trip, kind] = k.split("\u0000");
    const min = KINDS[kind]?.min ?? Infinity;
    // The first time each phone reported it, oldest first.
    const first = new Map();
    for (const e of [...list].sort((a, b) => a.at - b.at)) if (!first.has(e.h)) first.set(e.h, e.at);
    const times = [...first.values()];
    let agreed = false;
    for (let i = 0, j = 0; j < times.length; j++) {
      while (times[j] - times[i] > AGREE_MS) i++;
      if (j - i + 1 >= min) agreed = true;
    }
    if (!agreed) continue;
    const reporters = new Set(first.keys());
    const against = new Set(disputes.filter((d) => d.trip === trip && d.kind === kind && now - d.at < SHOW_MS && !reporters.has(d.h)).map((d) => d.h));
    const n = reporters.size - against.size;
    if (n < min) continue;
    (trips[trip] ||= {})[kind] = { n, last: Math.max(...list.map((e) => e.at)) };
  }
  return { on, at: now, trips };
}

/** Today's totals per kind, without tokens or trains (the statistics). */
export function count(daily, r, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const d = (daily[day] ||= {});
  d[r.kind] = (d[r.kind] || 0) + 1;
  for (const k of Object.keys(daily).sort().slice(0, -60)) delete daily[k];
  return daily;
}
