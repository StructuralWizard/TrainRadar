// Germany: DB InfraGO's OpenBoards (DB API Marketplace, free plan) as trip
// updates. OpenBoards gives station departure boards, not journeys: each
// cycle asks for the boards of a few batches of up to 15 stations (DHIDs,
// the ids of DELFI's timetable), in turn through the list the deploy
// publishes (data/de/boards.txt: the busiest rail stations first), and
// merges every departure into its journey. Journeys become trip updates
// keyed by train number ("#8230"), as the engine looks DELFI's trips up,
// with each station's departure delay; a cancelled stop is skipped.
//
// Keys: DE_DB_CLIENT_ID and DE_DB_API_KEY (AGENTS.md), only in the
// DB-Client-Id and DB-Api-Key headers. The free plan allows 10 calls a
// second; this asks for one a second at most.

import { tripUpdatesFeed } from "./encode.js";

const API = "https://apis.deutschebahn.com/db-api-marketplace/apis/open-boards/v1/departures";
const CLIENT = "Metranos-TrainRadar";
/** Boards per call (the API's limit) and calls per cycle. */
export const PER_CALL = 15;
export const CALLS = 6;
/** The board's window: departures from a few minutes ago to this ahead. */
const BEHIND_MS = 5 * 60_000;
const AHEAD_MS = 45 * 60_000;
/** A journey is dropped two hours after its last known departure, or when
 * no board has shown it for four hours. */
const DONE_MS = 2 * 3_600_000;
const SILENT_MS = 4 * 3_600_000;
const STATIONS_TTL_MS = 6 * 3_600_000;

/** "2026-11-25T09:31:00+01:00": a time in Germany's offset (the board's
 * window is given in local time). */
export function berlinIso(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.timeZoneName.replace("GMT", "") || "+00:00"}`;
}

/** A departure board (OpenBoards' JSON) → [{ id, number, category, start,
 * cancelled, stop: { stopId, sched, best, cancelled, platform } }]. */
export function parseBoard(j) {
  const dhid = new Map((j.stopPlaces || []).map((s) => [s.evaNumber, s.ifopt]));
  const out = [];
  for (const d of j.departures || []) {
    const t = d.transport || {};
    const number = t.journeyNumber ?? d.journeyInfo?.headerJourneyNumber;
    const stopId = dhid.get(d.evaNumber);
    if (!d.journeyId || number == null || !stopId) continue;
    out.push({
      id: d.journeyId,
      number: String(number),
      category: t.category || "",
      start: d.journeyInfo?.scheduledStartTime || null,
      cancelled: !!d.journeyInfo?.journeyCancelled,
      stop: {
        stopId,
        sched: Date.parse(d.timeSchedule),
        best: d.time ? Date.parse(d.time) : null,
        real: d.timeType === "REAL" || d.timeType === "PREVIEW",
        cancelled: !!d.cancelled,
        platform: d.platform?.name || null,
      },
    });
  }
  return out;
}

/** Journeys seen on the boards, by OpenBoards' journey id. */
export class BoardState {
  constructor() {
    this.journeys = new Map();
    /** Where the next cycle starts in the station list. */
    this.cursor = 0;
  }

  apply(entries, now) {
    for (const e of entries) {
      const j = this.journeys.get(e.id) || { id: e.id, number: e.number, category: e.category, start: e.start, stops: {} };
      j.cancelled = e.cancelled;
      j.seen = now;
      j.stops[e.stop.stopId] = e.stop;
      this.journeys.set(e.id, j);
    }
  }

  expire(now) {
    let n = 0;
    for (const [id, j] of this.journeys) {
      const last = Math.max(...Object.values(j.stops).map((s) => s.best ?? s.sched));
      if (now - last > DONE_MS || now - j.seen > SILENT_MS) {
        this.journeys.delete(id);
        n++;
      }
    }
    return n;
  }

  /** Trip updates, one per train number (the latest seen if two share it). */
  tripUpdates() {
    const byNumber = new Map();
    for (const j of this.journeys.values()) {
      const o = byNumber.get(j.number);
      if (!o || j.seen > o.seen) byNumber.set(j.number, j);
    }
    const secs = (ms) => (ms == null ? null : Math.round(ms / 1000));
    return [...byNumber.values()].map((j) => {
      const stops = Object.values(j.stops).sort((a, b) => a.sched - b.sched);
      return {
        id: j.id,
        tripId: `#${j.number}`,
        startDate: j.start ? berlinIso(Date.parse(j.start)).slice(0, 10).replaceAll("-", "") : undefined,
        canceled: j.cancelled,
        label: `${j.category} ${j.number}`.trim(),
        stops: stops.map((s) => ({
          stopId: s.stopId,
          // Only a forecast or an actual time says anything about delay.
          departureDelay: s.best != null && s.real ? Math.round((s.best - s.sched) / 1000) : null,
          departureTime: secs(s.best ?? s.sched),
          skipped: s.cancelled,
        })),
      };
    });
  }

  toJSON() {
    return { cursor: this.cursor, journeys: [...this.journeys.values()] };
  }

  static from(o) {
    const st = new BoardState();
    st.cursor = o?.cursor || 0;
    for (const j of o?.journeys || []) st.journeys.set(j.id, j);
    return st;
  }
}

