// Writing GTFS-Realtime, for sources that publish JSON (Poland): just the
// fields TrainRadar's engine reads, numbered as in gtfs-realtime.proto v2.0.
// FeedMessage: 1 header, 2 entity. FeedHeader: 1 version, 2 incrementality,
// 3 timestamp. FeedEntity: 1 id, 3 trip_update. TripUpdate: 1 trip,
// 2 stop_time_update. TripDescriptor: 1 trip_id, 3 start_date,
// 4 schedule_relationship (3 = CANCELED). StopTimeUpdate: 1 stop_sequence,
// 2 arrival, 3 departure, 4 stop_id, 5 schedule_relationship (1 = SKIPPED).
// StopTimeEvent: 1 delay. No dependencies.

import { concat } from "./protobuf.js";

const te = new TextEncoder();

function varint(n) {
  // int32/int64 negatives are ten bytes of two's complement.
  let v = BigInt.asUintN(64, BigInt(Math.trunc(n)));
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Uint8Array.from(out);
}

const key = (field, wire) => varint(field * 8 + wire);
export const int = (field, n) => concat([key(field, 0), varint(n)]);
export const bytes = (field, b) => concat([key(field, 2), varint(b.length), b]);
export const str = (field, s) => bytes(field, te.encode(String(s)));
export const msg = (field, parts) => bytes(field, concat(parts.filter(Boolean)));

/** A FeedMessage of trip updates: [{ id, tripId, startDate, canceled,
 * stops: [{ seq, stopId, arrivalDelay, departureDelay, skipped }] }]
 * (delays in seconds, null when unknown). */
export function tripUpdatesFeed(updates, nowSecs) {
  const header = msg(1, [str(1, "2.0"), int(2, 0), int(3, nowSecs)]);
  const entities = updates.map((u) =>
    msg(2, [
      str(1, u.id || u.tripId),
      msg(3, [
        msg(1, [str(1, u.tripId), u.startDate ? str(3, u.startDate) : null, u.canceled ? int(4, 3) : null]),
        ...(u.stops || []).map((s) =>
          msg(2, [
            s.seq != null ? int(1, s.seq) : null,
            s.arrivalDelay != null ? msg(2, [int(1, s.arrivalDelay)]) : null,
            s.departureDelay != null ? msg(3, [int(1, s.departureDelay)]) : null,
            str(4, s.stopId),
            s.skipped ? int(5, 1) : null,
          ]),
        ),
      ]),
    ]),
  );
  return concat([header, ...entities]);
}
