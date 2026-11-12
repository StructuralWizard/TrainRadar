// Realtime feeds. Two sources (see source.js):
// - live: the central poller's bucket. status.json every 10 s; a feed is
//   downloaded only when Renfe changed it.
// - pass-through (fallback, or the only source without a live bucket): each
//   feed polled on its own timer from the engine's FeedPoller: never faster
//   than it refreshes, jitter, exponential backoff.
// Nothing is fetched while the tab is hidden.
import { FeedPoller } from "../pkg/engine.js";
import { STATUS_EVERY_MS, SourceSwitch, changedFeeds, feedUrl } from "./source.js";

const FIXES_EVERY_MS = 60_000;

export class Feeds {
  /** `live`: live bucket base ("" = none); `base`: pass-through base. */
  constructor(engine, base, { onUpdate, onError, live = "" }) {
    this.engine = engine;
    this.base = base;
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.source = new SourceSwitch({ live, fallback: base });
    this.statusTimer = 0;
    this.fixesAt = 0; // last read of fixes.tsv (live mode)
    this.feeds = JSON.parse(engine.feedsJson()).map((f) => ({
      ...f,
      poller: new FeedPoller(f.interval),
      timer: 0,
      last: 0,
      lastModified: null, // ms, when Renfe last changed the feed
      seenLm: null, // Last-Modified string of the bytes we have (live mode)
    }));
    document.addEventListener("visibilitychange", () => this.visibility());
  }

  hidden() {
    return document.visibilityState === "hidden";
  }

  start() {
    if (this.source.usingLive(Date.now())) this.tick();
    else for (const f of this.feeds) this.fetch(f);
  }

  /** Live mode: read status.json, download the feeds that changed. */
  async tick() {
    clearTimeout(this.statusTimer);
    const now = Date.now();
    if (!this.source.usingLive(now)) return this.toFallback();
    try {
      const r = await fetch(`${this.source.live}status.json?t=${Math.floor(now / STATUS_EVERY_MS)}`);
      if (!r.ok) throw new Error(`status HTTP ${r.status}`);
      const status = await r.json();
      await this.fixes(now);
      const seen = Object.fromEntries(this.feeds.map((f) => [f.path, f.seenLm]));
      for (const c of changedFeeds(status, seen)) {
        const f = this.feeds.find((x) => x.path === c.path);
        if (!f) continue;
        const res = await fetch(feedUrl(this.source.live, f.path, c.lastModified));
        if (!res.ok) throw new Error(`${f.path} HTTP ${res.status}`);
        this.engine.ingest(f.key, new Uint8Array(await res.arrayBuffer()), Date.now());
        f.seenLm = c.lastModified;
        const lm = Date.parse(c.lastModified);
        f.lastModified = Number.isNaN(lm) ? null : lm;
        f.last = Date.now();
        f.poller.success();
        this.onUpdate(f.key);
      }
      // Fetched by the poller recently enough? Then the data is current.
      for (const f of this.feeds) {
        const s = status.feeds?.[f.path];
        if (s?.ok && f.seenLm === s.renfeLastModified) f.last = Math.max(f.last, Date.parse(s.fetchedAt) || 0);
      }
      this.source.liveOk();
    } catch (e) {
      this.onError("live", e);
      if (this.source.liveFailed(Date.now())) return this.toFallback();
    }
    if (!this.hidden()) this.statusTimer = setTimeout(() => this.tick(), STATUS_EVERY_MS);
  }

  /**
   * Since when each AV/LD/MD position has stayed put, from the server's
   * recorder (that feed gives positions no time): once a minute. Without it
   * a frozen position would look fresh to an app just opened, and its train
   * hours late. Optional: missing before the server publishes it.
   */
  async fixes(now) {
    if (now - this.fixesAt < FIXES_EVERY_MS) return;
    this.fixesAt = now;
    try {
      const r = await fetch(`${this.source.live}fixes.tsv?t=${Math.floor(now / FIXES_EVERY_MS)}`);
      if (!r.ok) return;
      if (this.engine.applyFixSince(await r.text(), Date.now()) > 0) this.onUpdate("fixes");
    } catch {
      // not there (yet): positions are taken as fresh, as before
    }
  }

  /** Switch to the pass-through until the live bucket is worth retrying. */
  toFallback() {
    for (const f of this.feeds) this.fetch(f);
    const wait = Math.max(1000, this.source.fallbackUntil - Date.now());
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      for (const f of this.feeds) clearTimeout(f.timer);
      this.tick();
    }, wait);
  }

  async fetch(f) {
    clearTimeout(f.timer);
    if (this.source.usingLive(Date.now())) return; // live mode took over again
    try {
      const r = await fetch(this.base + f.path, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      this.engine.ingest(f.key, bytes, Date.now());
      f.poller.success();
      f.last = Date.now();
      // When Renfe last changed the feed (exposed by the pass-through).
      const lm = Date.parse(r.headers.get("Last-Modified") || "");
      f.lastModified = Number.isNaN(lm) ? null : lm;
      f.seenLm = null; // live mode re-downloads everything when it resumes
      this.onUpdate(f.key);
    } catch (e) {
      f.poller.failure();
      this.onError(f.key, e);
    }
    this.schedule(f);
  }

  schedule(f) {
    const ms = f.poller.nextDelayMs(Math.random());
    if (ms >= 0) f.timer = setTimeout(() => this.fetch(f), ms);
  }

  visibility() {
    const hidden = this.hidden();
    if (this.source.usingLive(Date.now())) {
      clearTimeout(this.statusTimer);
      if (!hidden) this.tick();
      return;
    }
    for (const f of this.feeds) {
      f.poller.setHidden(hidden);
      clearTimeout(f.timer);
      // Back in view: refresh now if the data is older than the interval.
      if (!hidden) {
        if (Date.now() - f.last >= f.interval * 1000) this.fetch(f);
        else this.schedule(f);
      }
    }
  }

  /** Time of the most recent successful vehicle-position update. */
  lastUpdate() {
    // The UK has no positions feed (plan 3): its trip updates then.
    const vp = this.feeds.filter((f) => f.key.startsWith("vp"));
    return Math.max(0, ...(vp.length ? vp : this.feeds).map((f) => f.last));
  }

  /** Last-Modified (ms) of a feed, as reported by Renfe, if known. */
  modified(key) {
    return this.feeds.find((f) => f.key === key)?.lastModified ?? null;
  }

  failing() {
    return this.feeds.some((f) => f.poller.failures() > 0) || this.source.fails > 0;
  }

  /** "live" or "fallback", for the about screen and tests. */
  mode() {
    return this.source.usingLive(Date.now()) ? "live" : "fallback";
  }
}
