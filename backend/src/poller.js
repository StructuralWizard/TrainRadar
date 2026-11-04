// Central poller for Renfe's GTFS-RT feeds (phase C1).
//
// One client for all users: each feed is fetched on its own cadence with a
// conditional GET, and the bytes are stored UNCHANGED in R2 (`rt/<feed>`).
// Once a few of Renfe's Last-Modified times are known, the next fetch is
// phase-locked to ~2 s after the expected change instead of a blind timer.
// Never faster than once per 15 s per feed; errors back off exponentially.
//
// This file holds the pure logic (testable without Cloudflare) and the
// Durable Object class that runs it on an alarm.

export const UPSTREAM = "https://gtfsrt.renfe.com/";

/** Feeds and their base cadence in seconds (docs/data-sources.md, measured
 * 2026-11-01). Alerts rarely change: every 2 min, every 5 min once they've
 * been unchanged for an hour. */
export const FEEDS = [
  { name: "vehicle_positions_LD.pb", every: 15 },
  { name: "trip_updates_LD.pb", every: 15 },
  { name: "vehicle_positions.pb", every: 20 },
  { name: "trip_updates.pb", every: 20 },
  { name: "alerts.pb", every: 120, slowEvery: 300, slowAfter: 3600, noPhaseLock: true },
];

/** Hard floor between two fetches of the same feed (seconds). */
export const MIN_GAP_S = 15;
/** Fetch this long after Renfe's expected change. */
export const PHASE_OFFSET_S = 2;
/** ± random seconds on every schedule, so we never hit Renfe on the dot. */
export const JITTER_S = 1;
export const MAX_BACKOFF_S = 600;
export const TIMEOUT_MS = 10_000;
/** Renfe change times kept per feed for the phase-lock. */
export const CHANGES_KEPT = 8;
/** status.json is rewritten at most this often unless something changed. */
export const STATUS_EVERY_S = 30;
export const CACHE_CONTROL = "public, max-age=10";

/** Fresh state for a feed. */
export function initialState() {
  return {
    etag: null,
    lastModified: null, // Renfe's Last-Modified header, verbatim
    changes: [], // unix seconds of Renfe's Last-Modified values we've seen
    lastFetch: 0,
    lastChangeSeen: 0, // when we last stored new bytes
    nextAt: 0,
    failures: 0,
    ok: null,
    error: null,
    bytes: 0,
  };
}

/** Median gap between consecutive change times, or null with < 3 changes. */
export function medianGap(changes) {
  if (changes.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < changes.length; i++) gaps.push(changes[i] - changes[i - 1]);
  gaps.sort((a, b) => a - b);
  const m = gaps[Math.floor(gaps.length / 2)];
  return m > 0 ? m : null;
}

/** When to fetch this feed next (unix seconds). `rand` returns [0, 1). */
export function nextFetchAt(feed, st, now, rand = Math.random) {
  const jitter = (rand() * 2 - 1) * JITTER_S;
  const floor = st.lastFetch + MIN_GAP_S;
  if (st.failures > 0) {
    const back = Math.min(feed.every * 2 ** st.failures, MAX_BACKOFF_S);
    return Math.max(now + back + jitter, floor);
  }
  let every = feed.every;
  if (feed.slowEvery && st.lastChangeSeen && now - st.lastChangeSeen > feed.slowAfter) {
    every = feed.slowEvery;
  }
  const period = feed.noPhaseLock ? null : medianGap(st.changes);
  if (period && period >= MIN_GAP_S && period <= 600) {
    // Next expected change after now, plus a small offset.
    const last = st.changes[st.changes.length - 1];
    let t = last + period + PHASE_OFFSET_S;
    while (t < now + 1) t += period;
    return Math.max(t + jitter, floor);
  }
  return Math.max(now + every + jitter, floor);
}

/** Fetch one feed (conditional GET) and store new bytes in R2.
 * Returns the updated state. Never throws. */
