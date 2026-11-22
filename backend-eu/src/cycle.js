// One cycle's work for a country's feeds, with the I/O injected so the
// tests run it in Node: fetch one of its feeds (within the provider's call
// budget), keep its operator's entities, write them to the live bucket next
// to Spain's and the UK's, and publish status.json in the same shape as
// theirs, so the app's live mode reads it with the same code. Each country
// (ireland.js, france.js) says where its feeds are, how often, with which
// headers, and what to keep.

import { filterFeed } from "./gtfsrt.js";
import { IE, feedFor } from "./ireland.js";

/** Ireland's cycle (kept for the tests; each country has its `cycleMs`). */
export const CYCLE_MS = IE.cycleMs;
export const CACHE = "public, max-age=30";
/** After a failure, wait 1, 2, 4… minutes before the next call, at most 30. */
export const BACKOFF_MAX_MS = 30 * 60_000;
export const backoffMs = (failures) => Math.min(BACKOFF_MAX_MS, 60_000 * 2 ** Math.max(0, failures - 1));

export const emptyState = () => ({ minute: 0, failures: 0, nextAt: null, failingSince: null, lastError: null, feeds: {} });

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
  } else {
    const feed = feedFor(state.minute, country);
    state.minute = (state.minute + 1) % 1_000_000;
    cycle.feed = feed.name;
    try {
      const r = await fetchFn(country.base + feed.path, { headers: country.headers(env) });
      if (!r.ok) throw new Error(`${feed.path}: HTTP ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length === 0) throw new Error(`${feed.path}: empty response`);
      const keep = country.keep(feed.name, bytes);
      const out = filterFeed(bytes, keep || (() => true));
      await env.LIVE.put(country.prefix + feed.name, out.bytes, {
        httpMetadata: { contentType: "application/x-protobuf", cacheControl: CACHE },
      });
      state.feeds[feed.name] = { ok: true, fetchedAt: at, lm: new Date(now).toUTCString(), entities: out.total, kept: out.kept, bytes: out.bytes.length };
      state.failures = 0;
      state.nextAt = null;
      state.failingSince = null;
      state.lastError = null;
    } catch (e) {
      cycle.ok = false;
      cycle.error = String(e?.message || e).slice(0, 300);
      state.failures = (state.failures || 0) + 1;
      state.nextAt = now + backoffMs(state.failures);
      state.failingSince ||= at;
      state.lastError = cycle.error;
      if (state.feeds[feed.name]) state.feeds[feed.name].ok = false;
    }
  }
  const status = {
    updatedAt: at,
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
