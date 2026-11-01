// Polling Renfe's realtime feeds through the pass-through. Timing comes from
// the engine's FeedPoller: never faster than each feed refreshes, jitter,
// exponential backoff on errors, and nothing while the tab is hidden.
import { FeedPoller } from "../pkg/engine.js";

export class Feeds {
  constructor(engine, base, { onUpdate, onError }) {
    this.engine = engine;
    this.base = base;
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.feeds = JSON.parse(engine.feedsJson()).map((f) => ({
      ...f,
      poller: new FeedPoller(f.interval),
      timer: 0,
      last: 0,
      lastModified: null,
    }));
    document.addEventListener("visibilitychange", () => this.visibility());
  }

  start() {
    for (const f of this.feeds) this.fetch(f);
  }

  async fetch(f) {
    clearTimeout(f.timer);
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
    const hidden = document.visibilityState === "hidden";
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
    return Math.max(0, ...this.feeds.filter((f) => f.key.startsWith("vp")).map((f) => f.last));
  }

  /** Last-Modified (ms) of a feed, as reported by Renfe, if known. */
  modified(key) {
    return this.feeds.find((f) => f.key === key)?.lastModified ?? null;
  }

  failing() {
    return this.feeds.some((f) => f.poller.failures() > 0);
  }
}
