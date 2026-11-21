// Saved commutes (Pro): several origin → destination pairs, one active.
// Stored as JSON under the "commute" key; the single commute of 2.0.x
// ({ from, to }) is read as a list of one.

export const MAX_COMMUTES = 10;

const station = (s) =>
  s && typeof s === "object" && typeof s.id === "string" && typeof s.name === "string"
    ? { id: s.id, name: s.name, lon: Number(s.lon) || 0, lat: Number(s.lat) || 0 }
    : null;

const key = (c) => `${c.from.id}>${c.to.id}`;

// A saved journey (Pro, plan journeys J3): the exact trains, the days and
// the alerts. Times are "HH:MM" in the country's time zone.
const ID = /^[A-Za-z0-9._-]{1,40}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const REMIND_CHOICES = [0, 15, 30, 45, 60, 90];
export const NOTIFY_KINDS = ["delay", "risk", "remind", "platform", "stations"];
const text = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

function leg(l) {
  if (!l || typeof l !== "object" || !ID.test(String(l.number ?? "")) || !ID.test(String(l.from ?? "")) || !ID.test(String(l.to ?? ""))) return null;
  if (!HM.test(l.dep) || !HM.test(l.arr)) return null;
  return {
    number: String(l.number),
    trip_id: text(l.trip_id, 80),
    route: text(l.route, 20),
    from: String(l.from),
    from_name: text(l.from_name, 80),
    to: String(l.to),
    to_name: text(l.to_name, 80),
    dep: l.dep,
    arr: l.arr,
    // Walking before this train (a change to a nearby station), seconds.
    walk: Number.isInteger(l.walk) && l.walk > 0 && l.walk < 3600 ? l.walk : 0,
  };
}

