// Reference data: manifest, stations, AV/LD/MD up front, Cercanías núcleos
// lazily when the map shows them. Geometry files follow their timetables.

async function fetchBytes(url) {
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

export class RefData {
  constructor(engine, base) {
    this.engine = engine;
    this.base = base;
    this.manifest = null;
    this.loaded = new Set();
    this.loading = new Map();
  }

  async start() {
    const r = await fetch(`${this.base}manifest.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
    this.manifest = await r.json();
    this.engine.loadStations(await fetchBytes(this.base + this.manifest.stations.file));
    await this.loadRegion("ld");
    // Timetable-only operators (OUIGO) are small; load them up front.
    for (const r of this.manifest.regions.filter((r) => r.live === false)) {
      await this.loadRegion(r.code).catch((e) => console.warn("region", r.code, e));
    }
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
      this.engine.loadTimetable(await fetchBytes(this.base + r.file), Date.now());
      this.loaded.add(code);
      if (r.geometry) {
        const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
        idle(async () => {
          try {
            this.engine.loadGeometry(await fetchBytes(this.base + r.geometry.file));
          } catch (e) {
            console.warn("geometry", code, e); // trains stay on straight lines
          }
        });
      }
    })().finally(() => this.loading.delete(code));
    this.loading.set(code, p);
    return p;
  }

  /** Cercanías núcleos whose bounding box overlaps the given map bounds. */
  regionsIn(bounds) {
    const [w, s, e, n] = bounds;
    return (this.manifest?.regions || []).filter(
      (r) => r.code !== "ld" && r.live !== false && !(r.bbox[3] < w || r.bbox[1] > e || r.bbox[2] < s || r.bbox[0] > n),
    );
  }
}
