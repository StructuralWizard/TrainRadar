// Delay-history teaser (phase C2b): a line's punctuality over the last 7
// days, from the public history API (backend/src/api.js). One request per
// line per page load (cached), only when a popup asks for it.

export const TEASER_DAYS = 7;
/** Below this many runs the figures say little: show nothing. */
export const MIN_RUNS = 5;
const RETRY_MS = 10 * 60_000;

/** Sum the API's per-day rows (`/v1/history/line/:line`) for one product.
 * Returns null when there are too few runs. Percentages are of runs with
 * a known outcome (cancelled runs counted apart). */
export function summarize(days, product) {
  const rows = (days || []).filter((d) => !product || d.product === product);
  let trips = 0;
  let onTime = 0;
  let late5 = 0;
  let late15 = 0;
  let cancelled = 0;
  let medianSum = 0;
  let medianWeight = 0;
  for (const d of rows) {
    trips += d.trips;
    onTime += d.on_time;
    late5 += d.late_5;
    late15 += d.late_15;
    cancelled += d.cancelled;
    if (d.median_delay !== null && d.median_delay !== undefined) {
      const w = d.on_time + d.late_5;
      medianSum += d.median_delay * w;
      medianWeight += w;
    }
  }
  const known = onTime + late5;
  if (trips < MIN_RUNS || known === 0) return null;
  const pct = (n) => Math.round((100 * n) / known);
  return {
    trips,
    onTimePct: pct(onTime),
    late5Pct: pct(late5),
    late15Pct: pct(late15),
    cancelled,
    medianMin: medianWeight ? Math.round(medianSum / medianWeight) : null,
    days: new Set(rows.map((d) => d.date)).size,
  };
}

export class HistoryCache {
  /** `base`: API origin ("" = no API: always null). `onLoad()` runs when an
   * answer arrives, so the caller can redraw. */
  constructor(base, { fetchFn = (...a) => fetch(...a), onLoad = () => {} } = {}) {
    this.base = base;
    this.fetchFn = fetchFn;
    this.onLoad = onLoad;
    this.lines = new Map(); // line → {at, days} | {at, failed}
  }

  /** Summary for a line+product: undefined while loading, null if none. */
  get(line, product, now = Date.now()) {
    if (!this.base || !line) return null;
    const e = this.lines.get(line);
    if (e?.days) return summarize(e.days, product);
    if (e && (e.loading || now - e.at < RETRY_MS)) return e.loading ? undefined : null;
    this.load(line, now);
    return undefined;
  }

  async load(line, now) {
    this.lines.set(line, { at: now, loading: true });
    try {
      const url = `${this.base}v1/history/line/${encodeURIComponent(line)}?days=${TEASER_DAYS}`;
      const r = await this.fetchFn(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      this.lines.set(line, { at: now, days: Array.isArray(body.days) ? body.days : [] });
    } catch {
      this.lines.set(line, { at: now, failed: true });
    }
    this.onLoad(line);
  }
}

/** Ranges of the history screen: 7 days for everyone, longer with Pro. */
export const RANGES = [7, 30, 90, 365];
export const FREE_DAYS = 7;

/** One history request (`kind`: line | train | station), cached per page. */
export class HistoryApi {
  constructor(base, fetchFn = (...a) => fetch(...a)) {
    this.base = base;
    this.fetchFn = fetchFn;
    this.cache = new Map();
  }

  get(kind, id, days) {
    if (!this.base) return Promise.reject(new Error("no history API"));
    const key = `${kind}/${id}/${days}`;
    if (!this.cache.has(key)) {
      const url = `${this.base}v1/history/${kind}/${encodeURIComponent(id)}?days=${days}`;
      const p = this.fetchFn(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      p.catch(() => this.cache.delete(key)); // try again next time
      this.cache.set(key, p);
    }
    return this.cache.get(key);
  }
}

/** Per day, for a chart: `[{date, onTimePct, runs}]` from line or station
 * rows (line rows filtered to one product). Days without data are left out. */
export function dailySeries(days, product = null) {
  const by = new Map();
  for (const d of days || []) {
    if (product && d.product !== undefined && d.product !== product) continue;
    const e = by.get(d.date) || { date: d.date, onTime: 0, known: 0, runs: 0 };
    const known = (d.on_time ?? 0) + (d.late_5 ?? 0);
    e.onTime += d.on_time ?? 0;
    e.known += known;
    e.runs += d.trips ?? d.calls ?? known;
    by.set(d.date, e);
  }
  return [...by.values()]
    .filter((e) => e.known > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date, onTimePct: Math.round((100 * e.onTime) / e.known), runs: e.runs }));
}
