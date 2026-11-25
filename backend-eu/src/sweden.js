// Sweden (M3): Trafiklab's GTFS Sweden 3 Realtime. The feeds come one per
// region (Skånetrafiken, SL, UL…), with every bus and tram in it; their trip
// ids are GTFS Sweden 3's, the static file our timetable is cut from. So:
// one region per cycle, in turn; keep the trips our timetable has (the
// list the deploy publishes as data/se/rail-trips.txt); and all regions'
// trains together make trip_updates.pb.
//
// Trafiklab takes its key only as `?key=` in the URL: an exception approved
// by the maintainer (AGENTS.md). The URL is never logged or stored; errors
// name the region.
//
// The regions' feeds have few trains (SJ, Mälartåg, Västtågen… aren't in
// them), so every train's delay also comes from Trafikverket's open API
// (TrainAnnouncement: each train's advertised and actual time at each
// station), keyed by train number ("#1059", as the engine looks trains up
// when a feed's trip ids aren't the timetable's), and its traffic messages
// (TrainMessage) become alerts. Trafikverket takes its key only in the
// query's body (SE_TRAFIKVERKET_KEY, AGENTS.md); errors never include it.

import { entityTrip } from "./gtfsrt.js";
import { alertsFeed, tripUpdatesFeed } from "./encode.js";

const CLIENT = "Metranos-TrainRadar";

/** Regions with realtime data (Trafiklab's GTFS Sweden 3 page, Nov 2026;
 * Halland's answered 404 on 22 Nov 2026),
 * the ones where trains run: Pågatåg and Öresundståg (skane), SL's
 * pendeltåg, Upptåget, Östgötapendeln, Krösatåg, Kustpilen, Tåg i
 * Bergslagen, Norrtåg… */
export const SE_REGIONS = [
  "skane",
  "sl",
  "ul",
  "otraf",
  "jlt",
  "krono",
  "klt",
  "blekinge",
  "varm",
  "orebro",
  "vastmanland",
  "dt",
  "xt",
  "dintur",
];

/** Our trains' trip ids, from the site (refreshed every 6 hours). */
const TRIPS_TTL_MS = 6 * 3_600_000;
let trips = { set: null, at: 0 };

export async function railTrips(env, fetchFn = fetch, now = Date.now()) {
  if (trips.set && now - trips.at < TRIPS_TTL_MS) return trips.set;
  const url = env.SE_RAIL_TRIPS_URL || "https://mytrainradar.com/data/se/rail-trips.txt";
  const r = await fetchFn(url, { headers: { "user-agent": CLIENT } });
  if (!r.ok) {
    if (trips.set) return trips.set; // keep the last list
    throw new Error(`rail-trips.txt: HTTP ${r.status}`);
  }
  trips = { set: new Set((await r.text()).split("\n").filter(Boolean)), at: now };
  return trips.set;
}
export const resetRailTrips = () => (trips = { set: null, at: 0 });

const regionFeeds = SE_REGIONS.map((op) => ({ name: `tu_${op}.pb`, path: `${op}/TripUpdatesSweden.pb`, part: "trip_updates.pb" }));

