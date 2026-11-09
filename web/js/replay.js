// Replay ("moviola", TrainRadar Pro): where every train was at a past
// moment, from the recorder's hourly files in the live bucket
// (backend/src/replay.js): one frame per minute, trains moved smoothly
// between frames. Times are UTC in the files; the app shows Madrid time.
import { FLAG } from "./map.js";
import { trainLabel } from "./format.js";

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-08T14" (UTC hour) for a time. */
export function hourId(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

/** Madrid's offset from UTC (minutes) at `ms`. */
function madridOffset(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** A Madrid date ("2026-11-08") and time ("14:32") as a moment (ms). */
export function madridToMs(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const once = guess - madridOffset(guess) * 60_000;
  return guess - madridOffset(once) * 60_000; // right across a clock change
}

/** A moment as Madrid { date: "2026-11-08", time: "14:32" }. */
export function msToMadrid(ms) {
  const local = new Date(Math.floor(ms / 60_000) * 60_000 + madridOffset(ms) * 60_000);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
}

/** The bucket's root from the live feeds' base (".../rt/" → ".../"). */
export function replayRoot(liveBase) {
  return liveBase ? liveBase.replace(/rt\/?$/, "") : "";
}

export function hourUrl(root, id) {
  return `${root}replay/${id.slice(0, 10)}/${id.slice(11, 13)}.json.gz`;
}

/** Delay class as the live map colours it: 0 < 5 min, 1 < 15, 2 more, 3 unknown. */
export function delayClass(delaySecs) {
  if (delaySecs === null || delaySecs === undefined) return 3;
  return delaySecs < 300 ? 0 : delaySecs < 900 ? 1 : 2;
}

async function bytesToJson(res) {
  const b = new Uint8Array(await res.arrayBuffer());
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const s = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(s).text());
  }
  return JSON.parse(new TextDecoder().decode(b));
}

/** Loads hour files (cached) and answers "where was everyone at t". */
export class ReplayData {
  constructor(root, fetchFn = (...a) => fetch(...a)) {
    this.root = root;
    this.fetchFn = fetchFn;
    this.hours = new Map(); // id → Promise<doc|null>
  }

  /** The first hour with data ({ hour }), or null. */
  async first() {
    try {
      const r = await this.fetchFn(`${this.root}replay/first.json`, { cache: "no-cache" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  hour(id) {
    if (!this.hours.has(id)) {
      const p = this.fetchFn(hourUrl(this.root, id))
        .then((r) => (r.ok ? bytesToJson(r) : null))
        .catch(() => null);
      this.hours.set(id, p);
      // The current hour is still being written: don't keep a missing or
      // partial file for long.
      p.then((doc) => {
        if (!doc || id === hourId(Date.now())) setTimeout(() => this.hours.delete(id), 60_000);
      });
    }
    return this.hours.get(id);
  }

  /** Trains at `ms`: [] when there's no data for that moment. */
  async at(ms) {
    const doc = await this.hour(hourId(ms));
    if (!doc) return [];
    // Past the hour's last frame: move on towards the next hour's first.
    const t = ms / 1000;
    let next = null;
    if (doc.frames.length && t > doc.frames.at(-1)[0]) {
      const n = await this.hour(hourId(ms - (ms % 3_600_000) + 3_600_000));
      const f = n?.frames?.[0];
      if (f) next = { t: f[0], byKey: new Map(f[1].map((r) => [n.trains[r[0]][0], r])) };
    }
    return trainsAt(doc, t, next);
  }
}

/**
 * Trains at `t` (unix s) in an hour `doc`: moved in a straight line from
 * their frame before to their frame after (when ≤ 3 min apart), else left
 * where last seen (≤ 2 min ago). `next`: the next hour's first frame
 * ({ t, byKey }), for the minutes after this hour's last frame.
 */
export function trainsAt(doc, t, next = null) {
  const frames = doc.frames;
  let k = -1;
  for (let i = 0; i < frames.length && frames[i][0] <= t; i++) k = i;
  if (k < 0) return [];
  const [t0, rows0] = frames[k];
  let t1 = null;
  let rowAfter = () => null;
  if (k + 1 < frames.length) {
    t1 = frames[k + 1][0];
    const m = new Map(frames[k + 1][1].map((r) => [r[0], r]));
    rowAfter = (i) => m.get(i);
  } else if (next) {
    t1 = next.t;
    rowAfter = (i) => next.byKey.get(doc.trains[i][0]);
  }
  const gap = t1 === null ? Infinity : t1 - t0;
  if (gap > 180 && t - t0 > 120) return [];
  const f = gap <= 180 ? (t - t0) / gap : 0;
  const out = [];
  for (const [i, lon0, lat0, bearing, delay, flags] of rows0) {
    const r1 = gap <= 180 ? rowAfter(i) : null;
    const lon = r1 ? lon0 + (r1[1] - lon0) * f : lon0;
    const lat = r1 ? lat0 + (r1[2] - lat0) * f : lat0;
    const [key, route, number, dest] = doc.trains[i];
    out.push({ key, route, number, dest, lon: lon / 1e5, lat: lat / 1e5, bearing: bearing < 0 ? null : bearing, delay, flags });
  }
  return out;
}

/** The map's train layer data for replayed trains (same look as live). */
export function replayGeoJson(trains, lineColor = () => null) {
  return {
    type: "FeatureCollection",
    features: trains.map((tr, i) => {
      const flags = tr.flags || 0;
      const props = {
        i,
        c: delayClass(tr.delay),
        a: 0,
        s: flags & FLAG.stopped ? 1 : 0,
        l: flags & FLAG.likely ? 1 : 0,
        sch: flags & FLAG.scheduled ? 1 : 0,
        t: flags & FLAG.scheduled ? "ouigo" : flags & FLAG.commuter ? "cer" : flags & FLAG.highSpeed ? "av" : flags & FLAG.medium ? "md" : "ld",
        dim: 0,
      };
      if (tr.bearing !== null) props.b = tr.bearing;
      const lb = trainLabel(tr.route, tr.number, tr.delay, props.t === "cer");
      if (lb) props.lb = lb;
      const lc = props.t === "cer" && tr.route ? lineColor(tr.route) : null;
      if (lc) props.lc = lc;
      return { type: "Feature", id: i, geometry: { type: "Point", coordinates: [tr.lon, tr.lat] }, properties: props };
    }),
  };
}
