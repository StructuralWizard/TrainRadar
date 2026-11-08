// Replay ("moviola", TrainRadar Pro): every minute the recorder stores where
// each train was, as the map showed it, in one gzipped JSON file per UTC
// hour in the public live bucket:
//
//   replay/2026-11-08/14.json.gz
//   { v: 1, hour: "2026-11-08T14",
//     trains: [[key, route, number, destination], …],   // indexed below
//     frames: [[unix_s, [[train, lon_e5, lat_e5, bearing|-1, delay_s|null, flags], …]], …] }
//
// and replay/first.json ({ hour }) once, so the app knows from when. The
// current hour is rewritten every few minutes (short cache); finished hours
// are immutable. Only train data, never anything about people.

export const REPLAY_FLUSH_EVERY = 5; // cycles (minutes)
export const FIRST_KEY = "replay/first.json";

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-08T14" for a time (UTC). */
export function hourId(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

export function hourKey(id) {
  return `replay/${id.slice(0, 10)}/${id.slice(11, 13)}.json.gz`;
}

async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function gunzipText(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return new TextDecoder().decode(b);
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(s).text();
}

/** One hour of frames being collected. */
export class ReplayHour {
  constructor(id) {
    this.id = id;
    this.trains = [];
    this.index = new Map(); // key → position in trains
    this.frames = [];
  }

  static fromDoc(doc) {
    const h = new ReplayHour(doc.hour);
    h.trains = doc.trains || [];
    h.trains.forEach((t, i) => h.index.set(t[0], i));
    h.frames = doc.frames || [];
    return h;
  }

  /** Add the engine's replayFrameJson at `ms`. */
  add(frameJson, ms) {
    const rows = [];
    for (const [key, route, number, dest, lon, lat, bearing, delay, flags] of JSON.parse(frameJson)) {
      let i = this.index.get(key);
      if (i === undefined) {
        i = this.trains.length;
        this.trains.push([key, route, number, dest]);
        this.index.set(key, i);
      }
      rows.push([i, Math.round(lon * 1e5), Math.round(lat * 1e5), bearing ?? -1, delay, flags]);
    }
    this.frames.push([Math.round(ms / 1000), rows]);
  }

  doc() {
    return { v: 1, hour: this.id, trains: this.trains, frames: this.frames };
  }
}

/**
 * Collects a frame per recorder cycle and writes the hour file: every
 * REPLAY_FLUSH_EVERY frames, and when the hour changes. After a restart the
 * current hour's file is read back so the hour isn't cut short.
 */
export class ReplayStore {
  constructor(bucket) {
    this.bucket = bucket;
    this.hour = null;
    this.pending = 0;
  }

  async add(frameJson, ms) {
    const id = hourId(ms);
    if (this.hour && this.hour.id !== id) {
      await this.flush(true);
      this.hour = null;
    }
    if (!this.hour) {
      const old = await this.bucket.get(hourKey(id));
      this.hour = old ? ReplayHour.fromDoc(JSON.parse(await gunzipText(await old.arrayBuffer()))) : new ReplayHour(id);
      if (!(await this.bucket.get(FIRST_KEY))) {
        await this.bucket.put(FIRST_KEY, JSON.stringify({ hour: id }), {
          httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=3600" },
        });
      }
    }
    this.hour.add(frameJson, ms);
    this.pending += 1;
    if (this.pending >= REPLAY_FLUSH_EVERY) await this.flush(false);
  }

  /** Write the hour file; `done`: the hour is over (cache it for long). */
  async flush(done = false) {
    if (!this.hour || !this.hour.frames.length) return;
    await this.bucket.put(hourKey(this.hour.id), await gzip(JSON.stringify(this.hour.doc())), {
      httpMetadata: { contentType: "application/gzip", cacheControl: done ? "public, max-age=86400" : "public, max-age=60" },
    });
    this.pending = 0;
  }
}

export { gunzipText };
