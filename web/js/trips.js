// My trips (TrainRadar Pro, phase C5b): a log of the trains you were on,
// kept on the phone only. A trip starts when you tap "I'm on this train" or
// when "Am I on this train?" is sure; while the train is live its delay at
// each stop it reaches is recorded; it ends at the last stop, or once the
// train has left the feed for 15 minutes. Only the train and its times are
// stored, never your location. If the app wasn't open when the train
// arrived, the arrival is filled in later from the history server, which
// records every run (see needsArrival / completeFromRun).

export const TRIPS_KEY = "trips";
export const TRIPS_SCHEMA = 1;
export const GONE_MS = 15 * 60_000;
const MAX_TRIPS = 2000; // years of commuting, well under Android's backup limit

/** "YYYY-MM-DD" in Madrid. */
export function madridDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ms));
}

/** Saved trips, migrated to the current schema; malformed entries dropped. */
export function parseTrips(json) {
  let doc;
  try {
    doc = JSON.parse(json || "null");
  } catch {
    return [];
  }
  // Schema 0 (never shipped, kept as the migration example): a bare array.
  if (Array.isArray(doc)) doc = { schema: 1, trips: doc };
  if (!doc || !Array.isArray(doc.trips) || !(doc.schema >= 1)) return [];
  return doc.trips.filter((t) => t && typeof t.id === "string" && typeof t.trainNo === "string" && Array.isArray(t.stops));
}

export function serializeTrips(trips) {
  return JSON.stringify({ schema: TRIPS_SCHEMA, trips: trips.slice(-MAX_TRIPS) });
}

const mins = (secs) => (secs === null || secs === undefined ? null : Math.round(secs / 60));
const num = (n) => String(n ?? "").replace(/^0+/, "");

/** The open trip on this train, if any. */
export function activeTrip(trips, trainNo) {
  return trips.find((t) => !t.endedAt && num(t.trainNo) === num(trainNo));
}

/**
 * Start logging a train. `info`: the engine's trainJson; `route`: its
 * tripJson (stops with expected times, i.e. schedule + current delay).
 * Returns the new list (unchanged if this train is already being logged).
 */
export function startTrip(trips, info, route, now, how = "manual") {
  if (activeTrip(trips, info.number)) return trips;
  const delay = info.delay ?? 0;
  const stops = (route?.stops || []).map((s) => ({ name: s.name, sched: s.time - delay, delayMin: null }));
  const trip = {
    id: `${madridDay(now)}-${num(info.number)}-${now}`,
    day: madridDay(now),
    trainNo: info.number,
    label: [info.route, num(info.number)].filter(Boolean).join(" "),
    origin: info.origin || "",
    destination: info.destination || "",
    schedArr: stops.length ? stops[stops.length - 1].sched : null,
    stops,
    lastDelayMin: mins(info.delay),
    maxDelayMin: mins(info.delay),
    arrDelayMin: null,
    estimated: info.delay_source !== "renfe",
    how,
    startedAt: now,
    lastSeen: now,
    endedAt: null,
  };
  return [...trips, trip];
}

/** Take in the train's current state (or null when it isn't in the feed). */
export function updateTrip(trip, info, now) {
  if (trip.endedAt) return trip;
  if (!info) return now - trip.lastSeen > GONE_MS ? { ...trip, endedAt: now } : trip;
  const t = { ...trip, stops: trip.stops.map((s) => ({ ...s })), lastSeen: now };
  const d = mins(info.delay);
  if (d !== null) {
    t.lastDelayMin = d;
    t.maxDelayMin = Math.max(t.maxDelayMin ?? d, d);
    if (info.delay_source === "renfe") t.estimated = false;
  }
  // Stops before the next one have been reached: record the delay there.
  const next = info.next_stop ? t.stops.findIndex((s, i) => s.name === info.next_stop && s.delayMin === null && i > 0) : t.stops.length;
  const reached = next < 0 ? 0 : next;
  for (let i = 0; i < reached; i++) if (t.stops[i].delayMin === null) t.stops[i].delayMin = d;
  if (!info.next_stop && t.stops.length) {
    t.arrDelayMin = t.stops[t.stops.length - 1].delayMin ?? d;
    t.endedAt = now;
  }
  return t;
}

/** How long to keep asking the server for an arrival the app didn't see. */
export const ARRIVAL_LOOKUP_MS = 3 * 86_400_000;

/** A finished trip whose arrival the app didn't see, still worth asking for. */
export function needsArrival(t, now) {
  return !!t.endedAt && t.arrDelayMin === null && !t.arrivalChecked && now - t.endedAt < ARRIVAL_LOOKUP_MS;
}

/**
 * The server's run for this trip (from /v1/history/train, `runs`), matched
 * by its scheduled arrival (or, failing that, its day and departure).
 */
