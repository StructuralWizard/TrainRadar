// SIRI Estimated Timetable (SIRI-ET) → journeys, and a state that merges
// incremental updates (Denmark: Rejsekort & Rejseplan's feeds on the
// national access point, docs/europe/south-north.md).
//
// Rejseplanen's messages (dataset 785, Nov 2026): <Siri> 2.0 →
// ServiceDelivery → EstimatedTimetableDelivery → EstimatedJourneyVersionFrame
// → EstimatedVehicleJourney (LineRef, DirectionRef, FramedVehicleJourneyRef
// {DataFrameRef, DatedVehicleJourneyRef}, PublishedLineName "Re 4402",
// OperatorRef, TrainNumbers/TrainNumberRef, EstimatedCalls/EstimatedCall
// {StopPointRef = UIC station number, Order, Aimed/Expected times with an
// offset, DeparturePlatformName}).
//
// No DOM in a Worker: a small reader for SIRI-ET's flat structure. It
// ignores namespace prefixes ("siri:EstimatedVehicleJourney" reads as
// "EstimatedVehicleJourney") and attributes.

/** Text of the first <tag> directly or deeper inside `xml`, or null. */
function first(xml, tag) {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml);
  return m ? decode(m[1].trim()) : null;
}

/** Every <tag>…</tag> block inside `xml`. */
function all(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  const out = [];
  for (let m; (m = re.exec(xml)); ) out.push(m[1]);
  return out;
}

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const bool = (s) => s === "true";
const time = (s) => (s ? Date.parse(s) : null);

/** One call of a journey: StopPointRef, its order, aimed and expected
 * times (ms since the epoch, null when absent), and whether it's cancelled. */
function call(xml, recorded) {
  return {
    stopRef: first(xml, "StopPointRef"),
    order: Number(first(xml, "Order")) || null,
    name: first(xml, "StopPointName"),
    aimedArr: time(first(xml, "AimedArrivalTime")),
    expArr: time(first(xml, recorded ? "ActualArrivalTime" : "ExpectedArrivalTime")) ?? time(first(xml, "ExpectedArrivalTime")),
    aimedDep: time(first(xml, "AimedDepartureTime")),
    expDep: time(first(xml, recorded ? "ActualDepartureTime" : "ExpectedDepartureTime")) ?? time(first(xml, "ExpectedDepartureTime")),
    cancelled: bool(first(xml, "Cancellation")),
    platform: first(xml, "DeparturePlatformName") || first(xml, "ArrivalPlatformName"),
    passed: recorded,
  };
}

/** A SIRI-ET message → [{ ref, operator, line, train, direction,
 * cancelled, date, stops: [call…] }], calls in order (recorded first). */
export function parseSiriEt(xml) {
  const out = [];
  for (const j of all(xml, "EstimatedVehicleJourney")) {
    // The journey's own fields, without its calls' (a call can be cancelled
    // on its own).
    const head = j.replace(/<(?:\w+:)?(Recorded|Estimated)Calls\b[\s\S]*?<\/(?:\w+:)?\1Calls>/g, "");
    const framed = first(head, "FramedVehicleJourneyRef");
    const ref = first(head, "DatedVehicleJourneyRef") || (framed && first(framed, "DatedVehicleJourneyRef")) || first(head, "EstimatedVehicleJourneyCode");
    if (!ref) continue;
    const recorded = all(j, "RecordedCall").map((c) => call(c, true));
    const estimated = all(j, "EstimatedCall").map((c) => call(c, false));
    out.push({
      ref,
      date: (framed && first(framed, "DataFrameRef")) || null,
      operator: first(head, "OperatorRef"),
      line: first(head, "PublishedLineName") || first(head, "LineRef"),
      // Rejseplanen: <TrainNumbers><TrainNumberRef>4402</TrainNumberRef>.
      train: first(head, "TrainNumberRef") || first(head, "VehicleJourneyName"),
      direction: first(head, "DirectionRef"),
      destination: first(head, "DestinationName") || first(head, "DirectionName"),
      product: first(head, "ProductCategoryRef"),
      cancelled: bool(first(head, "Cancellation")),
      stops: [...recorded, ...estimated].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    });
  }
  return out;
}

/** The delay at a call, in seconds (expected minus aimed), or null. */
export const delay = (expected, aimed) => (expected != null && aimed != null ? Math.round((expected - aimed) / 1000) : null);

/**
 * Journeys kept in memory by their ref: each message updates the calls it
 * carries (a later update of a call replaces the earlier); a journey is
 * dropped an hour after its last call, or when nothing about it came for
 * six hours.
 */
export class JourneyState {
  constructor() {
    this.journeys = new Map();
  }

  /** Merge one message's journeys; returns how many it touched. */
  apply(journeys, now = Date.now()) {
    for (const j of journeys) {
      const old = this.journeys.get(j.ref);
      const stops = new Map((old?.stops || []).map((s) => [s.stopRef + "|" + s.order, s]));
      for (const s of j.stops) stops.set(s.stopRef + "|" + s.order, s);
      this.journeys.set(j.ref, {
        ...old,
        ...Object.fromEntries(Object.entries(j).filter(([, v]) => v != null && v !== "")),
        cancelled: j.cancelled || false,
        stops: [...stops.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        seen: now,
      });
    }
    return journeys.length;
  }

  /** Drop finished and silent journeys; returns how many went. */
  expire(now = Date.now()) {
    let n = 0;
    for (const [ref, j] of this.journeys) {
      const last = j.stops.at(-1);
      const end = last ? (last.expArr ?? last.aimedArr ?? last.expDep ?? last.aimedDep) : null;
      if ((end != null && now - end > 3_600_000) || now - j.seen > 6 * 3_600_000) {
        this.journeys.delete(ref);
        n++;
      }
    }
    return n;
  }

  /** As trip updates for encode.js's tripUpdatesFeed: trip id = the
   * journey ref (a timetable is matched to it later), delays in seconds. */
  tripUpdates() {
    const secs = (ms) => (ms == null ? null : Math.round(ms / 1000));
    return [...this.journeys.values()].map((j) => ({
      id: j.ref,
      tripId: j.ref,
      startDate: (j.date || "").replaceAll("-", "") || undefined,
      canceled: j.cancelled,
      label: j.train || null,
      stops: j.stops.map((s) => ({
        seq: s.order,
        stopId: s.stopRef,
        arrivalDelay: delay(s.expArr, s.aimedArr),
        departureDelay: delay(s.expDep, s.aimedDep),
        arrivalTime: secs(s.expArr ?? s.aimedArr),
        departureTime: secs(s.expDep ?? s.aimedDep),
        skipped: s.cancelled,
      })),
    }));
  }

  /** As JSON for storage between cold starts. */
  toJSON() {
    return [...this.journeys.values()];
  }

  static from(list) {
    const st = new JourneyState();
    for (const j of list || []) st.journeys.set(j.ref, j);
    return st;
  }
}
