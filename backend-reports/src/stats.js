// Trust statistics for travellers' reports (docs/plan-crowd-reports.md): for
// each count that was shown, did the operator's own data later agree, and
// how much earlier were the travellers? Pure functions, tested; the Durable
// Object runs them every 5 minutes against the official live files in the
// bucket (in the UK: uk/rt/trip_updates.pb from Network Rail's TRUST, and
// uk/rt/tfl_updates.pb from TfL). Nothing about phones: only trains, kinds
// and times, and once a case is decided only daily totals per kind remain.

/** Official delay that confirms a delay or "hasn't come" report, and one
 * that counts as on time (contradicting it). */
export const LATE_S = 5 * 60;
export const ON_TIME_S = 2 * 60;
/** An incident report counts as confirmed by a big delay or a cancellation. */
export const INCIDENT_S = 10 * 60;
/** A case still open this long after it was shown is closed as "unknown". */
export const DECIDE_MS = 3 * 3600_000;
/** The published summary covers this many days. */
export const DAYS = 30;

// ---- The official files: GTFS-Realtime TripUpdates, decoded minimally ----

function* fields(bytes) {
  let i = 0;
  const varint = () => {
    let v = 0n;
    let s = 0n;
    for (;;) {
      const b = bytes[i++];
      if (b === undefined) throw new Error("truncated");
      v |= BigInt(b & 0x7f) << s;
      s += 7n;
      if (!(b & 0x80)) return v;
    }
  };
  while (i < bytes.length) {
    const k = Number(varint());
    const field = k >> 3;
    const wire = k & 7;
    if (wire === 0) yield [field, Number(BigInt.asIntN(64, varint()))];
    else if (wire === 2) {
      const n = Number(varint());
      yield [field, bytes.subarray(i, i + n)];
      i += n;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error(`wire type ${wire}`);
  }
}

const text = (b) => new TextDecoder().decode(b);

/** trip_id → { delay (s, or null), canceled, ts (unix s, or null) }. */
export function officialTrips(bytes, into = new Map()) {
  for (const [f, entity] of fields(bytes)) {
    if (f !== 2) continue;
    for (const [ef, tu] of fields(entity)) {
      if (ef !== 3) continue;
      let tripId = "";
      let canceled = false;
      let delay = null;
      let ts = null;
      let stopDelay = null;
      for (const [tf, v] of fields(tu)) {
        if (tf === 1) {
          for (const [df, dv] of fields(v)) {
            if (df === 1) tripId = text(dv);
            if (df === 4 && dv === 3) canceled = true; // CANCELED
          }
        } else if (tf === 2) {
          for (const [sf, sv] of fields(v)) {
            if (sf !== 2 && sf !== 3) continue; // arrival, departure
            for (const [xf, xv] of fields(sv)) if (xf === 1) stopDelay = xv;
          }
        } else if (tf === 4) ts = v;
        else if (tf === 5) delay = v;
      }
      if (tripId) into.set(tripId, { delay: delay ?? stopDelay, canceled, ts });
    }
  }
  return into;
}

// ---- Cases: one per trip and kind, from the first time it was shown ----

/** Open a case for every count newly shown in `doc` (reports.json); keep
 * the time of its latest report up to date. */
export function track(cases, doc, now) {
  for (const [trip, kinds] of Object.entries(doc?.trips || {})) {
    for (const [kind, c] of Object.entries(kinds)) {
      const key = `${trip}\u0000${kind}`;
      if (!cases[key]) cases[key] = { trip, kind, shown: now, last: c.last, late: null, already: null };
      else cases[key].last = Math.max(cases[key].last, c.last);
    }
  }
  return cases;
}

/** What the official data says about one case now: "confirmed",
 * "contradicted" or null (not yet). Updates case.late / case.already. */
function verdict(c, o, now) {
  if (!o) return null;
  const tsMs = o.ts ? o.ts * 1000 : null;
  const late = o.canceled || (o.delay ?? 0) >= (c.kind === "incident" ? INCIDENT_S : LATE_S);
  // The first time we see it, was the official data already saying so?
  if (c.already === null) c.already = late && tsMs !== null && tsMs <= c.shown;
  if (late) {
    c.late ??= tsMs ?? now;
    return "confirmed";
  }
  // On time, and newer than the travellers' last report: they were wrong,
  // or it cleared up very quickly. Not for incidents: running on time
  // doesn't disprove one.
  if (c.kind !== "incident" && tsMs !== null && tsMs > c.last && !o.canceled && (o.delay ?? 0) <= ON_TIME_S) return "contradicted";
  return null;
}

/**
 * Decide what can be decided: each case either confirmed, contradicted, or
 * (after DECIDE_MS) unknown. Returns { cases (still open), decided: [{ kind,
 * outcome, shown, leadMs }] }; leadMs is how much earlier the travellers'
 * count was shown than the official data agreed (null if the official data
 * already said so).
 */
export function judge(cases, official, now) {
  const open = {};
  const decided = [];
  for (const [key, c] of Object.entries(cases)) {
    const v = verdict(c, official.get(c.trip), now);
    if (v === "confirmed") decided.push({ kind: c.kind, outcome: v, shown: c.shown, leadMs: c.already ? null : Math.max(0, c.late - c.shown) });
    else if (v === "contradicted") decided.push({ kind: c.kind, outcome: v, shown: c.shown, leadMs: null });
    else if (now - c.shown > DECIDE_MS) decided.push({ kind: c.kind, outcome: "unknown", shown: c.shown, leadMs: null });
    else open[key] = c;
  }
  return { cases: open, decided };
}

/** Add decided cases to the daily totals (by the day they were shown);
 * keep 60 days. */
export function aggregate(daily, decided) {
  for (const d of decided) {
    const day = new Date(d.shown).toISOString().slice(0, 10);
    const k = ((daily[day] ||= {})[d.kind] ||= { shown: 0, confirmed: 0, contradicted: 0, unknown: 0, earlier: 0, earlierMin: 0 });
    k.shown++;
    k[d.outcome]++;
    if (d.outcome === "confirmed" && d.leadMs > 60_000) {
      k.earlier++;
      k.earlierMin += Math.round(d.leadMs / 60_000);
    }
  }
  for (const day of Object.keys(daily).sort().slice(0, -60)) delete daily[day];
  return daily;
}

/** The published summary (<cc>/rt/reports-stats.json): per kind over the
 * last DAYS days, how many counts were shown, the share the official data
 * later confirmed, contradicted or never settled, and how often and by how
 * much the travellers were earlier. */
export function summary(daily, now) {
  const since = new Date(now - DAYS * 86400_000).toISOString().slice(0, 10);
  const kinds = {};
  for (const [day, byKind] of Object.entries(daily)) {
    if (day < since) continue;
    for (const [kind, k] of Object.entries(byKind)) {
      const s = (kinds[kind] ||= { shown: 0, confirmed: 0, contradicted: 0, unknown: 0, earlier: 0, earlierMin: 0 });
      for (const f of Object.keys(s)) s[f] += k[f] || 0;
    }
  }
  const out = {};
  for (const [kind, s] of Object.entries(kinds)) {
    out[kind] = {
      shown: s.shown,
      confirmed: s.shown ? Math.round((100 * s.confirmed) / s.shown) : null,
      contradicted: s.shown ? Math.round((100 * s.contradicted) / s.shown) : null,
      unknown: s.shown ? Math.round((100 * s.unknown) / s.shown) : null,
      earlier: s.confirmed ? Math.round((100 * s.earlier) / s.confirmed) : null,
      earlierMin: s.earlier ? Math.round(s.earlierMin / s.earlier) : null,
    };
  }
  return { at: now, days: DAYS, kinds: out };
}
