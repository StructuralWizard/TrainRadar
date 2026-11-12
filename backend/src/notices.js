// Notices history (TrainRadar Pro): every Renfe notice ("aviso") the
// recorder saw active, one JSON file per Madrid day in the public live
// bucket, so the app can show the notices of a past day:
//
//   notices/2026-11-12.json
//   { v: 1, day: "2026-11-12",
//     notices: [{ id, text, kind, tags, lines, nucleos, stops, from, until,
//                 seen: [first_unix_s, last_unix_s] }, …] }   // newest first
//
// and notices/first.json ({ day }) once, so the app knows from when. A
// notice active across midnight is listed on each day it was seen. The
// notices are Renfe's public texts (shown as text only); nothing about people.

export const NOTICES_FIRST_KEY = "notices/first.json";
/** Rewrite the day file at least this often while notices stay the same
 * (only their "last seen" moves); a new or changed notice is written at once. */
export const NOTICES_WRITE_MS = 10 * 60_000;

export function noticesKey(day) {
  return `notices/${day}.json`;
}

/** The Madrid date ("2026-11-12") of a moment. */
export function madridDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ms));
}

const sameNotice = (a, b) => a.text === b.text && a.until === b.until && a.from === b.from && a.kind === b.kind;

export class NoticeLog {
  constructor(bucket) {
    this.bucket = bucket;
    this.day = null; // { day, byId: Map(id → notice) }
    this.dirty = false;
    this.writtenAt = 0;
  }

  /** Record the engine's incidentsJson (the notices active at `ms`). */
  async add(incidentsJson, ms) {
    const day = madridDay(ms);
    if (this.day && this.day.day !== day) {
      await this.flush(true);
      this.day = null;
    }
    if (!this.day) {
      const old = await this.bucket.get(noticesKey(day));
      const doc = old ? JSON.parse(await old.text()) : null;
      this.day = { day, byId: new Map((doc?.notices || []).map((n) => [n.id, n])) };
      this.writtenAt = old ? ms : 0;
      if (!(await this.bucket.get(NOTICES_FIRST_KEY))) {
        await this.bucket.put(NOTICES_FIRST_KEY, JSON.stringify({ day }), {
          httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=3600" },
        });
      }
    }
    const s = Math.round(ms / 1000);
    let changed = false;
    for (const i of JSON.parse(incidentsJson)) {
      const prev = this.day.byId.get(i.id);
      if (!prev || !sameNotice(prev, i)) changed = true;
      this.day.byId.set(i.id, { ...i, seen: [prev?.seen?.[0] ?? s, s] });
      this.dirty = true;
    }
    if (changed || (this.dirty && ms - this.writtenAt >= NOTICES_WRITE_MS)) {
      await this.flush();
      this.writtenAt = ms;
    }
  }

  status() {
    return this.day ? { day: this.day.day, notices: this.day.byId.size } : null;
  }

  /** Write the day file; `done`: the day is over (cache it for long). */
  async flush(done = false) {
    if (!this.day || (!this.dirty && !done) || !this.day.byId.size) return;
    const notices = [...this.day.byId.values()].sort((a, b) => b.seen[0] - a.seen[0] || String(a.id).localeCompare(String(b.id)));
    await this.bucket.put(noticesKey(this.day.day), JSON.stringify({ v: 1, day: this.day.day, notices }), {
      httpMetadata: { contentType: "application/json", cacheControl: done ? "public, max-age=86400" : "public, max-age=120" },
    });
    this.dirty = false;
  }
}
