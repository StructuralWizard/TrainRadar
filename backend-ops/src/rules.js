// Alert rules (backend-ops): what's wrong now, from every country's
// status.json in the live bucket and each country's data manifest on the
// site. Pure: the Worker feeds it what it read and keeps the alert state.

/** Each country's status.json in the live bucket (as backend-eu/src/world.js). */
export const STATUS_KEYS = {
  es: "rt/status.json",
  uk: "uk/rt/status.json",
  ...Object.fromEntries(
    ["ie", "fr", "fi", "no", "nl", "ch", "pl", "se", "cz", "dk", "de", "be", "au", "nz", "sg", "jp"].map((c) => [c, `${c}/rt/status.json`]),
  ),
};
/** Each country's data manifest on the site (data/manifest.json is Spain's). */
export const DATA_COUNTRIES = ["es", "uk", "ie", "fr", "lu", "fi", "no", "nl", "sk", "ee", "ch", "se", "pl", "at", "cz", "it", "dk", "hu", "de", "be", "au", "nz", "sg", "pt", "jp"];

const MIN = 60_000;
/** A status not rewritten for this long: its ingest Worker has stopped. */
export const STALE_STATUS_MS = 15 * MIN;
/** A feed failing, or not fetched, for this long. */
export const FAILING_MS = 30 * MIN;
/** A status older than this belongs to a country that's switched off: no alerts. */
export const DISABLED_MS = 7 * 24 * 60 * MIN;
/** Reference data older than this: the nightly deploy didn't refresh it. */
export const DATA_OLD_MS = 36 * 60 * MIN;
/** Calls today at this share of the daily cap. */
export const QUOTA_SHARE = 0.9;

const when = (s) => Date.parse(s?.updatedAt || s?.generatedAt || "") || null;
const mins = (ms) => `${Math.round(ms / MIN)} min`;

/**
 * Problems now: [{ id, country, text }]. `statuses`: { code: status | null },
 * `manifests`: { code: generated_at seconds | null } (null: not deployed).
 */
export function problems({ statuses = {}, manifests = {}, now }) {
  const out = [];
  const add = (id, country, text) => out.push({ id: `${country}:${id}`, country, text });
  for (const [cc, st] of Object.entries(statuses)) {
    const at = when(st);
    if (!st || !at || now - at > DISABLED_MS) continue; // off, or never on
    if (now - at > STALE_STATUS_MS) {
      add("stale", cc, `its ingest stopped: status not updated for ${mins(now - at)}`);
      continue;
    }
    const since = Date.parse(st.failingSince || "") || null;
    if (st.ok === false && since && now - since > FAILING_MS) {
      add("failing", cc, `live feed failing for ${mins(now - since)}: ${String(st.error || "error").slice(0, 160)}`);
    }
    for (const [name, f] of Object.entries(st.feeds || {})) {
      const got = Date.parse(f?.fetchedAt || "") || null;
      if (got && now - got > FAILING_MS) add(`feed:${name}`, cc, `${name} not fetched for ${mins(now - got)}`);
    }
    if (st.dailyCap && st.callsToday >= QUOTA_SHARE * st.dailyCap) {
      add("quota", cc, `${st.callsToday} of its ${st.dailyCap} calls today (${Math.round((100 * st.callsToday) / st.dailyCap)} %)`);
    }
    // The UK: Network Rail's login backing off; TfL's live arrivals failing.
    if (cc === "uk" && (st.failures || 0) >= 3) add("login", cc, `Network Rail login failed ${st.failures} times in a row: ${String(st.error || "").slice(0, 120)}`);
    if (cc === "uk" && st.tfl && st.tfl.ok === false) add("tfl", cc, `TfL live arrivals failing: ${String(st.tfl.error || "error").slice(0, 120)}`);
  }
  for (const [cc, gen] of Object.entries(manifests)) {
    if (!gen) continue;
    const age = now - gen * 1000;
    if (age > DATA_OLD_MS) add("data", cc, `reference data ${Math.round(age / 3600_000)} h old: the deploy didn't refresh it`);
  }
  return out;
}

/** Checks in a row a problem must be seen (or gone) before a mail: no flapping. */
export const CONFIRM = 2;

/**
 * Update the alert state with this check's problems. `state`: { open: { id:
 * { since, text, seen, mailed } }, gone: { id: count } }. Returns the
 * problems to announce (`raised`) and those that cleared (`cleared`).
 */
export function step(state, found, now) {
  state.open ||= {};
  state.pending ||= {};
  state.clearing ||= {};
  const raised = [];
  const cleared = [];
  const ids = new Set(found.map((p) => p.id));
  for (const p of found) {
    delete state.clearing[p.id];
    if (state.open[p.id]) {
      state.open[p.id].text = p.text;
      continue;
    }
    const n = (state.pending[p.id] || 0) + 1;
    if (n >= CONFIRM) {
      delete state.pending[p.id];
      state.open[p.id] = { since: now, text: p.text, country: p.country };
      raised.push(p);
    } else state.pending[p.id] = n;
  }
  for (const id of Object.keys(state.pending)) if (!ids.has(id)) delete state.pending[id];
  for (const [id, o] of Object.entries(state.open)) {
    if (ids.has(id)) continue;
    const n = (state.clearing[id] || 0) + 1;
    if (n >= CONFIRM) {
      delete state.open[id];
      delete state.clearing[id];
      cleared.push({ id, country: o.country, text: o.text, lasted: now - o.since });
    } else state.clearing[id] = n;
  }
  return { raised, cleared };
}