export async function pollFeed(feed, st, { fetchFn = fetch, bucket, now }) {
  const next = { ...st, changes: [...st.changes], lastFetch: now };
  const headers = { "User-Agent": "TrainRadar central poller (github.com/StructuralWizard/TrainRadar)" };
  if (st.etag) headers["If-None-Match"] = st.etag;
  if (st.lastModified) headers["If-Modified-Since"] = st.lastModified;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(UPSTREAM + feed.name, { headers, signal: ctl.signal });
    if (res.status === 304) {
      next.ok = true;
      next.error = null;
      next.failures = 0;
      return next;
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const lm = res.headers.get("Last-Modified");
    await bucket.put(`rt/${feed.name}`, bytes, {
      httpMetadata: { contentType: "application/x-protobuf", cacheControl: CACHE_CONTROL },
      customMetadata: { renfeLastModified: lm || "" },
    });
    if (lm && lm !== st.lastModified) {
      const t = Math.floor(Date.parse(lm) / 1000);
      if (Number.isFinite(t) && t > (next.changes.at(-1) ?? 0)) {
        next.changes.push(t);
        if (next.changes.length > CHANGES_KEPT) next.changes.shift();
      }
      next.lastChangeSeen = now;
    }
    next.etag = res.headers.get("ETag");
    next.lastModified = lm;
    next.bytes = bytes.length;
    next.ok = true;
    next.error = null;
    next.failures = 0;
    return next;
  } catch (e) {
    next.ok = false;
    next.error = e.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 200);
    next.failures = st.failures + 1;
    return next;
  } finally {
    clearTimeout(timer);
  }
}

/** The public status document, `rt/status.json`. */
export function statusDoc(states, now, enabled) {
  const feeds = {};
  for (const f of FEEDS) {
    const s = states[f.name] || initialState();
    feeds[f.name] = {
      renfeLastModified: s.lastModified,
      fetchedAt: s.lastFetch ? new Date(s.lastFetch * 1000).toISOString() : null,
      ok: s.ok,
      ...(s.error ? { error: s.error } : {}),
      bytes: s.bytes,
      changeGapS: medianGap(s.changes),
      nextAt: s.nextAt ? new Date(s.nextAt * 1000).toISOString() : null,
    };
  }
  return { generatedAt: new Date(now * 1000).toISOString(), pollerEnabled: enabled, feeds };
}

/** One alarm cycle: poll the feeds that are due, schedule each, and decide
 * whether status.json needs rewriting. Pure apart from the injected I/O. */
export async function runCycle(states, { now, fetchFn, bucket, rand, lastStatusAt = 0, enabled = true }) {
  const out = { ...states };
  let changed = false;
  for (const f of FEEDS) {
    const st = out[f.name] || initialState();
    if (enabled && st.nextAt <= now + 0.5) {
      const polled = await pollFeed(f, st, { fetchFn, bucket, now });
      polled.nextAt = nextFetchAt(f, polled, now, rand);
      changed ||= polled.lastModified !== st.lastModified || polled.ok !== st.ok;
      out[f.name] = polled;
    } else {
      out[f.name] = st;
    }
  }
  const writeStatus = changed || now - lastStatusAt >= STATUS_EVERY_S;
  if (writeStatus) {
    await bucket.put("rt/status.json", JSON.stringify(statusDoc(out, now, enabled)), {
      httpMetadata: { contentType: "application/json", cacheControl: CACHE_CONTROL },
    });
  }
  const nextAlarm = enabled ? Math.min(...FEEDS.map((f) => out[f.name].nextAt)) : null;
  return { states: out, wroteStatus: writeStatus, nextAlarm };
}

/** Durable Object running the cycle on an alarm. A cron (every minute) calls
 * /ensure so the alarm is re-armed if it ever died. */
export class Poller {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  enabled() {
    return this.env.POLLER_ENABLED === "true";
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ensure") {
      if (this.enabled() && (await this.state.storage.getAlarm()) === null) {
        await this.state.storage.setAlarm(Date.now() + 1000);
        return new Response("armed");
      }
      return new Response(this.enabled() ? "running" : "disabled");
    }
    if (path === "/status") {
      const states = (await this.state.storage.get("states")) || {};
      return Response.json(statusDoc(states, Date.now() / 1000, this.enabled()));
    }
    return new Response("not found", { status: 404 });
  }

  async alarm() {
    const now = Date.now() / 1000;
    const states = (await this.state.storage.get("states")) || {};
    const lastStatusAt = (await this.state.storage.get("lastStatusAt")) || 0;
    const res = await runCycle(states, {
      now,
      fetchFn: fetch,
      bucket: this.env.LIVE,
      lastStatusAt,
      enabled: this.enabled(),
    });
    await this.state.storage.put("states", res.states);
    if (res.wroteStatus) await this.state.storage.put("lastStatusAt", now);
    if (res.nextAlarm !== null) {
      // Never sooner than 1 s from now, whatever the schedule says.
      await this.state.storage.setAlarm(Math.max(res.nextAlarm, now + 1) * 1000);
    }
  }
}
