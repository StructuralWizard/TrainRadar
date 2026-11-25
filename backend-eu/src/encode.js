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
 * label, stops: [{ seq, stopId, arrivalDelay, departureDelay, arrivalTime,
 * departureTime, skipped }] }] (delays in seconds, times in seconds since
 * the epoch, null when unknown; label = the train number, in the trip
 * update's VehicleDescriptor, field 3). */
export function tripUpdatesFeed(updates, nowSecs) {
  const header = msg(1, [str(1, "2.0"), int(2, 0), int(3, nowSecs)]);
  const entities = updates.map((u) =>
    msg(2, [
      str(1, u.id || u.tripId),
      msg(3, [
        msg(1, [str(1, u.tripId), u.startDate ? str(3, u.startDate) : null, u.canceled ? int(4, 3) : null]),
        u.label ? msg(3, [str(2, u.label)]) : null,
        ...(u.stops || []).map((s) =>
          msg(2, [
            s.seq != null ? int(1, s.seq) : null,
            s.arrivalDelay != null || s.arrivalTime != null
              ? msg(2, [s.arrivalDelay != null ? int(1, s.arrivalDelay) : null, s.arrivalTime != null ? int(2, s.arrivalTime) : null])
              : null,
            s.departureDelay != null || s.departureTime != null
              ? msg(3, [s.departureDelay != null ? int(1, s.departureDelay) : null, s.departureTime != null ? int(2, s.departureTime) : null])
              : null,
            str(4, s.stopId),
            s.skipped ? int(5, 1) : null,
          ]),
        ),
      ]),
    ]),
  );
  return concat([header, ...entities]);
}

/** A FeedMessage of alerts (Singapore): [{ id, start, routes: [route_id],
 * stops: [stop_id], effect, header, description, lang }] (start in seconds
 * since the epoch or null; effect a GTFS-RT Effect number: 1 NO_SERVICE,
 * 2 REDUCED_SERVICE, 3 SIGNIFICANT_DELAYS, 7 OTHER_EFFECT). Alert: 1
 * active_period (TimeRange: 1 start), 5 informed_entity (EntitySelector:
 * 2 route_id, 5 stop_id), 7 effect, 10 header_text, 11 description_text
 * (TranslatedString: 1 translation; Translation: 1 text, 2 language). */
export function alertsFeed(alerts, nowSecs) {
  const header = msg(1, [str(1, "2.0"), int(2, 0), int(3, nowSecs)]);
  const text = (field, s, lang) => (s ? msg(field, [msg(1, [str(1, s), lang ? str(2, lang) : null])]) : null);
  const entities = alerts.map((a) =>
    msg(2, [
      str(1, a.id),
      msg(5, [
        a.start ? msg(1, [int(1, a.start)]) : null,
        ...(a.routes || []).map((r) => msg(5, [str(2, r)])),
        ...(a.stops || []).map((s) => msg(5, [str(5, s)])),
        a.effect ? int(7, a.effect) : null,
        text(10, a.header, a.lang),
        text(11, a.description, a.lang),
      ]),
    ]),
  );
  return concat([header, ...entities]);
}
