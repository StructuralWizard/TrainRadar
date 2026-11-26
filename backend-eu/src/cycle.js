// One cycle's work for a country's feeds, with the I/O injected so the
// tests run it in Node: fetch one of its feeds (within the provider's call
// budget), keep its operator's entities, write them to the live bucket next
// to Spain's and the UK's, and publish status.json in the same shape as
// theirs, so the app's live mode reads it with the same code. Each country
// (ireland.js, france.js) says where its feeds are, how often, with which
// headers, and what to keep.

import { filterFeed } from "./gtfsrt.js";
import { concat } from "./protobuf.js";
import { IE, feedFor } from "./ireland.js";

/** Ireland's cycle (kept for the tests; each country has its `cycleMs`). */
export const CYCLE_MS = IE.cycleMs;
export const CACHE = "public, max-age=30";
/** After a failure, wait 1, 2, 4… minutes before the next call, at most 30. */
export const BACKOFF_MAX_MS = 30 * 60_000;
export const backoffMs = (failures) => Math.min(BACKOFF_MAX_MS, 60_000 * 2 ** Math.max(0, failures - 1));

export const emptyState = () => ({ minute: 0, failures: 0, nextAt: null, failingSince: null, lastError: null, feeds: {}, calls: { day: "", n: 0 } });

/** A feed that refuses us (401, 403, 404: a key without that product, or a
 * feed gone) rests this long before it is asked again; the others keep
 * their turns. */
export const REFUSED_REST_MS = 30 * 60_000;
/** Calls a country may make in a UTC day: its planned rate (one per
 * cycleMs) and a quarter more, or its own `dailyMax`. A safety net, so a
 * scheduling fault (two alarms, a tight loop) can't hammer a provider into
 * banning us; the planned rates are within each provider's quota. */
export const dailyCap = (country) => country.dailyMax ?? Math.ceil((1.25 * 86_400_000) / country.cycleMs);

/** The pause a 429 or 503 asks for (its Retry-After, seconds or a date), in
 * ms; null when it doesn't say. */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const s = Number(value);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** Calls made so far this UTC day (the counter resets at midnight UTC). */
function callsToday(state, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (!state.calls || state.calls.day !== day) state.calls = { day, n: 0 };
  return state.calls.n;
}

