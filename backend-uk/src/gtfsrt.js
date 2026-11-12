// A minimal GTFS-Realtime (protobuf) encoder for TripUpdates: what the UK
// ingest Worker publishes, so the app's engine reads Network Rail's delays
// like Renfe's. Field numbers from gtfs-realtime.proto (v2.0), the same as
// crates/engine/src/gtfs_rt.rs. No dependencies.

class Writer {
  constructor() {
    this.parts = [];
    this.len = 0;
  }
  bytes(b) {
    this.parts.push(b);
    this.len += b.length;
  }
  varint(n) {
    // Non-negative integers up to 2^53; negative int32 as 10-byte two's complement.
    let v = BigInt.asUintN(64, BigInt(Math.trunc(n)));
    const out = [];
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v) b |= 0x80;
      out.push(b);
    } while (v);
    this.bytes(Uint8Array.from(out));
  }
  key(field, wire) {
    this.varint((field << 3) | wire);
  }
  int(field, n) {
    if (n === undefined || n === null) return;
    this.key(field, 0);
    this.varint(n);
  }
  string(field, s) {
    if (s === undefined || s === null) return;
    const b = new TextEncoder().encode(String(s));
    this.key(field, 2);
    this.varint(b.length);
    this.bytes(b);
  }
  message(field, fill) {
    const w = new Writer();
    fill(w);
    this.key(field, 2);
    this.varint(w.len);
    for (const p of w.parts) this.bytes(p);
  }
  finish() {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) out.set(p, o), (o += p.length);
    return out;
  }
}

export const CANCELED = 3;

/**
 * FeedMessage of TripUpdates. `updates`: [{ id, tripId, startDate
 * ("YYYYMMDD"), canceled, delay (s), timestamp (unix s), stops: [{ stopId,
 * delay, time }] }].
 */
export function encodeTripUpdates(updates, timestamp) {
  const w = new Writer();
  w.message(1, (h) => {
    h.string(1, "2.0");
    h.int(2, 0); // FULL_DATASET
    h.int(3, timestamp);
  });
  for (const u of updates) {
    w.message(2, (e) => {
      e.string(1, u.id);
      e.message(3, (tu) => {
        tu.message(1, (td) => {
          td.string(1, u.tripId);
          td.string(3, u.startDate);
          if (u.canceled) td.int(4, CANCELED);
        });
        for (const s of u.stops || []) {
          tu.message(2, (st) => {
            st.message(2, (ev) => {
              ev.int(1, s.delay);
              ev.int(2, s.time);
            });
            st.string(4, s.stopId);
          });
        }
        tu.int(4, u.timestamp);
        tu.int(5, u.delay);
      });
    });
  }
  return w.finish();
}

// ---- A decoder, for the tests (and debugging): field → [values] ----

export function decode(bytes) {
  const out = {};
  let i = 0;
  const varint = () => {
    let v = 0n;
    let s = 0n;
    for (;;) {
      const b = bytes[i++];
      v |= BigInt(b & 0x7f) << s;
      s += 7n;
      if (!(b & 0x80)) return v;
    }
  };
  while (i < bytes.length) {
    const k = Number(varint());
    const field = k >> 3;
    const wire = k & 7;
    let val;
    if (wire === 0) val = Number(BigInt.asIntN(64, varint()));
    else if (wire === 2) {
      const n = Number(varint());
      val = bytes.slice(i, i + n);
      i += n;
    } else throw new Error(`wire type ${wire}`);
    (out[field] ||= []).push(val);
  }
  return out;
}
