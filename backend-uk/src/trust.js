// TRUST train movements → each running train's latest delay (plan 3,
// phase 3c). Messages (docs/data-sources-uk.md):
//   0001 activation   train_id → the schedule (train_uid, schedule_start_date,
//                     schedule_type = STP indicator) and the service date
//   0002 cancellation 0005 reinstatement
//   0003 movement     actual vs planned time at a timing point
// The state is plain JSON (kept in the Durable Object between minutes).

/** How long a train is kept without news, and after it terminated. */
export const KEEP_SILENT_MS = 4 * 3600_000;
export const KEEP_TERMINATED_MS = 30 * 60_000;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

export function emptyState() {
  return { trains: {}, counts: { activations: 0, movements: 0, cancellations: 0, unknown: 0 } };
}

/** Apply one TRUST message ({ header: { msg_type }, body }) at `now` (ms). */
export function applyMessage(state, msg, now) {
  const type = msg?.header?.msg_type;
  const b = msg?.body;
  if (!b?.train_id) return;
  const id = b.train_id;
  const t = (state.trains[id] ||= { id });
  t.updated = now;
  switch (type) {
    case "0001": {
      state.counts.activations += 1;
      t.uid = b.train_uid;
      t.start = b.schedule_start_date;
      t.stp = b.schedule_type;
      // tp_origin_timestamp is the service date ("2026-11-12").
      t.date = /^\d{4}-\d\d-\d\d$/.test(b.tp_origin_timestamp || "") ? b.tp_origin_timestamp : ymd(Number(b.origin_dep_timestamp) || now);
      t.toc = b.toc_id;
      break;
    }
    case "0002": {
      state.counts.cancellations += 1;
      // At origin the whole run is off; en route it stops short (still runs).
      if (b.canx_type === "AT ORIGIN" || b.canx_type === "OUT OF PLAN") t.canceled = true;
      else t.cutAt = b.loc_stanox;
      break;
    }
    case "0005":
      t.canceled = false;
      t.cutAt = undefined;
      break;
    case "0003": {
      state.counts.movements += 1;
      const actual = Number(b.actual_timestamp);
      const planned = Number(b.planned_timestamp);
      if (actual && planned) {
        // Both in the same (TRUST) time basis, so the difference is right
        // whatever that basis is.
        t.delay = Math.round((actual - planned) / 1000);
        t.at = actual;
      } else if (b.timetable_variation !== undefined) {
        const m = Number(b.timetable_variation) || 0;
        t.delay = b.variation_status === "EARLY" ? -60 * m : 60 * m;
      }
      t.stanox = b.loc_stanox;
      t.event = b.event_type;
      if (b.train_terminated === "true") t.terminated = now;
      break;
    }
    default:
      state.counts.unknown += 1;
  }
}

/** Forget trains with no news for long, or terminated a while ago. */
export function expire(state, now) {
  for (const [id, t] of Object.entries(state.trains)) {
    if (now - (t.updated || 0) > KEEP_SILENT_MS || (t.terminated && now - t.terminated > KEEP_TERMINATED_MS)) {
      delete state.trains[id];
    }
  }
}

/**
 * The trip updates to publish: trains linked to a schedule with a delay or
 * cancelled. Trip ids are the timetable's (`UID:start:STP`, see
 * crates/refdata-build/src/nrsched.rs). TRUST's schedule_type is reported to
 * swap P and O; the swapped id is published too, only one of them exists in
 * the timetable, so the other is ignored.
 */
export function tripUpdates(state) {
  const out = [];
  for (const t of Object.values(state.trains)) {
    if (!t.uid || !t.start || (t.delay === undefined && !t.canceled)) continue;
    const ids = [t.stp];
    if (t.stp === "P") ids.push("O");
    if (t.stp === "O") ids.push("P");
    for (const stp of ids) {
      out.push({
        id: `${t.id}${stp === t.stp ? "" : `~${stp}`}`,
        tripId: `${t.uid}:${t.start}:${stp}`,
        startDate: (t.date || "").replaceAll("-", ""),
        canceled: !!t.canceled,
        delay: t.delay,
        timestamp: t.at ? Math.round(t.at / 1000) : Math.round((t.updated || 0) / 1000),
      });
    }
  }
  return out;
}
