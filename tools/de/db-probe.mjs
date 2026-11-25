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

// 2. OpenBoards.
const now = new Date();
const ob = await call("ob-departures.json", `${base}/open-boards/v1/departures`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    stopPlaceOrStation: { evaNumbers: ["8000105", "8000261", "8011160"] },
    timeWindow: { timeStart: now.toISOString().replace(/\.\d+Z$/, "Z"), timeEnd: new Date(+now + 3600e3).toISOString().replace(/\.\d+Z$/, "Z") },
    maxViaStops: 0,
  }),
});
if (ob.status === 200) {
  const j = JSON.parse(ob.text);
  const d = j.departures || [];
  const late = d.filter((x) => x.time && x.timeSchedule && x.time !== x.timeSchedule).length;
  console.log(`de: openboards: ${d.length} departures (${late} not on time), ${j.stopPlaces?.length ?? 0} stop places, ${j.administrations?.length ?? 0} administrations`);
  const x = d[0];
  if (x) console.log(`de: first: ${x.transport?.category} ${x.transport?.journeyNumber} at ${x.evaNumber} (${j.stopPlaces?.find((s) => s.evaNumber === x.evaNumber)?.ifopt || "no DHID"}), scheduled ${x.timeSchedule}, best ${x.time} (${x.timeType}), platform ${x.platform?.name || "-"}, dfid ${x.transport?.dfid ? "yes" : "no"}`);
}
