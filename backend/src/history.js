// Delay history storage (phase C3): writing finished runs to D1, the daily
// aggregates, backups, monthly archives and retention. Pure functions over
// a D1 database (`db`) and an R2 bucket (`archive`, private), so they run
// the same in the Worker and in tests.
//
// Retention: `trips` stays in D1 for the last 12 months. Every day the
// previous two service days are aggregated and backed up to
// `backups/trips/YYYY-MM-DD.ndjson.gz` (R2 lifecycle deletes them after
// 90 days). Each finished month is archived to
// `archive/trips/YYYY-MM.ndjson.gz` (never deleted); months older than 12
// are then removed from D1. Aggregates stay in D1 and are archived too.

export const TRIP_COLUMNS = [
  "service_date",
  "trip_id",
  "train_no",
  "line",
  "product",
  "origin_id",
  "dest_id",
  "sched_dep",
  "sched_arr",
  "arr_delay_min",
  "max_delay_min",
  "last_delay_min",
  "cancelled",
  "stops_json",
  "source_quality",
];
export const KEEP_MONTHS = 12;
/** R2 multipart parts must be at least 5 MiB (except the last). */
export const PART_BYTES = 5 * 1024 * 1024;
const PAGE = 1000;
const DELETE_CHUNK = 5000;

/** "YYYY-MM-DD" of a unix-ms instant in Madrid. */
export function madridDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ms));
}

