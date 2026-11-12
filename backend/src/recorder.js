// History recorder (phase C3). Runs the same engine as the app on the
// feeds the poller stored in R2 and:
// - writes every finished run to D1 (`trips`),
// - writes `rt/summary.json` (every live train: delay, next stop, status),
//   for the Android widget and alerts,
// - writes `rt/recorder.json` (health and database size) for monitoring,
// - logs every new raw GPS fix to the private bucket (`gps/`, kept 14 days;
//   see gpslog.js), to check the track network against real positions,
// - writes `rt/fixes.tsv`: since when each AV/LD/MD GPS position (the feed
//   gives them no time) has stayed put, so apps opened later don't take a
//   frozen position for a fresh one (trains "hours late" at their last fix).
// The engine is passed in, so this runs in tests on the real WebAssembly.

import { dbStats, writeTrips } from "./history.js";
import { GpsLog } from "./gpslog.js";
import { ReplayStore } from "./replay.js";
import { NoticeLog } from "./notices.js";

export const CYCLE_MS = 60_000;
/** A feed the poller hasn't fetched for this long is treated as empty:
 * its trains are not recorded. */
export const STALE_FEED_MS = 10 * 60_000;
/** How often to check whether the reference data was redeployed. */
export const REFDATA_CHECK_MS = 60 * 60_000;
/** Save the runs in progress every this many cycles. */
export const SAVE_EVERY = 5;
export const SUMMARY_CACHE = "public, max-age=30";
export const FIXES_KEY = "rt/fixes.tsv";

async function bytesOf(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Pre-gzipped .bin files: decompress unless the host already did.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  return bytes;
}

/** Identity of a deployed reference-data set (changes on redeploy). */
export function manifestKey(m) {
  return [m.stations?.file, ...(m.regions || []).map((r) => `${r.file}+${r.geometry?.file || ""}`)].join("|");
}

/** Load stations and every region with live data (AV/LD/MD and all
 * Cercanías núcleos) plus their track geometry. */
export async function loadRefdata(engine, base, manifest, { fetchFn = fetch, now = Date.now() } = {}) {
  const get = async (file) => {
    const r = await fetchFn(base + file);
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return bytesOf(r);
  };
  engine.loadStations(await get(manifest.stations.file));
  let regions = 0;
  for (const r of manifest.regions || []) {
    if (r.live === false) continue; // timetable-only operators: nothing to record
    engine.loadTimetable(await get(r.file), now);
    if (r.geometry) engine.loadGeometry(await get(r.geometry.file));
    regions += 1;
  }
  return regions;
}

