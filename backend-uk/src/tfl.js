// London Underground, DLR and Trams live (docs/data-sources-uk.md): TfL's
// arrival predictions, matched to the timetable's trips (tools/uk/tfl-gtfs.py
// --index), published as GTFS-Realtime TripUpdates at uk/rt/tfl_updates.pb.
//
// TfL publishes no positions for these trains, only each station's next
// arrivals ("Bank, Northern line to Morden, in 3 minutes"). A prediction is
// matched to the timetabled trip on that line, to that destination, due at
// that station nearest the predicted time; a trip's delay is the median of
// its predictions'. The app's engine then places the trip by its timetable
// shifted by that delay, as it does for National Rail.
//
// Three calls a minute (one per mode: TfL takes one mode per call), about
// 4,300 a day of TfL's 500 a minute. The key only in the `app_key` header.

export const MODES = ["tube", "dlr", "tram"];
/** A prediction further than this from every timetabled call isn't matched. */
export const MATCH_WINDOW_S = 15 * 60;
/** The index (data/uk/tfl-index.json) is fetched again after this long. */
export const INDEX_TTL_MS = 6 * 3600_000;
const API = "https://api.tfl.gov.uk";
const UA = "Metranos-TrainRadar (+https://mytrainradar.com)";

/** London's date (YYYYMMDD), weekday (0 = Monday) and seconds since midnight at `ms`. */
export function londonClock(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  return { date: `${parts.year}${parts.month}${parts.day}`, weekday: wd, secs: +parts.hour * 3600 + +parts.minute * 60 + +parts.second };
}

/**
 * The index as lookups: `${line}|${stop}` → [{ g, iv, off, dest, deps }]:
 * every interval (stopping pattern) of every group that calls at that stop,
 * its offset there, its last stop, and its journeys' departures (sorted, with
 * their index in the group = the trip id's last part).
 */
export function buildLookup(index) {
  const byStop = new Map();
  for (const g of index.groups || []) {
    const deps = new Map(); // interval id → [[dep, j], ...]
    g.j.forEach((x, j) => {
      if (!x) return;
      const [dep, iv] = x;
      if (!deps.has(String(iv))) deps.set(String(iv), []);
      deps.get(String(iv)).push([dep, j]);
    });
    for (const [iv, run] of Object.entries(g.iv || {})) {
      const list = (deps.get(iv) || []).sort((a, b) => a[0] - b[0]);
      if (!list.length) continue;
      const dest = run[run.length - 1][0];
      for (const [stop, off] of run) {
        const k = `${g.l}|${stop}`;
        if (!byStop.has(k)) byStop.set(k, []);
        byStop.get(k).push({ g, off, dest, deps: list });
      }
    }
  }
  return byStop;
}

/** The journey in `deps` ([[dep, j]], sorted) whose call at `off` is nearest `t`; null if none within the window. */
function nearest(deps, off, t) {
  let lo = 0;
  let hi = deps.length;
  const want = t - off;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (deps[mid][0] < want) lo = mid + 1;
    else hi = mid;
  }
  let best = null;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= deps.length) continue;
    const d = Math.abs(deps[i][0] - want);
    if (d <= MATCH_WINDOW_S && (!best || d < best.d)) best = { d, dep: deps[i][0], j: deps[i][1] };
  }
  return best;
}

/**
 * Predictions → trip updates. `preds`: TfL Prediction objects (lineId,
 * naptanId, destinationNaptanId, expectedArrival). Trips run on their
 * service day: today's, or yesterday's for times past midnight (TfL's
 * hours 24-26).
 */
export function matchPredictions(lookup, preds, now) {
  const clock = londonClock(now);
  const yesterday = londonClock(now - 86_400_000);
  const delays = new Map(); // trip id → { delays: [], date }
  let matched = 0;
  for (const p of preds) {
    if (!p.destinationNaptanId || !p.naptanId || !p.lineId || !p.expectedArrival) continue;
    const at = Date.parse(p.expectedArrival);
    if (!Number.isFinite(at)) continue;
    // The predicted time in seconds of today's service day.
    const t = clock.secs + Math.round((at - now) / 1000);
    let best = null;
    for (const c of lookup.get(`${p.lineId}|${p.naptanId}`) || []) {
      if (c.dest !== p.destinationNaptanId) continue;
      for (const [day, tt] of [
        [clock, t],
        [yesterday, t + 86_400],
      ]) {
        if (!c.g.d.includes(day.weekday)) continue;
        const n = nearest(c.deps, c.off, tt);
        if (n && (!best || n.d < best.d)) best = { d: n.d, trip: `${c.g.p}:${n.j}`, delay: tt - (n.dep + c.off), date: day.date };
      }
    }
    if (!best) continue;
    matched++;
    if (!delays.has(best.trip)) delays.set(best.trip, { delays: [], date: best.date });
    delays.get(best.trip).delays.push(best.delay);
  }
  const ts = Math.round(now / 1000);
  const updates = [...delays].map(([trip, x]) => {
    const s = x.delays.sort((a, b) => a - b);
    return { id: trip, tripId: trip, startDate: x.date, delay: s[s.length >> 1], timestamp: ts };
  });
  return { updates, matched, predictions: preds.length };
}

/** GET a Unified API path as JSON with the key in the header. */
async function tflGet(path, env, fetchFn) {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (env.UK_TFL_APP_KEY) headers.app_key = env.UK_TFL_APP_KEY;
  const r = await fetchFn(API + path, { headers });
  if (!r.ok) throw new Error(`TfL ${path.split("?")[0]}: HTTP ${r.status}`);
  return r.json();
}

let cached = null; // { at, lookup, generated }

/** The index from the site (data/uk/tfl-index.json), kept for INDEX_TTL_MS. */
export async function loadIndex(env, fetchFn, now) {
  if (cached && now - cached.at < INDEX_TTL_MS) return cached;
  const base = (env.SITE_URL || "https://mytrainradar.com/").replace(/\/?$/, "/");
  const r = await fetchFn(`${base}data/uk/tfl-index.json`, { headers: { "User-Agent": UA } });
  if (!r.ok) {
    if (cached) return cached; // keep the old one until the site answers
    throw new Error(`tfl-index.json: HTTP ${r.status}`);
  }
  const index = await r.json();
  cached = { at: now, lookup: buildLookup(index), generated: index.generated || null };
  return cached;
}

/** For tests: forget the cached index. */
export function resetIndex() {
  cached = null;
}

/**
 * One minute's TfL work: the predictions of the three modes, matched, written
 * to uk/rt/tfl_updates.pb. Returns the status entry (never throws).
 */
export async function refreshTfl({ env, fetchFn = fetch, now = Date.now(), encode }) {
  const out = { at: new Date(now).toISOString(), ok: false };
  if (env.UK_TFL_ENABLED === "false") return { ...out, error: "off (UK_TFL_ENABLED)" };
  try {
    const { lookup, generated } = await loadIndex(env, fetchFn, now);
    const preds = [];
    for (const m of MODES) preds.push(...(await tflGet(`/Mode/${m}/Arrivals?count=-1`, env, fetchFn)));
    const { updates, matched, predictions } = matchPredictions(lookup, preds, now);
    await env.LIVE.put("uk/rt/tfl_updates.pb", encode(updates, Math.round(now / 1000)), {
      httpMetadata: { contentType: "application/x-protobuf", cacheControl: "public, max-age=30" },
    });
    Object.assign(out, { ok: true, predictions, matched, trips: updates.length, index: generated });
  } catch (e) {
    out.error = String(e?.message || e).slice(0, 200);
  }
  return out;
}