/** Date `n` days after "YYYY-MM-DD" (n may be negative). */
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM" `n` months after "YYYY-MM". */
export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function daysOfMonth(month) {
  const out = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Store finished runs (rows from the engine's `recordJson`). Re-recording
 * the same run replaces it. Returns the number written. */
export async function writeTrips(db, rows) {
  if (!rows.length) return 0;
  const sql = `INSERT OR REPLACE INTO trips (${TRIP_COLUMNS.join(",")}) VALUES (${TRIP_COLUMNS.map(() => "?").join(",")})`;
  const stmt = db.prepare(sql);
  for (let i = 0; i < rows.length; i += 100) {
    await db.batch(rows.slice(i, i + 100).map((r) => stmt.bind(...TRIP_COLUMNS.map((c) => r[c] ?? null))));
  }
  return rows.length;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const x = (sorted.length - 1) * q;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

function tally(delays) {
  const s = delays.slice().sort((a, b) => a - b);
  return {
    on_time: s.filter((d) => d < 5).length,
    late_5: s.filter((d) => d >= 5).length,
    late_15: s.filter((d) => d >= 15).length,
    median_delay: quantile(s, 0.5),
    p90_delay: quantile(s, 0.9),
  };
}

/** Delay counted for a run's punctuality: at arrival, else the last seen. */
export function runDelay(r) {
  return r.arr_delay_min ?? r.last_delay_min ?? null;
}

/** Aggregate one service day into `line_daily` and `station_daily`
 * (replacing what was there). Returns the row counts. */
export async function aggregateDay(db, date) {
  const { results } = await db
    .prepare(
      "SELECT line, product, arr_delay_min, last_delay_min, cancelled, stops_json FROM trips WHERE service_date = ?",
    )
    .bind(date)
    .all();
  const lines = new Map();
  const stations = new Map();
  for (const r of results) {
    const k = `${r.line}\u0000${r.product}`;
    const l = lines.get(k) || { line: r.line, product: r.product, trips: 0, cancelled: 0, delays: [] };
    l.trips += 1;
    if (r.cancelled) {
      l.cancelled += 1;
    } else {
      const d = runDelay(r);
      if (d !== null) l.delays.push(d);
    }
    lines.set(k, l);
    if (r.cancelled) continue;
    let stops = [];
    try {
      stops = JSON.parse(r.stops_json);
    } catch {
      // a damaged row only loses its station figures
    }
    for (const [id, , delay] of stops) {
      if (delay === null || delay === undefined) continue;
      const s = stations.get(id) || [];
      s.push(delay);
      stations.set(id, s);
    }
  }
  const stmts = [
    db.prepare("DELETE FROM line_daily WHERE service_date = ?").bind(date),
    db.prepare("DELETE FROM station_daily WHERE service_date = ?").bind(date),
  ];
  const lineSql = db.prepare(
    "INSERT INTO line_daily (service_date, line, product, trips, on_time, late_5, late_15, cancelled, median_delay, p90_delay) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const l of lines.values()) {
    const t = tally(l.delays);
    stmts.push(lineSql.bind(date, l.line, l.product, l.trips, t.on_time, t.late_5, t.late_15, l.cancelled, t.median_delay, t.p90_delay));
  }
  const stationSql = db.prepare(
    "INSERT INTO station_daily (service_date, stop_id, calls, on_time, late_5, late_15, median_delay, p90_delay) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const [id, delays] of stations) {
    const t = tally(delays);
    stmts.push(stationSql.bind(date, id, delays.length, t.on_time, t.late_5, t.late_15, t.median_delay, t.p90_delay));
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return { lines: lines.size, stations: stations.size, trips: results.length };
}

/** One day as gzip NDJSON: every trip, then the day's aggregates (each
 * line tagged with its table). */
export async function dayFile(db, date) {
  const lines = [];
  for (let offset = 0; ; offset += PAGE) {
    const { results } = await db
      .prepare(`SELECT ${TRIP_COLUMNS.join(",")} FROM trips WHERE service_date = ? ORDER BY trip_id LIMIT ? OFFSET ?`)
      .bind(date, PAGE, offset)
      .all();
    for (const r of results) lines.push(JSON.stringify({ table: "trips", ...r }));
    if (results.length < PAGE) break;
  }
  for (const table of ["line_daily", "station_daily"]) {
    const { results } = await db.prepare(`SELECT * FROM ${table} WHERE service_date = ?`).bind(date).all();
    for (const r of results) lines.push(JSON.stringify({ table, ...r }));
  }
  return { bytes: await gzip(lines.length ? `${lines.join("\n")}\n` : ""), rows: lines.length };
}

export const backupKey = (date) => `backups/days/${date}.ndjson.gz`;
export const archiveKey = (month) => `archive/${month}.ndjson.gz`;

/** Back up one day to R2 (overwrites). */
export async function backupDay(db, archive, date) {
  const f = await dayFile(db, date);
  await archive.put(backupKey(date), f.bytes, {
    httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
    customMetadata: { rows: String(f.rows) },
  });
  return f.rows;
}

/** Archive a whole month as one gzip file (concatenated gzip members, a
 * valid gzip stream), from the daily backups or, where a backup is gone,
 * straight from D1. Uploaded in parts so memory stays small. */
export async function archiveMonth(db, archive, month) {
  const key = archiveKey(month);
  const upload = await archive.createMultipartUpload(key, {
    httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
  });
  const parts = [];
  let buf = [];
  let size = 0;
  let rows = 0;
  const flush = async () => {
    const all = new Uint8Array(size);
    let o = 0;
    for (const b of buf) {
      all.set(b, o);
      o += b.length;
    }
    parts.push(await upload.uploadPart(parts.length + 1, all));
    buf = [];
    size = 0;
  };
  try {
    for (const date of daysOfMonth(month)) {
      const saved = await archive.get(backupKey(date));
      let bytes;
      if (saved) {
        bytes = new Uint8Array(await saved.arrayBuffer());
        rows += Number(saved.customMetadata?.rows || 0);
      } else {
        const f = await dayFile(db, date);
        bytes = f.bytes;
        rows += f.rows;
      }
      buf.push(bytes);
      size += bytes.length;
      if (size >= PART_BYTES) await flush();
    }
    if (size > 0 || parts.length === 0) await flush();
    await upload.complete(parts);
  } catch (e) {
    await upload.abort().catch(() => {});
    throw e;
  }
  return rows;
}

/** Months with trips older than the retention window: archive each (if not
 * yet) and delete its trips from D1. `line_daily`/`station_daily` stay. */
export async function retire(db, archive, today) {
  const cutoff = `${addMonths(today.slice(0, 7), -KEEP_MONTHS)}-01`;
  const { results } = await db
    .prepare("SELECT DISTINCT substr(service_date, 1, 7) AS month FROM trips WHERE service_date < ?")
    .bind(cutoff)
    .all();
  const done = [];
  for (const { month } of results) {
    if (!(await archive.head(archiveKey(month)))) await archiveMonth(db, archive, month);
    for (;;) {
      const r = await db
        .prepare(
          "DELETE FROM trips WHERE rowid IN (SELECT rowid FROM trips WHERE service_date >= ? AND service_date < ? LIMIT ?)",
        )
        .bind(`${month}-01`, `${addMonths(month, 1)}-01`, DELETE_CHUNK)
        .run();
      if ((r.meta?.changes ?? 0) < DELETE_CHUNK) break;
    }
    done.push(month);
  }
  return done;
}

/** Size and row counts, for `rt/recorder.json`. */
export async function dbStats(db) {
  const r = await db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM trips) AS trips, (SELECT COUNT(*) FROM line_daily) AS line_daily, (SELECT COUNT(*) FROM station_daily) AS station_daily",
    )
    .run();
  const row = r.results?.[0] || {};
  return { bytes: r.meta?.size_after ?? null, ...row };
}

/** The daily job (cron, early morning): aggregate and back up the last two
 * service days (runs finish up to ~3 h after their last sighting, so the
 * day before yesterday is final), archive last month once it's over, retire
 * months past retention. */
export async function dailyJob(db, archive, nowMs) {
  const today = madridDate(nowMs);
  const out = { days: [] };
  for (const date of [addDays(today, -2), addDays(today, -1)]) {
    const agg = await aggregateDay(db, date);
    const rows = await backupDay(db, archive, date);
    out.days.push({ date, ...agg, backupRows: rows });
  }
  const last = addMonths(today.slice(0, 7), -1);
  if (Number(today.slice(8)) >= 3 && !(await archive.head(archiveKey(last)))) {
    out.archived = { month: last, rows: await archiveMonth(db, archive, last) };
  }
  out.retired = await retire(db, archive, today);
  out.db = await dbStats(db);
  return out;
}