export function runForTrip(t, runs) {
  const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 180;
  const first = t.stops[0]?.sched ?? null;
  return (
    runs.find((r) => near(r.sched_arr, t.schedArr)) ||
    runs.find((r) => r.date === t.day && near(r.sched_dep, first)) ||
    null
  );
}

/**
 * Fill in what the app missed from the server's run: the arrival delay,
 * the highest delay and each stop's delay (matched by scheduled time).
 * `final`: no point asking again (found, or the run is too old to appear).
 */
export function completeFromRun(t, run, { final = !!run } = {}) {
  if (!run) return final ? { ...t, arrivalChecked: true } : t;
  const arr = run.arr_delay_min ?? null;
  const stops = t.stops.map((s) => {
    if (s.delayMin !== null) return s;
    const r = (run.stops || []).find((x) => Math.abs(x.sched - s.sched) <= 180);
    return r && r.delay !== null && r.delay !== undefined ? { ...s, delayMin: r.delay } : s;
  });
  const known = [t.maxDelayMin, run.max_delay_min, arr].filter((x) => x !== null && x !== undefined);
  return {
    ...t,
    stops,
    arrDelayMin: arr,
    lastDelayMin: arr ?? run.last_delay_min ?? t.lastDelayMin,
    maxDelayMin: known.length ? Math.max(...known) : null,
    estimated: run.source_quality !== "renfe_tu",
    fromServer: true,
    arrivalChecked: arr !== null || final,
  };
}

/** Delay counted for a finished trip: at arrival, else the last one seen. */
export function tripDelay(t) {
  return t.arrDelayMin ?? t.lastDelayMin ?? null;
}

/** Per month: trips, late (5+ min), average delay. Newest month first. */
export function monthlyStats(trips) {
  const by = new Map();
  for (const t of trips) {
    if (!t.endedAt) continue;
    const m = t.day.slice(0, 7);
    const s = by.get(m) || { month: m, trips: 0, late: 0, sum: 0, known: 0 };
    s.trips += 1;
    const d = tripDelay(t);
    if (d !== null) {
      s.known += 1;
      s.sum += d;
      if (d >= 5) s.late += 1;
    }
    by.set(m, s);
  }
  return [...by.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map(({ sum, ...s }) => ({ ...s, latePct: s.known ? Math.round((100 * s.late) / s.known) : null, avgDelay: s.known ? Math.round((10 * sum) / s.known) / 10 : null }));
}

function clock(unix) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(unix * 1000));
}

/** Ready-to-copy summary for a claim. States facts only, never eligibility. */
export function claimText(lang, t) {
  const d = tripDelay(t);
  const date = t.day.split("-").reverse().join("/");
  const sched = t.schedArr ? clock(t.schedArr) : "?";
  const actual = t.schedArr && d !== null ? clock(t.schedArr + d * 60) : "?";
  const src = t.estimated
    ? lang === "en" ? "estimated by TrainRadar from Renfe's GPS positions" : "estimado por TrainRadar con las posiciones GPS de Renfe"
    : lang === "en" ? "as published by Renfe" : "según los datos publicados por Renfe";
  return lang === "en"
    ? `Train ${t.label}, ${date}, ${t.origin} → ${t.destination}. Scheduled arrival ${sched}; actual arrival about ${actual} (delay ${d ?? "?"} min, ${src}).`
    : `Tren ${t.label}, ${date}, ${t.origin} → ${t.destination}. Llegada prevista ${sched}; llegada real aproximada ${actual} (retraso ${d ?? "?"} min, ${src}).`;
}

export const CLAIMS_URL = {
  es: "https://www.renfe.com/es/es/ayuda/compromiso-puntualidad",
  en: "https://www.renfe.com/es/en/ayuda/punctuality-commitment",
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote, and defuse spreadsheet formulas (=, +, -, @ at the start).
  return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV = {
  es: {
    sep: ";", // what Excel expects in Spain (the decimal separator is the comma)
    head: ["fecha", "tren", "origen", "destino", "llegada_prevista", "retraso_llegada_min", "retraso_maximo_min", "fuente"],
    estimated: "estimado",
  },
  en: {
    sep: ",",
    head: ["date", "train", "origin", "destination", "scheduled_arrival", "arrival_delay_min", "max_delay_min", "source"],
    estimated: "estimated",
  },
};

export function tripsCsv(trips, lang = "es") {
  const c = CSV[lang] || CSV.es;
  const rows = trips
    .filter((t) => t.endedAt)
    .map((t) => [t.day, t.label, t.origin, t.destination, t.schedArr ? clock(t.schedArr) : "", tripDelay(t), t.maxDelayMin, t.estimated ? c.estimated : "renfe"]);
  return [c.head, ...rows].map((r) => r.map(csvCell).join(c.sep)).join("\n") + "\n";
}
