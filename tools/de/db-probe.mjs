// Germany: which of DB's APIs the keys DE_DB_CLIENT_ID and DE_DB_API_KEY
// open, and what they return, for Frankfurt (Main) Hbf (EVA 8000105):
//
//   DE_DB_CLIENT_ID=… DE_DB_API_KEY=… node tools/de/db-probe.mjs [OUT_DIR]
//
// Timetables (XML: /station, /plan, /fchg, /rchg) and OpenBoards (JSON
// POST /departures, up to 15 stations a call). Keys go only in the
// DB-Client-Id and DB-Api-Key headers and are never printed; the log shows
// status codes, sizes, counts and a short sample, and OUT_DIR gets the raw
// responses (an artifact only CI's log summary reads, never published).
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[2] || "samples/de";
mkdirSync(out, { recursive: true });
const id = process.env.DE_DB_CLIENT_ID;
const key = process.env.DE_DB_API_KEY;
if (!id || !key) {
  console.log("de: DE_DB_CLIENT_ID or DE_DB_API_KEY is not set: skipped.");
  process.exit(0);
}
const headers = { "DB-Client-Id": id, "DB-Api-Key": key, "user-agent": "Metranos-TrainRadar" };
const base = "https://apis.deutschebahn.com/db-api-marketplace/apis";
const pad = (n) => String(n).padStart(2, "0");
const berlin = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
const ymd = `${String(berlin.getFullYear()).slice(2)}${pad(berlin.getMonth() + 1)}${pad(berlin.getDate())}`;
const hh = pad(berlin.getHours());

async function call(name, url, init = {}) {
  try {
    const r = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await r.text();
    writeFileSync(`${out}/${name}`, text);
    console.log(`de: ${name}: HTTP ${r.status}, ${text.length} bytes, ${r.headers.get("content-type") || "-"}`);
    return { status: r.status, text };
  } catch (e) {
    console.log(`de: ${name}: ${e.name} ${String(e.message).slice(0, 120)}`);
    return { status: 0, text: "" };
  }
}

// 1. Timetables.
const xml = { accept: "application/xml" };
const tt = `${base}/timetables/v1`;
await call("tt-station.xml", `${tt}/station/8000105`, { headers: xml });
const plan = await call("tt-plan.xml", `${tt}/plan/8000105/${ymd}/${hh}`, { headers: xml });
const fchg = await call("tt-fchg.xml", `${tt}/fchg/8000105`, { headers: xml });
await call("tt-rchg.xml", `${tt}/rchg/8000105`, { headers: xml });
const count = (s, re) => (s.match(re) || []).length;
if (plan.status === 200) {
  console.log(`de: plan: ${count(plan.text, /<s /g)} stops; first: ${plan.text.replace(/\s+/g, " ").match(/<s [\s\S]{0,400}/)?.[0] || "-"}`);
}
if (fchg.status === 200) {
  console.log(`de: fchg: ${count(fchg.text, /<s /g)} stops, ${count(fchg.text, / ct="/g)} changed times, ${count(fchg.text, / cs="c"/g)} cancellations`);
}

// 2. OpenBoards: which time window it honours (the first run's board began
// five hours before the call and held only 25 departures per transport
// type), by DHID and by EVA number.
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
const local = (d) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "longOffset" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.timeZoneName.replace("GMT", "") || "+00:00"}`;
};
const now = new Date();
const later = new Date(+now + 3600e3);
const m30 = new Date(+now + 1800e3);
const MUC = { evaNumbers: ["8000261"] };
const variants = [
  ["muc-default", MUC, null, {}],
  ["muc-start", MUC, { timeStart: local(now) }, { maxEntriesPerTransportType: 50 }],
  ["muc-start-end", MUC, { timeStart: local(now), timeEnd: local(m30) }, { maxEntriesPerTransportType: 50 }],
  ["muc-start-utc", MUC, { timeStart: iso(now), timeEnd: iso(m30) }, { maxEntriesPerTransportType: 50 }],
  ["muc-count", MUC, { timeStart: local(now), entryCount: 40 }, {}],
  ["muc-sched", MUC, { timeStart: local(now), timeEnd: local(m30) }, { maxEntriesPerTransportType: 50, sortBy: "TIME_SCHEDULE" }],
  ["five-hubs", { evaNumbers: ["8000105", "8000261", "8011160", "8000207", "8002549"] }, { timeStart: local(now), timeEnd: local(m30) }, { maxEntriesPerTransportType: 50 }],
];
let sample = null;
for (const [name, where, timeWindow, extra] of variants) {
  const ob = await call(`ob-${name}.json`, `${base}/open-boards/v1/departures`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ stopPlaceOrStation: where, ...(timeWindow ? { timeWindow } : {}), maxViaStops: 0, ...extra }),
  });
  if (ob.status !== 200) {
    console.log(`de: ${name}: ${ob.text.slice(0, 200).replace(/\s+/g, " ")}`);
    continue;
  }
  const j = JSON.parse(ob.text);
  const d = j.departures || [];
  const times = d.map((x) => x.timeSchedule).sort();
  const types = {};
  for (const x of d) types[x.transport?.type] = (types[x.transport?.type] || 0) + 1;
  const late = d.filter((x) => x.time && x.timeSchedule && x.time !== x.timeSchedule).length;
  const best = d.map((x) => x.time || x.timeSchedule).sort();
  const before = d.filter((x) => Date.parse(x.time || x.timeSchedule) < +now - 600e3).length;
  const kinds = {};
  for (const x of d) kinds[x.timeType] = (kinds[x.timeType] || 0) + 1;
  console.log(`de: ${name}: ${d.length} departures (${late} not on time), scheduled ${times[0] || "-"} … ${times.at(-1) || "-"}, best ${best[0] || "-"} … ${best.at(-1) || "-"}, ${before} more than 10 min before the call (${local(now)}); ${JSON.stringify(types)}; ${JSON.stringify(kinds)}; truncated ${JSON.stringify(j.meta?.truncatedTransportTypes || [])}; ${j.stopPlaces?.length ?? 0} stop places`);
  sample ||= d.find((x) => x.transport?.type === "REGIONAL_TRAIN") && { d: d.find((x) => x.transport?.type === "REGIONAL_TRAIN"), j };
}
if (sample) {
  const { d: x, j } = sample;
  const sp = (eva) => j.stopPlaces?.find((s) => s.evaNumber === eva)?.ifopt || "no DHID";
  console.log(`de: a regional departure: ${x.transport.category} ${x.transport.journeyNumber} (${x.transport.journeyDescription}, line ${x.transport.line?.name || "-"}, operator ${j.administrations?.find((a) => a.administrationId === x.transport.administrationId)?.operatorName || "-"}) at ${x.evaNumber} (${sp(x.evaNumber)}), scheduled ${x.timeSchedule}, best ${x.time} (${x.timeType}), cancelled ${!!x.cancelled}, journeyId ${x.journeyId ? "yes" : "no"}, start ${x.journeyInfo?.scheduledStartTime}, origin ${sp(x.journeyInfo?.origin?.evaNumber)}`);
}