export async function runCycle({ state, env, fetchFn = fetch, now = Date.now(), country = IE }) {
  const at = new Date(now).toISOString();
  const cycle = { at, ok: true, feed: null, skipped: false, error: null };
  const missing = country.missing(env);
  if (missing) {
    cycle.ok = false;
    cycle.error = missing;
  } else if (state.nextAt && now < state.nextAt) {
    cycle.ok = false;
    cycle.skipped = true;
    cycle.error = state.lastError || "backing off";
  } else if (callsToday(state, now) >= dailyCap(country)) {
    cycle.ok = false;
    cycle.skipped = true;
    cycle.error = `daily call cap reached (${dailyCap(country)})`;
  } else {
    let feed = feedFor(state.minute, country);
    // A feed whose own key isn't set (Switzerland: one key per API) gives
    // its turn to the main feed.
    if (country.ready && !country.ready(env, feed)) feed = country.feeds[0];
    state.minute = (state.minute + 1) % 1_000_000;
    cycle.feed = feed.name;
    const resting = state.feeds[feed.name]?.restUntil;
    if (resting && now < resting) {
      // This feed refused us lately: its turn passes without a call.
      cycle.ok = false;
      cycle.skipped = true;
      cycle.error = state.feeds[feed.name].error || "resting";
    } else
    try {
      state.calls.n++;
      // Sweden: the key in the URL (Trafiklab's only way; AGENTS.md). Errors
      // name feed.path, never this URL.
      let bytes;
      if (feed.produce) {
        // Denmark: messages received from a queue and merged into the
        // feed's own state, not one file fetched.
        bytes = (await feed.produce({ env, fetchFn, now, feed })).bytes;
      } else {
        const url = country.url ? country.url(env, feed) : country.base + feed.path;
        const r = await fetchFn(url, { headers: country.headers(env, feed) });
        if (!r.ok) {
          const err = new Error(`${feed.path}: HTTP ${r.status}`);
          err.status = r.status;
          if (r.status === 429 || r.status === 503) err.retryAfter = retryAfterMs(r.headers?.get?.("retry-after"), now);
          throw err;
        }
        bytes = new Uint8Array(await r.arrayBuffer());
      }
      if (bytes.length === 0) throw new Error(`${feed.path}: empty response`);
      // JSON sources (Poland) become GTFS-Realtime here.
      if (feed.convert) bytes = feed.convert(bytes, now);
      const keep = await country.keep(feed.name, bytes, { env, fetchFn, now });
      const out = filterFeed(bytes, keep || (() => true));
      const meta = { httpMetadata: { contentType: "application/x-protobuf", cacheControl: CACHE } };
      await env.LIVE.put(country.prefix + feed.name, out.bytes, meta);
      // Parts of one file (Switzerland's planned and unplanned alerts):
      // the file is all its parts' entities, one after the other (repeated
      // protobuf fields concatenate).
      if (feed.part) {
        const parts = [];
        for (const name of country.parts[feed.part]) {
          const o = name === feed.name ? null : await env.LIVE.get(country.prefix + name);
          parts.push(o ? new Uint8Array(await o.arrayBuffer()) : name === feed.name ? out.bytes : new Uint8Array());
        }
        await env.LIVE.put(country.prefix + feed.part, concat(parts), meta);
      }
      state.feeds[feed.name] = { ok: true, restUntil: null, fetchedAt: at, lm: new Date(now).toUTCString(), entities: out.total, kept: out.kept, bytes: out.bytes.length };
      state.failures = 0;
      state.nextAt = null;
      state.failingSince = null;
      state.lastError = null;
    } catch (e) {
      cycle.ok = false;
      cycle.error = String(e?.message || e)
        .replaceAll(env.SE_TRAFIKLAB_RT_KEY || "\u0000", "***")
        .replaceAll(env.SE_TRAFIKVERKET_KEY || "\u0000", "***")
        .replaceAll(env.DK_NAP_CLIENT_SECRET || "\u0000", "***")
        .replaceAll(env.DE_DB_API_KEY || "\u0000", "***")
        .replaceAll(env.DE_DB_CLIENT_ID || "\u0000", "***")
        .replaceAll(env.BE_SNCB_KEY || "\u0000", "***")
        .replaceAll(env.AU_NSW_API_KEY || "\u0000", "***")
        .replaceAll(env.AU_VIC_API_KEY || "\u0000", "***")
        .replaceAll(env.NZ_METLINK_API_KEY || "\u0000", "***")
        .replaceAll(env.NZ_AT_API_KEY || "\u0000", "***")
        .replaceAll(env.SG_LTA_ACCOUNT_KEY || "\u0000", "***")
        .slice(0, 300);
      state.failures = (state.failures || 0) + 1;
      // Sweden's regions take turns: one failing region skips its turn
      // instead of stopping the others...
      if (!country.rotate) state.nextAt = now + backoffMs(state.failures);
      // ...unless the provider says we call too often (429, 503): then the
      // whole country pauses, as long as it asks and at least the backoff.
      if (e?.status === 429 || e?.status === 503) state.nextAt = now + Math.max(backoffMs(state.failures), e.retryAfter || 0);
      // A rotating country whose feeds all fail in a row backs off too.
      else if (country.rotate && state.failures >= country.feeds.length + 1) state.nextAt = now + backoffMs(state.failures - country.feeds.length);
      // A feed that refuses us rests; the country's other feeds go on.
      if (e?.status === 401 || e?.status === 403 || e?.status === 404) {
        state.feeds[feed.name] = { ...(state.feeds[feed.name] || {}), ok: false, restUntil: now + REFUSED_REST_MS, error: cycle.error };
      }
      // A refused login (Denmark, Germany) won't fix itself: wait the longest.
      if (e?.fatal) state.nextAt = now + BACKOFF_MAX_MS;
      state.failingSince ||= at;
      state.lastError = cycle.error;
      if (state.feeds[feed.name]) state.feeds[feed.name].ok = false;
    }
  }
  const status = {
    updatedAt: at,
    callsToday: state.calls?.n || 0,
    dailyCap: dailyCap(country),
    ok: cycle.ok,
    error: cycle.error,
    skipped: cycle.skipped,
    fetched: cycle.feed,
    failingSince: state.failingSince,
    failures: state.failures || 0,
    nextCallAt: state.nextAt ? new Date(state.nextAt).toISOString() : null,
    source: country.source,
    // The same shape as Spain's and the UK's (renfeLastModified is the
    // field the app reads for "this file changed").
    feeds: Object.fromEntries(
      Object.entries(state.feeds).map(([name, f]) => [name, { ok: f.ok, fetchedAt: f.fetchedAt, renfeLastModified: f.lm, entities: f.entities, kept: f.kept, bytes: f.bytes }]),
    ),
  };
  await env.LIVE.put(country.prefix + "status.json", JSON.stringify(status), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=10" },
  });
  return status;
}