/** A saved journey, validated (null if unusable). */
export function parseJourney(j) {
  if (!j || typeof j !== "object" || !Array.isArray(j.legs)) return null;
  const legs = j.legs.slice(0, 4).map(leg);
  if (!legs.length || legs.some((l) => !l)) return null;
  const days = Array.isArray(j.days) ? [...new Set(j.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
  const notify = {};
  for (const k of NOTIFY_KINDS) notify[k] = j.notify?.[k] !== false;
  return {
    legs,
    days: days.length ? days : [1, 2, 3, 4, 5],
    remind: REMIND_CHOICES.includes(j.remind) ? j.remind : 30,
    notify,
  };
}

/** { list: [{ from, to }], active: index or -1, draft: station or null }. */
export function emptyCommutes() {
  return { list: [], active: -1, draft: null };
}

export function parseCommutes(text) {
  let v;
  try {
    v = JSON.parse(text || "null");
  } catch {
    return emptyCommutes();
  }
  if (!v || typeof v !== "object") return emptyCommutes();
  // 2.0.x: one commute, maybe half set (origin chosen, no destination yet).
  if (!Array.isArray(v.list)) {
    const from = station(v.from);
    const to = station(v.to);
    if (from && to && from.id !== to.id) return { list: [{ from, to }], active: 0, draft: null };
    return { list: [], active: -1, draft: from || null };
  }
  const seen = new Set();
  const list = [];
  for (const c of v.list) {
    const from = station(c?.from);
    const to = station(c?.to);
    if (!from || !to || from.id === to.id || seen.has(`${from.id}>${to.id}`)) continue;
    seen.add(`${from.id}>${to.id}`);
    const journey = parseJourney(c.journey);
    list.push(journey ? { from, to, journey } : { from, to });
    if (list.length === MAX_COMMUTES) break;
  }
  const active = Number.isInteger(v.active) && v.active >= 0 && v.active < list.length ? v.active : list.length ? 0 : -1;
  return { list, active, draft: station(v.draft) };
}

export function serializeCommutes(s) {
  return JSON.stringify({ v: 2, list: s.list, active: s.active, draft: s.draft });
}

export function activeCommute(s) {
  return s.list[s.active] || null;
}

/** "I leave from here": the origin of the next commute to add. */
export function setOrigin(s, st) {
  return { ...s, draft: station(st) };
}

/**
 * "I go here": with an origin chosen, adds origin → here (or selects it if
 * it's already saved) and makes it active. `added` false when the list is
 * full or nothing could be added.
 */
export function setDestination(s, st) {
  const to = station(st);
  if (!s.draft || !to || s.draft.id === to.id) return { state: s, added: false };
  const c = { from: s.draft, to };
  const at = s.list.findIndex((x) => key(x) === key(c));
  if (at >= 0) return { state: { ...s, active: at, draft: null }, added: true };
  if (s.list.length >= MAX_COMMUTES) return { state: s, added: false, full: true };
  const list = [...s.list, c];
  return { state: { list, active: list.length - 1, draft: null }, added: true };
}

export function selectCommute(s, i) {
  return i >= 0 && i < s.list.length ? { ...s, active: i } : s;
}

/** Swap the active commute's ends (merging with an existing reverse). */
export function swapActive(s) {
  const c = activeCommute(s);
  if (!c) return s;
  // The reverse has other trains: a saved journey stays with its way.
  const r = { from: c.to, to: c.from };
  const at = s.list.findIndex((x) => key(x) === key(r));
  if (at >= 0) return { ...s, active: at };
  const list = s.list.map((x, i) => (i === s.active ? r : x));
  return { ...s, list };
}

export function removeActive(s) {
  if (!activeCommute(s)) return s;
  const list = s.list.filter((_, i) => i !== s.active);
  return { ...s, list, active: list.length ? Math.min(s.active, list.length - 1) : -1 };
}

/**
 * A journey from the route sheet (engine journeysJson) as a saved one:
 * `clock(unix)` gives "HH:MM" in the country's time zone, `isoDay` today's
 * day (1 Monday … 7 Sunday): weekdays by default, or that weekend day.
 */
export function journeyToSave(j, clock, isoDay) {
  const legs = [];
  let walk = 0;
  for (const s of j.steps || []) {
    if (s.kind === "walk") {
      walk += s.secs;
      continue;
    }
    legs.push({ number: s.number, trip_id: s.trip_id, route: s.route, from: s.from, from_name: s.from_name, to: s.to, to_name: s.to_name, dep: clock(s.dep), arr: clock(s.arr), walk });
    walk = 0;
  }
  return parseJourney({ legs, days: isoDay <= 5 ? [1, 2, 3, 4, 5] : [isoDay] });
}

/**
 * Save `journey` on the commute between its first and last stations
 * (`ends`: {from, to} stations), adding the commute if it's new. Returns
 * `{state, added, full}`.
 */
export function saveJourney(s, ends, journey) {
  const from = station(ends.from);
  const to = station(ends.to);
  const j = parseJourney(journey);
  if (!from || !to || from.id === to.id || !j) return { state: s, added: false };
  const at = s.list.findIndex((x) => key(x) === key({ from, to }));
  if (at >= 0) {
    const list = s.list.map((x, i) => (i === at ? { ...x, journey: j } : x));
    return { state: { ...s, list, active: at }, added: true };
  }
  if (s.list.length >= MAX_COMMUTES) return { state: s, added: false, full: true };
  const list = [...s.list, { from, to, journey: j }];
  return { state: { ...s, list, active: list.length - 1 }, added: true };
}

/** Change the active commute's saved journey settings (days, remind, notify). */
export function updateJourney(s, patch) {
  const c = activeCommute(s);
  if (!c?.journey) return s;
  const j = parseJourney({ ...c.journey, ...patch, notify: { ...c.journey.notify, ...(patch.notify || {}) } });
  if (!j) return s;
  return { ...s, list: s.list.map((x, i) => (i === s.active ? { ...x, journey: j } : x)) };
}

/** Forget the active commute's saved journey (the commute stays). */
export function removeJourney(s) {
  const c = activeCommute(s);
  if (!c?.journey) return s;
  return { ...s, list: s.list.map((x, i) => (i === s.active ? { from: x.from, to: x.to } : x)) };
}

const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

/**
 * Today's state of a saved journey: `runs[i]` is the live state of leg i's
 * train today ({delay seconds|null, canceled, platform?} or null when not
 * known). Returns per leg {delay, canceled, platform} and per change
 * {margin seconds, risk}: a change is at risk below `minChange` seconds;
 * a cancelled train breaks the journey.
 */
export function journeyStatus(journey, runs, minChange = 5 * 60) {
  const legs = journey.legs.map((l, i) => ({ delay: runs[i]?.delay ?? null, canceled: !!runs[i]?.canceled, platform: runs[i]?.platform || null }));
  const changes = [];
  for (let i = 1; i < journey.legs.length; i++) {
    const prev = journey.legs[i - 1];
    const next = journey.legs[i];
    // Across midnight: a time before the previous one is the next day.
    let dep = minutes(next.dep) * 60;
    const arr = minutes(prev.arr) * 60;
    if (dep < arr - 12 * 3600) dep += 86_400;
    const margin = dep + (legs[i].delay || 0) - (arr + (legs[i - 1].delay || 0)) - next.walk;
    changes.push({ at: next.from_name || next.from, margin, risk: margin < minChange });
  }
  const broken = legs.some((l) => l.canceled) || changes.some((c) => c.margin < 0);
  return { legs, changes, broken, risk: changes.some((c) => c.risk) };
}
