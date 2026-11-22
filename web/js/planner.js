// Plan ahead (docs/plan-future.md): a second engine, timetable only, with
// the plan-ahead files (data/plan/, 63 days as far as each source goes).
// Loaded only when the user picks a date or time, region by region; live
// delays never reach it.
import { fetchBytes, fetchManifest, setZone } from "./data.js";

/** Regions to load for places `points` ([lon, lat]): every region without
 * a small area (long distance, OUIGO, Great Britain, Northern Ireland) and
 * the Cercanías núcleos within `d` degrees of a point. */
export function planCodes(manifest, points, d = 0.05) {
  const out = [];
  for (const r of manifest?.regions || []) {
    const local = /^\d+$/.test(r.code); // Cercanías núcleos are numbered
    const near = points.some(([lon, lat]) => !(r.bbox[3] < lon - d || r.bbox[1] > lon + d || r.bbox[2] < lat - d || r.bbox[0] > lat + d));
    if (!local || near) out.push(r.code);
  }
  return out;
}

/** The last day (YYYY-MM-DD) any region has trains, or null. */
export function planUntil(manifest) {
  const days = (manifest?.regions || []).map((r) => r.until).filter(Boolean).sort();
  return days.length ? days[days.length - 1] : null;
}

export class Planner {
  /** `makeEngine()` gives a fresh engine; `base` is the plan's folder URL. */
  constructor(makeEngine, base) {
    this.makeEngine = makeEngine;
    this.base = base;
    this.engine = null;
    this.manifest = null;
    this.loaded = new Set();
    this.starting = null;
  }

  start() {
    if (!this.starting) {
      this.starting = (async () => {
        const m = await fetchManifest(this.base);
        const e = this.makeEngine();
        e.loadStations(await fetchBytes(this.base + m.stations.file));
        this.manifest = m;
        this.engine = e;
      })();
      this.starting.catch(() => (this.starting = null)); // try again next time
    }
    return this.starting;
  }

  get until() {
    return planUntil(this.manifest);
  }

  /** Ready to answer for places `points` (within `d` degrees): the plan
   * and their regions loaded. */
  async ready(points, d = 0.05) {
    await this.start();
    for (const code of planCodes(this.manifest, points, d)) {
      if (this.loaded.has(code)) continue;
      const r = this.manifest.regions.find((x) => x.code === code);
      setZone(this.engine, r);
      this.engine.loadTimetable(await fetchBytes(this.base + r.file), Date.now());
      this.loaded.add(code);
    }
    return this.engine;
  }
}
