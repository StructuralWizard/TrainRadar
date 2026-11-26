// New South Wales: which of Transport for NSW's GTFS-Realtime endpoints the
// key AU_NSW_API_KEY opens, and how many of their trips the timetable just
// built has:
//
//   AU_NSW_API_KEY=… node tools/au/nsw-probe.mjs TRIPS.txt [OUT_DIR]
//
// The key goes only in the Authorization header ("apikey …") and is never
// printed: lines show addresses, status codes, sizes and counts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fields, str, sub } from "../../backend-eu/src/protobuf.js";

const [tripsFile, out = "samples/au"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const key = process.env.AU_NSW_API_KEY;
if (!key) {
  console.log("au: AU_NSW_API_KEY is not set: skipped.");
  process.exit(0);
}
const known = new Set(readFileSync(tripsFile, "utf8").split("\n").filter(Boolean));
// NSW TrainLink's ids look like run.ddmmyy.variant.hhmm: for an id the
// timetable lacks, the timetable's ids with the same run and time show
// whether only the date part differs (a newer or older timetable version).
const byRun = new Map();
for (const id of known) {
  const p = id.split(".");
  if (p.length !== 4) continue;
  const k = `${p[0]}|${p[3]}`;
  if (!byRun.has(k)) byRun.set(k, []);
  byRun.get(k).push(id);
}
function near(id) {
  const p = id.split(".");
  return p.length === 4 ? (byRun.get(`${p[0]}|${p[3]}`) || []).slice(0, 3) : [];
}
const base = "https://api.transport.nsw.gov.au";
const paths = [];
for (const op of ["sydneytrains", "nswtrains", "metro"]) {
  for (const v of ["v2", "v1"]) {
    paths.push(`/${v}/gtfs/realtime/${op}`, `/${v}/gtfs/vehiclepos/${op}`);
  }
}
paths.push("/v2/gtfs/alerts/sydneytrains", "/v2/gtfs/alerts/nswtrains", "/v2/gtfs/alerts/metro");

for (const p of paths) {
  try {
    const r = await fetch(base + p, { headers: { authorization: `apikey ${key}`, accept: "application/x-google-protobuf", "user-agent": "Metranos-TrainRadar" } });
    const b = new Uint8Array(await r.arrayBuffer());
    if (!r.ok) {
      console.log(`au ${p}: HTTP ${r.status}`);
      continue;
    }
    writeFileSync(`${out}/${p.replaceAll("/", "_")}.pb`, b);
    let n = 0, tu = 0, vp = 0, al = 0, found = 0;
    const missing = [];
    let sameRun = 0, unknown = 0;
    const samples = [];
    for (const f of fields(b)) {
      if (f.field !== 2 || f.wire !== 2) continue;
      n++;
      const t = sub(f.value, 3), v = sub(f.value, 4), a = sub(f.value, 5);
      const trip = t ? sub(t, 1) : v ? sub(v, 1) : null;
      if (t) tu++;
      if (v) vp++;
      if (a) al++;
      if (trip) {
        const id = str(trip, 1);
        if (known.has(id)) found++;
        else {
          if (missing.length < 3) missing.push(id);
          const n = near(id);
          if (n.length) {
            sameRun++;
            if (samples.length < 4) samples.push(`${id} ~ ${n.join(" ")}`);
          } else unknown++;
        }
      }
    }
    const trips = tu + vp;
    console.log(`au ${p}: HTTP 200, ${b.length} bytes, ${n} entities (${tu} trip updates, ${vp} vehicles, ${al} alerts)` +
      (trips ? `, ${found} in the timetable (${Math.round((100 * found) / trips)} %)` : "") +
      (missing.length ? `; not found e.g. ${missing.join(" ")}` : "") +
      (sameRun ? `; ${sameRun} of those match a timetable trip by run and time, ${unknown} don't (${samples.join("; ")})` : ""));
  } catch (e) {
    console.log(`au ${p}: ${e.name} ${String(e.message).slice(0, 100)}`);
  }
}
