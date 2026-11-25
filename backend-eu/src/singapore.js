// Singapore: LTA DataMall's Train Service Alerts (MRT and LRT disruptions),
// as GTFS-Realtime alerts. LTA publishes no train positions or timetable:
// the app's trains are an estimate (tools/sg/osm-gtfs.py) and these alerts
// are the only live data. Key SG_LTA_ACCOUNT_KEY (AGENTS.md), only in the
// AccountKey header. One call a minute.
//
// The JSON: { value: { Status: 1 (normal) | 2 (disrupted), AffectedSegments:
// [{ Line: "NSL", Direction, Stations: "NS1,NS2", FreePublicBus,
// FreeMRTShuttle, MRTShuttleDirection }], Message: [{ Content, CreatedDate:
// "2026-11-25 08:01:00" }] } }. Lines become the estimated timetable's
// route ids (NSL → NS; Sengkang's and Punggol's LRT → both loops).

import { alertsFeed } from "./encode.js";

const CLIENT = "Metranos-TrainRadar";
const LINES = {
  NSL: ["NS"],
  EWL: ["EW", "CG"],
  CGL: ["CG"],
  NEL: ["NE"],
  CCL: ["CC", "CE"],
  CEL: ["CE"],
  DTL: ["DT"],
  TEL: ["TE"],
  BPL: ["BP"],
  BPLRT: ["BP"],
  SLRT: ["SE", "SW"],
  SKLRT: ["SE", "SW"],
  PLRT: ["PE", "PW"],
  PGLRT: ["PE", "PW"],
};
/** A DataMall line code → the route ids it covers. */
export const routesOf = (line) => LINES[String(line || "").toUpperCase().replace(/\s+/g, "")] || [];

/** "2026-11-25 08:01:00", Singapore time (UTC+8) → seconds since the epoch. */
export function sgSeconds(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/.exec(String(s || ""));
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] || 0)) / 1000);
}

/** DataMall's JSON → alerts for alertsFeed. */
export function parseAlerts(j) {
  const v = j?.value || {};
  const segs = Array.isArray(v.AffectedSegments) ? v.AffectedSegments : [];
  const msgs = (Array.isArray(v.Message) ? v.Message : []).filter((m) => m?.Content);
  const routes = [...new Set(segs.flatMap((s) => routesOf(s.Line)))];
  const disrupted = Number(v.Status) === 2;
  const out = [];
  msgs.forEach((m, i) => {
    out.push({
      id: `sg-msg-${i}-${sgSeconds(m.CreatedDate) || 0}`,
      start: sgSeconds(m.CreatedDate),
      routes,
      effect: disrupted ? 2 : 7,
      header: String(m.Content).split(/(?<=[.!])\s/)[0].slice(0, 160),
      description: String(m.Content),
      lang: "en",
    });
  });
  // A disruption with no message: say which stretch, from the segments.
  if (disrupted && !msgs.length) {
    segs.forEach((s, i) => {
      const st = String(s.Stations || "").split(",").map((x) => x.trim()).filter(Boolean);
      const extra = [s.FreePublicBus ? `Free public buses: ${s.FreePublicBus}.` : "", s.FreeMRTShuttle ? `Free shuttle: ${s.FreeMRTShuttle}.` : ""]
        .filter(Boolean)
        .join(" ");
      out.push({
        id: `sg-seg-${i}-${s.Line}`,
        routes: routesOf(s.Line),
        effect: 2,
        header: `${s.Line}: disrupted${st.length ? ` between ${st[0]} and ${st[st.length - 1]}` : ""}${s.Direction ? ` (${s.Direction})` : ""}`,
        description: [st.length ? `Stations: ${st.join(", ")}.` : "", extra].filter(Boolean).join(" "),
        lang: "en",
      });
    });
  }
  return out;
}

const feeds = [
  {
    name: "alerts.pb",
    path: "ltaodataservice/TrainServiceAlerts",
    convert: (bytes, now) => {
      const j = JSON.parse(new TextDecoder().decode(bytes));
      return alertsFeed(parseAlerts(j), Math.floor(now / 1000));
    },
  },
];

export const SG = {
  code: "sg",
  prefix: "sg/rt/",
  base: "https://datamall2.mytransport.sg/",
  cycleMs: 60_000,
  feeds,
  source: "LTA DataMall, Train Service Alerts (Singapore Open Data Licence), as GTFS-Realtime alerts",
  // The Worker's SG_ENABLED is set from the GitHub variable SG_LIVE_ENABLED.
  enabled: (env) => env.SG_ENABLED === "true" && !!env.SG_LTA_ACCOUNT_KEY,
  missing: (env) => (env.SG_LTA_ACCOUNT_KEY ? null : "no API key (SG_LTA_ACCOUNT_KEY)"),
  headers: (env) => ({ AccountKey: env.SG_LTA_ACCOUNT_KEY, accept: "application/json", "user-agent": CLIENT }),
  keep: () => null,
};