export async function fetchManifest(base, fetchFn = fetch) {
  const r = await fetchFn(`${base}manifest.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
  return r.json();
}

/**
 * One cycle. `seen`: feed path → Last-Modified already ingested (updated in
 * place). Returns what happened, for the status document.
 */
export async function recordCycle({ engine, live, db, now, seen }) {
  const obj = await live.get("rt/status.json");
  if (!obj) throw new Error("no rt/status.json yet");
  const status = JSON.parse(await obj.text());
  const feeds = JSON.parse(engine.feedsJson()).filter((f) => !f.key.startsWith("al")); // alerts aren't recorded
  let fresh = 0;
  for (const f of feeds) {
    const s = status.feeds?.[f.path];
    const fetchedAt = Date.parse(s?.fetchedAt || "") || 0;
    if (!s?.renfeLastModified || now - fetchedAt > STALE_FEED_MS) {
      // Not fetched lately: forget its trains rather than record old data.
      if (seen[f.path] !== "stale") {
        engine.ingest(f.key, new Uint8Array(0), now);
        seen[f.path] = "stale";
      }
      continue;
    }
    fresh += 1;
    if (seen[f.path] === s.renfeLastModified) continue;
    const o = await live.get(`rt/${f.path}`);
    if (!o) continue;
    engine.ingest(f.key, new Uint8Array(await o.arrayBuffer()), now);
    seen[f.path] = s.renfeLastModified;
  }
  const rows = JSON.parse(engine.recordJson(now));
  const written = db ? await writeTrips(db, rows) : 0;
  const summary = engine.summaryJson(now);
  await live.put("rt/summary.json", summary, {
    httpMetadata: { contentType: "application/json", cacheControl: SUMMARY_CACHE },
  });
  await live.put(FIXES_KEY, engine.fixSinceText(), {
    httpMetadata: { contentType: "text/tab-separated-values; charset=utf-8", cacheControl: SUMMARY_CACHE },
  });
  return { freshFeeds: fresh, finished: rows.length, written, active: engine.recorderActive(), trains: summary.length > 2 ? JSON.parse(summary).length : 0 };
}

/**
 * Renfe's notices (alerts feeds), for the notices history: ingested only
 * here, when they changed; a feed not fetched lately counts as empty.
 */
export async function ingestAlerts({ engine, live, now, seen }) {
  const obj = await live.get("rt/status.json");
  if (!obj) return 0;
  const status = JSON.parse(await obj.text());
  let fresh = 0;
  for (const f of JSON.parse(engine.feedsJson()).filter((x) => x.key.startsWith("al"))) {
    const s = status.feeds?.[f.path];
    const fetchedAt = Date.parse(s?.fetchedAt || "") || 0;
    if (!s?.renfeLastModified || now - fetchedAt > STALE_FEED_MS) {
      if (seen[f.path] !== "stale") {
        engine.ingest(f.key, new Uint8Array(0), now);
        seen[f.path] = "stale";
      }
      continue;
    }
    fresh += 1;
    if (seen[f.path] === s.renfeLastModified) continue;
    const o = await live.get(`rt/${f.path}`);
    if (!o) continue;
    engine.ingest(f.key, new Uint8Array(await o.arrayBuffer()), now);
    seen[f.path] = s.renfeLastModified;
  }
  return fresh;
}

/** Health document at `rt/recorder.json` (public; no secrets, no personal data). */
export async function writeRecorderStatus(live, doc) {
  await live.put("rt/recorder.json", JSON.stringify(doc), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=10" },
  });
}

/**
 * Keeps an engine with all reference data loaded and records every
 * `CYCLE_MS`. `makeEngine()` returns a fresh engine; `storage` is the
 * Durable Object storage (runs in progress survive restarts).
 */
export class RecorderCore {
  constructor({ makeEngine, storage, env, fetchFn = fetch }) {
    this.makeEngine = makeEngine;
    this.storage = storage;
    this.env = env;
    this.fetchFn = fetchFn;
    this.engine = null;
    this.refKey = null;
    this.refCheckedAt = 0;
    this.seen = {};
    this.cycles = 0;
    this.totals = { finished: 0, written: 0 };
    // Replay frames (TrainRadar Pro): where every train was, each minute.
    this.replay = env.REPLAY_ENABLED === "false" ? null : new ReplayStore(env.LIVE);
    // Renfe's notices, a file per day (TrainRadar Pro: notices history).
    this.notices = env.NOTICES_ENABLED === "false" ? null : new NoticeLog(env.LIVE);
    // Raw GPS fixes (private bucket), to check the track network later.
    this.gps = env.GPS_LOG_ENABLED === "false" || !env.ARCHIVE ? null : new GpsLog(env.ARCHIVE);
  }

  enabled() {
    return this.env.RECORDER_ENABLED === "true";
  }

  base() {
    return String(this.env.REFDATA_BASE || "").replace(/\/?$/, "/");
  }

  /** Load (or reload, after a redeploy) the reference data. */
  async ensureEngine(now) {
    if (this.engine && now - this.refCheckedAt < REFDATA_CHECK_MS) return;
    this.refCheckedAt = now;
    const manifest = await fetchManifest(this.base(), this.fetchFn);
    const key = manifestKey(manifest);
    if (this.engine && key === this.refKey) return;
    const next = await this.makeEngine();
    await loadRefdata(next, this.base(), manifest, { fetchFn: this.fetchFn, now });
    const saved = this.engine ? this.engine.recorderSave() : await this.storage.get("runs");
    if (saved) next.recorderLoad(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
    // How long positions have been frozen, from before this (re)start.
    const fixes = this.engine ? this.engine.fixSinceText() : await (await this.env.LIVE.get(FIXES_KEY))?.text();
    if (fixes) next.applyFixSince(fixes, now);
    this.engine?.free?.();
    this.engine = next;
    this.refKey = key;
    this.seen = {}; // ingest every feed again into the new engine
  }

  async cycle(now = Date.now()) {
    const started = Date.now();
    let res = null;
    let error = null;
    try {
      await this.ensureEngine(now);
      res = await recordCycle({ engine: this.engine, live: this.env.LIVE, db: this.env.HISTORY, now, seen: this.seen });
      if (this.replay) {
        // A replay problem must never stop the history being recorded.
        await this.replay.add(this.engine.replayFrameJson(now), now).catch((e) => {
          res.replayError = String(e?.message || e);
        });
        res.replay = this.replay.status();
      }
      if (this.notices) {
        // Nor a notices problem.
        try {
          if (await ingestAlerts({ engine: this.engine, live: this.env.LIVE, now, seen: this.seen })) {
            await this.notices.add(this.engine.incidentsJson(now), now);
          }
        } catch (e) {
          res.noticesError = String(e?.message || e);
        }
        res.notices = this.notices.status();
      }
      if (this.gps) {
        // Nor a GPS-log problem.
        await this.gps.add(this.engine.gpsFixesJson(), now).catch((e) => {
          res.gpsError = String(e?.message || e);
        });
        res.gps = this.gps.status();
      }
      this.totals.finished += res.finished;
      this.totals.written += res.written;
      this.cycles += 1;
      if (this.cycles % SAVE_EVERY === 0) await this.storage.put("runs", this.engine.recorderSave());
    } catch (e) {
      error = String(e?.message || e);
    }
    if (error || this.cycles % SAVE_EVERY === 1) {
      const doc = {
        updatedAt: new Date(now).toISOString(),
        ok: !error,
        error,
        cycleMs: Date.now() - started,
        active: this.engine?.recorderActive() ?? 0,
        last: res,
        sinceStart: this.totals,
        db: (await this.storage.get("db")) || null,
      };
      await writeRecorderStatus(this.env.LIVE, doc).catch(() => {});
    }
    return { res, error };
  }

  /** Save before the object is evicted or redeployed (best effort). */
  async save() {
    await this.replay?.flush(false).catch(() => {});
    await this.notices?.flush(false).catch(() => {});
    await this.gps?.flush().catch(() => {});
    if (this.engine) await this.storage.put("runs", this.engine.recorderSave());
  }
}

export { dbStats };