let state = null;
export const resetState = () => (state = null);
async function loadState(env) {
  if (state) return state;
  const o = await env.LIVE.get("de/rt/state.json");
  state = BoardState.from(o ? JSON.parse(await o.text()) : null);
  return state;
}

let stations = { list: null, at: 0 };
export const resetStations = () => (stations = { list: null, at: 0 });
/** The stations to ask for, busiest first (published by the deploy). */
export async function boardStations(env, fetchFn, now) {
  if (stations.list && now - stations.at < STATIONS_TTL_MS) return stations.list;
  const url = env.DE_BOARDS_URL || "https://mytrainradar.com/data/de/boards.txt";
  const r = await fetchFn(url, { headers: { "user-agent": CLIENT } });
  if (!r.ok) {
    if (stations.list) return stations.list;
    throw new Error(`boards.txt: HTTP ${r.status}`);
  }
  const list = (await r.text()).split("\n").map((s) => s.trim()).filter((s) => s.startsWith("de:"));
  if (!list.length) throw new Error("boards.txt: no stations");
  stations = { list, at: now };
  return list;
}

/** One board call: up to 15 stations' departures in the window. */
export async function fetchBoard(dhids, { env, fetchFn, now }) {
  const r = await fetchFn(API, {
    method: "POST",
    headers: {
      "DB-Client-Id": env.DE_DB_CLIENT_ID,
      "DB-Api-Key": env.DE_DB_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": CLIENT,
    },
    body: JSON.stringify({
      stopPlaceOrStation: { dhids },
      timeWindow: { timeStart: berlinIso(now - BEHIND_MS), timeEnd: berlinIso(now + AHEAD_MS) },
      maxEntriesPerTransportType: 200,
      maxViaStops: 0,
      languages: ["deu"],
    }),
  });
  if (r.status === 401 || r.status === 403) {
    const e = new Error(`OpenBoards refused the keys (HTTP ${r.status}): DE_DB_CLIENT_ID, DE_DB_API_KEY or the subscription`);
    e.fatal = true;
    throw e;
  }
  // A batch whose stations the API doesn't know: nothing to merge.
  if (r.status === 404) return { departures: [] };
  if (!r.ok) throw new Error(`OpenBoards: HTTP ${r.status}`);
  return r.json();
}

/** A cycle: the next CALLS batches of stations, merged; the whole state's
 * trip updates. */
export async function produce(ctx) {
  const { env, fetchFn, now } = ctx;
  const list = await boardStations(env, fetchFn, now);
  const st = await loadState(env);
  const batches = [];
  for (let i = 0; i < CALLS; i++) {
    const from = (st.cursor + i * PER_CALL) % list.length;
    const b = list.slice(from, from + PER_CALL);
    if (b.length) batches.push(b);
  }
  st.cursor = (st.cursor + CALLS * PER_CALL) % list.length;
  const boards = await Promise.all(batches.map((b) => fetchBoard(b, ctx)));
  let departures = 0;
  for (const j of boards) {
    const entries = parseBoard(j);
    departures += entries.length;
    st.apply(entries, now);
  }
  const expired = st.expire(now);
  await env.LIVE.put("de/rt/state.json", JSON.stringify(st), {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
  });
  const updates = st.tripUpdates();
  console.log(JSON.stringify({ country: "de", stations: batches.flat().length, departures, journeys: st.journeys.size, expired, trains: updates.length }));
  return { bytes: tripUpdatesFeed(updates, Math.floor(now / 1000)) };
}

const feeds = [{ name: "trip_updates.pb", path: "open-boards/v1/departures", produce }];

export const DE = {
  code: "de",
  prefix: "de/rt/",
  base: "https://apis.deutschebahn.com/db-api-marketplace/apis/",
  // Six calls every 6 s: a call a second; 1,200 stations in about 80 s.
  cycleMs: 6_000,
  feeds,
  source: "DB InfraGO AG, OpenBoards (DB API Marketplace), as GTFS-Realtime",
  // The Worker's DE_ENABLED is set from the GitHub variable DE_LIVE_ENABLED.
  enabled: (env) => env.DE_ENABLED === "true" && !!env.DE_DB_CLIENT_ID && !!env.DE_DB_API_KEY,
  missing: (env) => (env.DE_DB_CLIENT_ID && env.DE_DB_API_KEY ? null : "no keys (DE_DB_CLIENT_ID, DE_DB_API_KEY)"),
  headers: () => ({}),
  keep: () => null,
};
