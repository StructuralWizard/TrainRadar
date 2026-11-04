// Public delay-history API (phase C3), read-only:
//   GET /v1/history/lines?days=7            punctuality of every line
//   GET /v1/history/line/:line?days=…       one line, per day and product
//   GET /v1/history/train/:trainNo?days=…   every run of a train number
//   GET /v1/history/station/:stopId?days=…  one station, per day
// `days` 1–365 (default 7), counted back from yesterday (Madrid). Queries
// only use indexed keys and are capped in size. Responses are cached for an
// hour. No personal data exists in this database.

import { addDays, madridDate } from "./history.js";

export const API_CACHE = "public, max-age=3600";
export const MAX_DAYS = 365;
const MAX_ROWS = 2000;
const ID = /^[A-Za-z0-9._-]{1,40}$/;

export function parseDays(v) {
  if (v === null || v === "") return 7;
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_DAYS ? n : null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": status === 200 ? API_CACHE : "no-store" },
  });
}

const num = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

/** Handle `/v1/history/...`; returns a Response (without CORS headers). */
export async function historyApi(url, db, nowMs = Date.now()) {
  if (!db) return json({ error: "history not available yet" }, 503);
  const parts = url.pathname.split("/").filter(Boolean); // v1, history, kind, id?
  const days = parseDays(url.searchParams.get("days"));
  if (days === null) return json({ error: `days must be 1–${MAX_DAYS}` }, 400);
  const to = addDays(madridDate(nowMs), -1);
  const from = addDays(to, -(days - 1));
  const [, , kind, raw] = parts;
  if (parts.length > 4) return json({ error: "not found" }, 404);
  let id = null;
  if (raw !== undefined) {
    try {
      id = decodeURIComponent(raw);
    } catch {
      id = "";
    }
    if (!ID.test(id)) return json({ error: "bad id" }, 400);
  }
  const range = { from, to, days };

  if (kind === "lines" && id === null) {
    const { results } = await db
      .prepare(
        `SELECT line, product, SUM(trips) AS trips, SUM(on_time) AS on_time, SUM(late_5) AS late_5,
                SUM(late_15) AS late_15, SUM(cancelled) AS cancelled, AVG(median_delay) AS median_delay
         FROM line_daily WHERE service_date BETWEEN ? AND ?
         GROUP BY line, product ORDER BY trips DESC LIMIT ?`,
      )
      .bind(from, to, MAX_ROWS)
      .all();
    return json({ ...range, lines: results.map((r) => ({ ...r, median_delay: num(r.median_delay) })) });
  }
  if (kind === "line" && id) {
    const { results } = await db
      .prepare(
        `SELECT service_date AS date, product, trips, on_time, late_5, late_15, cancelled, median_delay, p90_delay
         FROM line_daily WHERE line = ? AND service_date BETWEEN ? AND ? ORDER BY service_date, product LIMIT ?`,
      )
      .bind(id, from, to, MAX_ROWS)
      .all();
    return json({ ...range, line: id, days: results });
  }
  if (kind === "station" && id) {
    const { results } = await db
      .prepare(
        `SELECT service_date AS date, calls, on_time, late_5, late_15, median_delay, p90_delay
         FROM station_daily WHERE stop_id = ? AND service_date BETWEEN ? AND ? ORDER BY service_date LIMIT ?`,
      )
      .bind(id, from, to, MAX_ROWS)
      .all();
    return json({ ...range, stopId: id, days: results });
  }
  if (kind === "train" && id) {
    const trainNo = id.replace(/^0+/, "");
    const { results } = await db
      .prepare(
        `SELECT service_date AS date, trip_id, line, product, origin_id, dest_id, sched_dep, sched_arr,
                arr_delay_min, max_delay_min, last_delay_min, cancelled, stops_json, source_quality
         FROM trips WHERE train_no = ? AND service_date BETWEEN ? AND ? ORDER BY service_date, sched_dep LIMIT ?`,
      )
      .bind(trainNo, from, to, MAX_ROWS)
      .all();
    const runs = results.map(({ stops_json, ...r }) => {
      let stops = [];
      try {
        stops = JSON.parse(stops_json).map(([stopId, sched, delay, estimated]) => ({ stopId, sched, delay, estimated: !!estimated }));
      } catch {
        // leave the stops out of a damaged row
      }
      return { ...r, cancelled: !!r.cancelled, stops };
    });
    return json({ ...range, trainNo, runs });
  }
  return json({ error: "not found" }, 404);
}
