// Filter a GTFS-Realtime feed down to one operator's entities, keeping each
// entity's bytes exactly as published (FeedMessage: 1 header, 2 entity;
// FeedEntity: 3 trip_update, 4 vehicle, 5 alert; TripDescriptor: 1 trip_id,
// 5 route_id; Alert: 5 informed_entity; EntitySelector: 1 agency_id,
// 2 route_id, 4 trip).

import { concat, fields, str, sub, subs } from "./protobuf.js";

/** The trip an entity is about (trip update or vehicle): { tripId, routeId }. */
export function entityTrip(entity) {
  const tu = sub(entity, 3) || sub(entity, 4);
  const trip = tu ? sub(tu, 1) : null;
  return { tripId: str(trip, 1), routeId: str(trip, 5) };
}

/** What an alert is about: [{ agency, route, tripId, tripRoute }]. */
export function alertTargets(entity) {
  const alert = sub(entity, 5);
  if (!alert) return [];
  return subs(alert, 5).map((sel) => {
    const trip = sub(sel, 4);
    return { agency: str(sel, 1), route: str(sel, 2), tripId: str(trip, 1), tripRoute: str(trip, 5) };
  });
}

/**
 * Keep the entities `keep(entity)` says yes to. Returns the new feed (the
 * original header, then the kept entities' bytes) and the counts.
 */
export function filterFeed(bytes, keep) {
  const parts = [];
  let total = 0;
  let kept = 0;
  for (const f of fields(bytes)) {
    if (f.field === 2 && f.wire === 2) {
      total++;
      if (!keep(f.value)) continue;
      kept++;
    }
    parts.push(f.raw); // the header, and kept entities, byte for byte
  }
  return { bytes: concat(parts), total, kept };
}