const TV_URL = "https://api.trafikinfo.trafikverket.se/v2/data.json";
const xmlAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** One Trafikverket query: the key in the body only. */
async function tvQuery(env, fetchFn, query, what) {
  const body = `<REQUEST><LOGIN authenticationkey="${xmlAttr(env.SE_TRAFIKVERKET_KEY)}"/>${query}</REQUEST>`;
  const r = await fetchFn(TV_URL, {
    method: "POST",
    headers: { "content-type": "text/xml", accept: "application/json", "user-agent": CLIENT },
    body,
  });
  if (!r.ok) throw new Error(`Trafikverket ${what}: HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.RESPONSE?.RESULT?.[0] || {};
  if (res.ERROR) throw new Error(`Trafikverket ${what}: ${String(res.ERROR.MESSAGE || "error").slice(0, 120)}`);
  return res;
}

/** Calls that have happened (or are expected, or cancelled), advertised from
 * three hours ago to an hour ahead; `changeid` gives the changes since the
 * last answer. */
export const announcementQuery = (changeId) =>
  `<QUERY objecttype="TrainAnnouncement" schemaversion="1.9" changeid="${xmlAttr(changeId)}">` +
  "<FILTER><AND>" +
  '<EQ name="Advertised" value="true"/>' +
  '<GT name="AdvertisedTimeAtLocation" value="$dateadd(-03:00:00)"/>' +
  '<LT name="AdvertisedTimeAtLocation" value="$dateadd(01:00:00)"/>' +
  '<OR><EXISTS name="TimeAtLocation" value="true"/><EXISTS name="EstimatedTimeAtLocation" value="true"/><EQ name="Canceled" value="true"/></OR>' +
  "</AND></FILTER>" +
  ["AdvertisedTrainIdent", "ScheduledDepartureDateTime", "LocationSignature", "ActivityType", "AdvertisedTimeAtLocation", "TimeAtLocation", "EstimatedTimeAtLocation", "Canceled", "Deleted"]
    .map((f) => `<INCLUDE>${f}</INCLUDE>`)
    .join("") +
  "</QUERY>";

/** Calls by `ident|date|station|activity` → { n, day, sig, t, a, e, c } (ms). */
let tv = null;
export const resetTrafikverket = () => (tv = null);
/** Every call again every 30 minutes (the changes only in between); calls
 * advertised more than three hours ago are dropped. */
const TV_FULL_MS = 30 * 60_000;
const TV_KEEP_MS = 3 * 3_600_000;

/** Merge TrainAnnouncements into `calls`. */
export function mergeAnnouncements(calls, list) {
  for (const x of list || []) {
    if (!x?.AdvertisedTrainIdent || !x.AdvertisedTimeAtLocation) continue;
    const day = String(x.ScheduledDepartureDateTime || x.AdvertisedTimeAtLocation).slice(0, 10).replaceAll("-", "");
    const k = `${x.AdvertisedTrainIdent}|${day}|${x.LocationSignature}|${x.ActivityType}`;
    if (x.Deleted) {
      delete calls[k];
      continue;
    }
    const ms = (v) => (v ? Date.parse(v) : null);
    calls[k] = {
      n: String(x.AdvertisedTrainIdent),
      day,
      sig: String(x.LocationSignature || ""),
      dep: x.ActivityType === "Avgang",
      t: ms(x.AdvertisedTimeAtLocation),
      a: ms(x.TimeAtLocation),
      e: ms(x.EstimatedTimeAtLocation),
      c: !!x.Canceled,
    };
  }
  return calls;
}

/** Calls → trip updates keyed by train number: the delay at the last call
 * that happened (else the next expected one); a train every one of whose
 * calls is cancelled, cancelled. */
export function announcementUpdates(calls) {
  const trains = new Map();
  for (const c of Object.values(calls)) {
    const k = `${c.n}|${c.day}`;
    if (!trains.has(k)) trains.set(k, []);
    trains.get(k).push(c);
  }
  const out = [];
  for (const [k, list] of trains) {
    const [n, day] = k.split("|");
    list.sort((x, y) => x.t - y.t);
    const done = list.filter((c) => c.a != null);
    const last = done[done.length - 1];
    const next = last ? null : list.find((c) => c.e != null);
    const at = last || next;
    const canceled = list.length >= 2 && list.every((c) => c.c);
    if (!at && !canceled) continue;
    const delay = at ? Math.round(((last ? at.a : at.e) - at.t) / 1000) : null;
    out.push({
      id: `tv-${n}-${day}`,
      tripId: `#${n}`,
      startDate: day,
      label: n,
      canceled,
      stops: at ? [{ stopId: at.sig, arrivalDelay: at.dep ? null : delay, departureDelay: at.dep ? delay : null }] : [],
    });
  }
  return out;
}

async function trafikverketCycle({ env, fetchFn, now }) {
  if (!tv || now - tv.fullAt >= TV_FULL_MS) tv = { changeId: "0", fullAt: now, calls: {} };
  const res = await tvQuery(env, fetchFn, announcementQuery(tv.changeId), "TrainAnnouncement");
  if (tv.changeId === "0") tv.calls = {};
  mergeAnnouncements(tv.calls, res.TrainAnnouncement);
  const last = res.INFO?.LASTCHANGEID;
  if (last) tv.changeId = String(last);
  for (const [k, c] of Object.entries(tv.calls)) if (c.t < now - TV_KEEP_MS) delete tv.calls[k];
  return { bytes: tripUpdatesFeed(announcementUpdates(tv.calls), Math.floor(now / 1000)) };
}

