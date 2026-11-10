// Raw GPS log: every train's GPS fix exactly as Renfe's feeds give it (never
// placed on our track, unlike the replay frames), so the track network can
// later be checked against where trains really ran. The recorder adds the
// engine's gpsFixesJson each minute; new fixes go to one gzipped NDJSON file
// per UTC hour in the PRIVATE history bucket:
//
//   gps/2026-11-10/14.ndjson.gz
//   one fix per line: [fix_time, key, number, feed, product, lon_e5, lat_e5,
//                      speed_kmh|null, prev_stop, next_stop, feed_stop]
//
// (key = GTFS trip id, else the train number; feed "ld" or "cer"; stops are
// GTFS ids, "" when unknown). An R2 lifecycle rule deletes them after
// GPS_KEEP_DAYS. Only train data, never anything about people.

import { gunzipText, gzip, hourId } from "./replay.js";

/** Write the current hour's file every this many cycles (minutes), and when
 * the hour changes: a restart loses at most this much. */
export const GPS_FLUSH_EVERY = 10;
/** How long the files are kept (R2 lifecycle rule `gps-14d`, set by the deploy job). */
export const GPS_KEEP_DAYS = 14;
export const GPS_PREFIX = "gps/";

export function gpsKey(id) {
  return `${GPS_PREFIX}${id.slice(0, 10)}/${id.slice(11, 13)}.ndjson.gz`;
}

/**
 * Collects new fixes and writes the hour file. A train's fix is new when its
 * time or position changed since the last one logged (the AV/LD/MD feed has
 * no timestamps, so a train standing still repeats the same fix).
 */
export class GpsLog {
  constructor(bucket) {
    this.bucket = bucket;
    this.hour = null; // { id, lines: [] }
    this.last = new Map(); // key → "fix_time lon lat"
    this.pending = 0;
    this.total = 0;
  }

  /** Add the engine's gpsFixesJson, read at `ms`; returns how many were new. */
  async add(fixesJson, ms) {
    const id = hourId(ms);
    if (this.hour && this.hour.id !== id) {
      await this.flush();
      this.hour = null;
      if (this.last.size > 20_000) this.last.clear(); // trains long gone
    }
    if (!this.hour) {
      // After a restart, carry on with the hour already written.
      const old = await this.bucket.get(gpsKey(id));
      const text = old ? await gunzipText(await old.arrayBuffer()) : "";
      this.hour = { id, lines: text ? text.split("\n").filter(Boolean) : [] };
    }
    let added = 0;
    for (const [key, number, feed, product, fixTime, lonE5, latE5, speed, prev, next, feedStop] of JSON.parse(fixesJson)) {
      const sig = `${fixTime} ${lonE5} ${latE5}`;
      const was = this.last.get(key);
      if (was === sig) continue;
      // Same place, later time: the feed repeating a train that hasn't moved.
      if (was && was.slice(was.indexOf(" ")) === sig.slice(sig.indexOf(" "))) {
        this.last.set(key, sig);
        continue;
      }
      this.last.set(key, sig);
      this.hour.lines.push(JSON.stringify([fixTime, key, number, feed, product, lonE5, latE5, speed, prev, next, feedStop]));
      added += 1;
    }
    this.total += added;
    this.pending += 1;
    if (this.pending >= GPS_FLUSH_EVERY) await this.flush();
    return added;
  }

  /** For the recorder's status file. */
  status() {
    return this.hour ? { hour: this.hour.id, fixes: this.hour.lines.length, sinceStart: this.total } : null;
  }

  async flush() {
    if (!this.hour || !this.hour.lines.length) return;
    await this.bucket.put(gpsKey(this.hour.id), await gzip(this.hour.lines.join("\n") + "\n"), {
      httpMetadata: { contentType: "application/gzip" },
    });
    this.pending = 0;
  }
}
