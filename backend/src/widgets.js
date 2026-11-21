// What the Android widgets read (phase C, TrainRadar Pro): small JSON from
// the recorder's engine, which has every timetable and the live trains in
// memory. Served by the Worker at
//   GET /v1/live/board/:stationId   next departures and arrivals
//   GET /v1/live/train/:number      one train: delay, next stop, ends
//   GET /v1/live/notices            Renfe's notices in force
//   GET /v1/live/notices/all        all of them, with their stations
//   GET /v1/live/run/:station/:number  one train's next run from a station
//                                   (a saved journey's alerts, plan journeys)
// cached for a minute at the edge (each widget asks every 15 minutes).

export const WIDGET_CACHE = "public, max-age=60";
const ID = /^[A-Za-z0-9._-]{1,40}$/;
const HORIZON_SECS = 3 * 3600;
const ROWS = 8;

const row = (r) => ({
  number: r.number,
  route: r.route,
  /** Destination (departures) or origin (arrivals). */
  place: r.other_end,
  sched: r.sched,
  delay: r.delay ?? null,
  canceled: !!r.canceled,
});

/** A station's next departures and arrivals, or null for a bad id. */
export function boardDoc(engine, stationId, now) {
  if (!ID.test(String(stationId))) return null;
  const dep = JSON.parse(engine.stationBoardJson(stationId, now, HORIZON_SECS, ROWS)).filter((r) => !r.terminates);
  const arr = JSON.parse(engine.stationArrivalsJson(stationId, now, HORIZON_SECS, ROWS));
  return { station: stationId, at: new Date(now).toISOString(), departures: dep.map(row), arrivals: arr.map(row) };
}

/** One train by number: where it is going, its next stop and delay. */
export function trainDoc(engine, number, now) {
  if (!ID.test(String(number))) return null;
  const n = String(number).replace(/^0+/, "");
  const at = new Date(now).toISOString();
  const hit = JSON.parse(engine.searchJson(String(number), 8)).find((h) => String(h.number).replace(/^0+/, "") === n);
  if (!hit) return { number: String(number), running: false, at };
  const t = JSON.parse(engine.trainJson(hit.i, now));
  return {
    number: t.number,
    running: true,
    route: t.route || t.line || "",
    origin: t.origin ?? null,
    destination: t.destination ?? null,
    nextStop: t.next_stop ?? null,
    nextArrival: t.next_arrival ?? null,
    delay: t.delay ?? null,
    canceled: !!t.canceled,
    at,
  };
}

/** Renfe's notices in force, newest first, text only; `stops` adds the
 * station ids each one names (for a saved journey's alerts). */
export function noticesDoc(engine, now, limit = 10, stops = false) {
  const list = JSON.parse(engine.incidentsJson(now)).slice(0, limit);
  return {
    at: new Date(now).toISOString(),
    notices: list.map((n) => ({
      id: n.id,
      kind: n.kind,
      lines: n.lines || [],
      text: String(n.text || "").slice(0, 300),
      from: n.from ?? null,
      ...(stops ? { stops: (n.stops || []).map((x) => String(x.id)).filter((x) => ID.test(x)) } : {}),
    })),
  };
}

/** A train's next run from a station within 12 hours: its scheduled
 * departure, delay and whether it's cancelled; `found: false` if none. */
export function runDoc(engine, stationId, number, now) {
  if (!ID.test(String(stationId)) || !ID.test(String(number))) return null;
  const n = String(number).replace(/^0+/, "");
  const at = new Date(now).toISOString();
  const r = JSON.parse(engine.stationBoardJson(stationId, now, 12 * 3600, 2000)).find((x) => String(x.number).replace(/^0+/, "") === n && !x.terminates);
  if (!r) return { station: stationId, number: String(number), found: false, at };
  return { station: stationId, number: r.number, found: true, sched: r.sched, delay: r.delay ?? null, canceled: !!r.canceled, at };
}

/** The recorder DO's `/widget/...` routes: a Response. */
export function widgetResponse(engine, path, now) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": status === 200 ? WIDGET_CACHE : "no-store" } });
  if (!engine) return json({ error: "starting" }, 503);
  const m = path.match(/^\/widget\/board\/([^/]+)$/);
  if (m) {
    const doc = boardDoc(engine, decodeURIComponent(m[1]), now);
    return doc ? json(doc) : json({ error: "bad station id" }, 400);
  }
  const tm = path.match(/^\/widget\/train\/([^/]+)$/);
  if (tm) {
    const doc = trainDoc(engine, decodeURIComponent(tm[1]), now);
    return doc ? json(doc) : json({ error: "bad train number" }, 400);
  }
  if (path === "/widget/notices") return json(noticesDoc(engine, now));
  if (path === "/widget/notices/all") return json(noticesDoc(engine, now, 500, true));
  const rm = path.match(/^\/widget\/run\/([^/]+)\/([^/]+)$/);
  if (rm) {
    const doc = runDoc(engine, decodeURIComponent(rm[1]), decodeURIComponent(rm[2]), now);
    return doc ? json(doc) : json({ error: "bad station or train" }, 400);
  }
  return json({ error: "not found" }, 404);
}
