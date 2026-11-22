// Reference data: manifest, stations, AV/LD/MD up front, Cercanías núcleos
// lazily when the map shows them. Geometry files follow their timetables.
//
// The timetables cover yesterday + 7 days and the site rebuilds them daily,
// so a page left open (or an app built weeks ago) must pick up new ones:
// refresh() re-reads the manifest and reloads what changed. The Android app
// bundles a copy (offline start) and also knows the site's data/ (`remote`):
// it uses whichever is newer.

export async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  // Deployed files are pre-gzipped (.bin.gz). Decompress unless the host
  // already did (then the gzip magic bytes 1f 8b are gone).
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

export async function fetchManifest(base, timeoutMs = 10_000) {
  const r = await fetch(`${base}manifest.json`, { cache: "no-cache", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
  return r.json();
}

/** Is manifest `a` newer data than `b`? (`window_start` is YYYY-MM-DD.) */
export function newerData(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  return a.window_start > b.window_start || (a.window_start === b.window_start && (a.generated_at || 0) > (b.generated_at || 0));
}

/** Regions that cover a whole country, loaded up front: Spain's AV/LD/MD,
 * Great Britain (with Northern Ireland as its own small region) and Ireland. */
export const NATIONAL = ["ld", "uk", "ie"];

/** Tell the engine which time zone a region's timetable is in (the
 * manifest's `tz`; docs/plan-europe.md A2). Older data has none: the engine
 * then goes by the region's code. */
export function setZone(engine, region) {
  if (!region?.tz || !engine.setRegionZone) return;
  try {
    engine.setRegionZone(region.code, region.tz, Date.now());
  } catch (e) {
    console.warn("time zone", region.code, region.tz, e.message);
  }
}

export class RefData {
  constructor(engine, base, remote = "") {
    this.engine = engine;
    this.base = base;
    this.remote = remote;
    this.manifest = null;
    this.loaded = new Set();
    this.loading = new Map();
    this.networkFile = null;
    this.checkedAt = 0;
  }

  async start() {
    const [own, far] = await Promise.all([
      fetchManifest(this.base).catch((e) => (this.remote ? null : Promise.reject(e))),
      this.remote ? fetchManifest(this.remote, 8_000).catch((e) => (console.warn("remote data", e.message), null)) : null,
    ]);
    if (!own && !far) throw new Error("manifest: no data");
    if (newerData(far, own)) this.base = this.remote;
    this.manifest = newerData(far, own) ? far : own;
    this.checkedAt = Date.now();
    this.engine.loadStations(await fetchBytes(this.base + this.manifest.stations.file));
    // Spain's AV/LD/MD up front; the UK and Ireland are one region each,
    // also up front.
    for (const code of NATIONAL) if (this.region(code)) await this.loadRegion(code);
    // Timetable-only operators (OUIGO) are small; load them up front.
    for (const r of this.manifest.regions.filter((r) => r.live === false)) {
      await this.loadRegion(r.code).catch((e) => console.warn("region", r.code, e));
    }
    this.loadNetwork();
  }

  /** The rail network by kind of track (when the build has one), loaded when
   * the browser is idle; the map draws the trains' legs until then. */
  loadNetwork() {
    const n = this.manifest?.network;
    if (!n) return;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(async () => {
      try {
        this.engine.loadNetwork(await fetchBytes(this.base + n.file));
        this.networkFile = n.file;
        this.onGeometry?.("network");
      } catch (e) {
        console.warn("network", e); // the map keeps the trains' legs
      }
    });
  }

  /**
   * Newer reference data published since this page loaded? Then reload the
   * stations and every timetable already loaded whose file changed (files
   * are content-hashed); the others load lazily from the new manifest.
   * Returns true when something was reloaded. Network errors: false.
   */
  async refresh() {
    this.checkedAt = Date.now();
    const base = this.remote || this.base;
    let m;
    try {
      m = await fetchManifest(base);
    } catch (e) {
      console.warn("data refresh", e.message);
      return false;
    }
    const old = this.manifest;
    if (!newerData(m, old)) return false;
    // Wait for loads in flight: they belong to the old manifest.
    await Promise.allSettled([...this.loading.values()]);
    this.base = base;
    this.manifest = m;
    if (m.stations.file !== old.stations.file) this.engine.loadStations(await fetchBytes(base + m.stations.file));
    const file = (man, code) => man.regions.find((r) => r.code === code)?.file;
    for (const code of [...this.loaded]) {
      if (file(m, code) === file(old, code)) continue;
      this.loaded.delete(code);
      await this.loadRegion(code).catch((e) => console.warn("region", code, e));
    }
    if (this.networkFile && m.network?.file && m.network.file !== this.networkFile) this.loadNetwork();
    return true;
  }

  /** Check for new data at most every `everyMs` (on a timer, or when the page comes back). */
  refreshIfDue(everyMs = 30 * 60_000) {
    return Date.now() - this.checkedAt >= everyMs ? this.refresh() : Promise.resolve(false);
  }

  /** Unix seconds when the NAP last updated a timetable-only source, if known. */
  napDate() {
    const s = this.manifest?.sources?.find((x) => /NAP/.test(x.name));
    const t = s && Date.parse(s.last_modified);
    return t ? t / 1000 : null;
  }

  region(code) {
    return this.manifest?.regions.find((r) => r.code === code);
  }

  /** Load a region's timetable, then (without waiting) its track geometry. */
  loadRegion(code) {
    if (this.loaded.has(code)) return Promise.resolve();
    if (this.loading.has(code)) return this.loading.get(code);
    const r = this.region(code);
    if (!r) return Promise.resolve();
    const p = (async () => {
      setZone(this.engine, r);
      this.engine.loadTimetable(await fetchBytes(this.base + r.file), Date.now());
      this.loaded.add(code);
      if (r.geometry) {
        const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
        idle(async () => {
          try {
            this.engine.loadGeometry(await fetchBytes(this.base + r.geometry.file));
            this.onGeometry?.(code);
          } catch (e) {
            console.warn("geometry", code, e); // trains stay on straight lines
          }
        });
      }
    })().finally(() => this.loading.delete(code));
    this.loading.set(code, p);
    return p;
  }

  /** Load every Cercanías núcleo not loaded yet, one at a time when the
   * browser is idle, so trains everywhere get their colour (delay) and
   * direction, not only where the user has zoomed in. Skipped when the
   * browser asks to save data. `onEach(code)` runs after each one. */
  async loadAllInBackground(onEach) {
    if (navigator.connection?.saveData) return;
    const idle = () => new Promise((r) => (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(r));
    const rest = (this.manifest?.regions || []).filter((r) => !NATIONAL.includes(r.code) && r.live !== false);
    rest.sort((a, b) => a.bytes - b.bytes); // small ones first: more colour sooner
    for (const r of rest) {
      if (this.loaded.has(r.code)) continue;
      await idle();
      try {
        await this.loadRegion(r.code);
        onEach?.(r.code);
      } catch (e) {
        console.warn("region", r.code, e);
      }
    }
  }

  /** Cercanías núcleos whose bounding box overlaps the given map bounds. */
  regionsIn(bounds) {
    const [w, s, e, n] = bounds;
    return (this.manifest?.regions || []).filter(
      (r) => r.code !== "ld" && r.live !== false && !(r.bbox[3] < w || r.bbox[1] > e || r.bbox[2] < s || r.bbox[0] > n),
    );
  }
}
