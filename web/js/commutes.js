// Saved commutes (Pro): several origin → destination pairs, one active.
// Stored as JSON under the "commute" key; the single commute of 2.0.x
// ({ from, to }) is read as a list of one.

export const MAX_COMMUTES = 10;

const station = (s) =>
  s && typeof s === "object" && typeof s.id === "string" && typeof s.name === "string"
    ? { id: s.id, name: s.name, lon: Number(s.lon) || 0, lat: Number(s.lat) || 0 }
    : null;

const key = (c) => `${c.from.id}>${c.to.id}`;

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
    list.push({ from, to });
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
