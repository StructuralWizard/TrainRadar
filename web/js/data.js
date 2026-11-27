// Reference data: manifest, stations, AV/LD/MD up front, Cercanías núcleos
// lazily when the map shows them. Geometry files follow their timetables.
//
// The timetables cover yesterday + 7 days and the site rebuilds them daily,
// so a page left open (or an app built weeks ago) must pick up new ones:
// refresh() re-reads the manifest and reloads what changed. The Android app
// bundles a copy (offline start) and also knows the site's data/ (`remote`):
// it uses whichever is newer.

// A copy for offline use (the Android app, which downloads each country's
// data from the site the first time it's opened): files from another
// origin than the page's go into the Cache API, and come from there when
// the network fails. Data files are content-hashed, so a cached one never
// goes stale: it's used without asking the network; the manifest is asked
// for first, and the copy used only offline. The website's own files (same
// origin) are left to the browser's cache.
const CACHE = "trainradar-data-v1";
const cacheApi = () => (typeof caches !== "undefined" ? caches : null);
const isFar = (url) => {
  try {
    return typeof location !== "undefined" && new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
};
async function cached(url) {
  if (!cacheApi() || !isFar(url)) return null;
  try {
    return (await (await caches.open(CACHE)).match(url)) || null;
  } catch {
    return null;
  }
}
async function keep(url, r) {
  if (!cacheApi() || !isFar(url)) return;
  try {
    await (await caches.open(CACHE)).put(url, r);
  } catch (e) {
    console.warn("offline copy", e?.message); // full storage: the app still works online
  }
}

/** Drop the offline copies under `base` that `manifest` no longer names
 * (yesterday's timetables), so each country keeps one copy. */
export async function pruneOffline(base, manifest) {
  if (!cacheApi() || !isFar(base) || !manifest) return;
  try {
    const c = await caches.open(CACHE);
    const named = new Set(
      [manifest.stations?.file, manifest.network?.file, ...(manifest.regions || []).flatMap((r) => [r.file, r.geometry?.file])]
        .filter(Boolean)
        .map((f) => new URL(base + f, location.href).href),
    );
    named.add(new URL(`${base}manifest.json`, location.href).href);
    for (const req of await c.keys()) {
      const u = req.url;
      if (u.startsWith(new URL(base, location.href).href) && !u.slice(new URL(base, location.href).href.length).includes("/") && !named.has(u)) await c.delete(req);
    }
  } catch (e) {
    console.warn("offline prune", e?.message);
  }
}

export async function fetchBytes(url) {
  let r = await cached(url);
  if (!r) {
    r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    await keep(url, r.clone());
  }
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
  const url = `${base}manifest.json`;
  let r;
  try {
    r = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
  } catch (e) {
    // Offline: the copy kept the last time, if any.
    const copy = await cached(url);
    if (!copy) throw e;
    return copy.json();
  }
  await keep(url, r.clone());
  return r.json();
}

/** Is manifest `a` newer data than `b`? (`window_start` is YYYY-MM-DD.) */
export function newerData(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  return a.window_start > b.window_start || (a.window_start === b.window_start && (a.generated_at || 0) > (b.generated_at || 0));
}

/** Regions that cover a whole country, loaded up front: Spain's AV/LD/MD,
 * Great Britain (with Northern Ireland as its own small region), Ireland
 * France's TGV and Intercités (its TER areas load like núcleos), Finland's
 * long-distance trains, Norway and the Netherlands, Switzerland's and
 * Poland's long-distance trains, Sweden. */
export const NATIONAL = ["ld", "uk", "uk-tfl", "ie", "fr", "fi", "no", "nl", "ch", "se", "pl", "at", "cz", "it", "dk", "hu", "de", "be", "au-nsw", "au-vic", "nz-wlg", "nz-akl", "sg", "pt", "pt-lis", "jp-tyo", "jp-kch", "jp-aom", "jp-ygt", "jp-tym", "jp-gif", "jp-mie", "jp-tks", "jp-kmm", "tw"];

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
    if (this.base === this.remote) pruneOffline(this.base, this.manifest);
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
    if (base === this.remote) pruneOffline(base, m);
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

  /** Cercanías núcleos (or TER areas) whose bounding box overlaps the given
   * map bounds. */
  regionsIn(bounds) {
    const [w, s, e, n] = bounds;
    return (this.manifest?.regions || []).filter(
      (r) => !NATIONAL.includes(r.code) && r.live !== false && !(r.bbox[3] < w || r.bbox[1] > e || r.bbox[2] < s || r.bbox[0] > n),
    );
  }
}
