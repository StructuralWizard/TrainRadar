// Where the realtime feeds come from (phase C2), as pure logic so it can be
// unit-tested.
//
// Live mode: the central poller's bucket (`rt/status.json` + `rt/<feed>.pb`,
// CDN-cached). The client reads status.json every 10 s and downloads a feed
// only when Renfe's Last-Modified for it has changed. After 3 consecutive
// failures it falls back to the pass-through Worker for 10 minutes, then
// tries live again.

export const STATUS_EVERY_MS = 10_000;
export const FAILS_TO_FALLBACK = 3;
export const FALLBACK_MS = 10 * 60_000;

export class SourceSwitch {
  /** `live`: base URL of the live bucket's rt/ (or "" for none);
   * `fallback`: base URL of the pass-through (or "" for none). */
  constructor({ live = "", fallback = "" } = {}) {
    this.live = live;
    this.fallback = fallback;
    this.fails = 0;
    this.fallbackUntil = 0;
  }

  /** Read from the live bucket right now? */
  usingLive(now) {
    if (!this.live) return false;
    if (!this.fallback) return true;
    return now >= this.fallbackUntil;
  }

  liveOk() {
    this.fails = 0;
  }

  /** A live request failed; after FAILS_TO_FALLBACK in a row, switch to the
   * fallback for FALLBACK_MS. Returns true when it just switched. */
  liveFailed(now) {
    this.fails += 1;
    if (this.fallback && this.fails >= FAILS_TO_FALLBACK) {
      this.fails = 0;
      this.fallbackUntil = now + FALLBACK_MS;
      return true;
    }
    return false;
  }
}

/** Feeds whose Renfe Last-Modified in `status` differs from what we last
 * downloaded (`seen`: path → Last-Modified string). Feeds the poller hasn't
 * fetched yet (no Last-Modified) are skipped. */
export function changedFeeds(status, seen) {
  const out = [];
  for (const [path, s] of Object.entries(status?.feeds || {})) {
    const lm = s?.renfeLastModified;
    if (lm && seen[path] !== lm) out.push({ path, lastModified: lm });
  }
  return out;
}

/** URL of one feed in the bucket for a given Last-Modified: the query makes
 * each version its own CDN cache entry, so a cached older copy is never
 * served after status.json says there's a new one. */
export function feedUrl(base, path, lastModified) {
  return `${base}${path}?v=${encodeURIComponent(lastModified)}`;
}