/** Trafikverket's traffic messages (works, faults, disruptions) still on. */
export const messageQuery = () =>
  '<QUERY objecttype="TrainMessage" schemaversion="1.7"><FILTER><EQ name="Deleted" value="false"/></FILTER></QUERY>';

export function messageAlerts(list, now) {
  const out = [];
  for (const m of list || []) {
    const end = m.EndDateTime ? Date.parse(m.EndDateTime) : null;
    if (end != null && end < now) continue;
    const text = String(m.ExternalDescription || "").trim();
    const header = String(m.Header || m.ReasonCodeText || text.split(/(?<=[.!])\s/)[0] || "").trim();
    if (!header && !text) continue;
    const start = m.StartDateTime ? Math.floor(Date.parse(m.StartDateTime) / 1000) : null;
    out.push({ id: `tv-msg-${m.EventId || out.length}`, start, header: header.slice(0, 160), description: text || header, lang: "sv" });
  }
  return out;
}

async function messagesCycle({ env, fetchFn, now }) {
  const res = await tvQuery(env, fetchFn, messageQuery(), "TrainMessage");
  return { bytes: alertsFeed(messageAlerts(res.TrainMessage, now), Math.floor(now / 1000)) };
}

const TV = { name: "tu_trafikverket.pb", path: "TrainAnnouncement", part: "trip_updates.pb", trafikverket: true, produce: trafikverketCycle };
const TM = { name: "alerts.pb", path: "TrainMessage", trafikverket: true, produce: messagesCycle };

/** One turn: the regions in order, Trafikverket's delays after every other
 * region (about every 24 s); its messages in place of one of them on every
 * other turn (about every 6 minutes). */
const TURN = SE_REGIONS.flatMap((op, i) => (i % 2 === 1 ? [regionFeeds[i], TV] : [regionFeeds[i]]));
let swapped = false;
const TURN2 = TURN.map((f) => (f === TV && !swapped ? ((swapped = true), TM) : f));
const feeds = [...TURN, ...TURN2];

export const SE = {
  code: "se",
  prefix: "se/rt/",
  base: "https://opendata.samtrafiken.se/gtfs-rt-sweden/",
  // A call every 8 s: each region about every 3 minutes (~7,700 calls a
  // day; Silver allows 2 million a month), Trafikverket every 24 s.
  cycleMs: 8_000,
  rotate: true,
  feeds,
  parts: { "trip_updates.pb": [...regionFeeds.map((f) => f.name), TV.name] },
  source: "Samtrafiken / Trafiklab.se, GTFS Sweden 3 Realtime, and Trafikverket, open API, CC0 1.0",
  // The Worker's SE_ENABLED is set from the GitHub variable SE_LIVE_ENABLED.
  enabled: (env) => env.SE_ENABLED === "true" && !!env.SE_TRAFIKLAB_RT_KEY,
  missing: (env) => (env.SE_TRAFIKLAB_RT_KEY ? null : "no API key (SE_TRAFIKLAB_RT_KEY)"),
  // Trafikverket's turns, without its key, go to the first region.
  ready: (env, feed) => !feed.trafikverket || !!env.SE_TRAFIKVERKET_KEY,
  url: (env, feed) => `${SE.base}${feed.path}?key=${encodeURIComponent(env.SE_TRAFIKLAB_RT_KEY)}`,
  headers: () => ({ "user-agent": CLIENT, accept: "application/x-protobuf", "accept-encoding": "gzip" }),
  keep: async (name, _bytes, { env, fetchFn, now }) => {
    // Trafikverket's: every train (keyed by number) and every message.
    if (name === TV.name || name === TM.name) return null;
    const set = await railTrips(env, fetchFn, now);
    return (entity) => set.has(entityTrip(entity).tripId);
  },
};
