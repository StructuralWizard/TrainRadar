// Victoria: which of Transport Victoria's GTFS-Realtime endpoints the key
// AU_VIC_API_KEY opens (only in the KeyID header, never printed), and how
// many of their trips the timetable just built has:
//
//   AU_VIC_API_KEY=… node tools/au/vic-probe.mjs TRIPS.txt [OUT_DIR]
//
// The portal allows 24 calls a minute per feed: one call per address here.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fields, str, sub } from "../../backend-eu/src/protobuf.js";

const [tripsFile, out = "samples/au"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const key = process.env.AU_VIC_API_KEY;
if (!key) {
  console.log("vic: AU_VIC_API_KEY is not set: skipped.");
  process.exit(0);
}
const known = new Set(readFileSync(tripsFile, "utf8").split("\n").filter(Boolean));
const base = "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1";
const paths = [];
for (const op of ["metro", "vline"]) for (const f of ["trip-updates", "vehicle-positions", "service-alerts"]) paths.push(`/${op}/${f}`);

for (const p of paths) {
  try {
    const r = await fetch(base + p, { headers: { KeyID: key, accept: "application/x-protobuf", "user-agent": "Metranos-TrainRadar" } });
    const b = new Uint8Array(await r.arrayBuffer());
    if (!r.ok) {
      console.log(`vic ${p}: HTTP ${r.status} ${new TextDecoder().decode(b.slice(0, 120)).replace(/\s+/g, " ")}`);
      continue;
    }
    writeFileSync(`${out}/vic${p.replaceAll("/", "_")}.pb`, b);
    let n = 0, tu = 0, vp = 0, al = 0, found = 0;
    const missing = [];
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
        else if (missing.length < 3) missing.push(id);
      }
    }
    const trips = tu + vp;
    console.log(`vic ${p}: HTTP 200, ${b.length} bytes, ${n} entities (${tu} trip updates, ${vp} vehicles, ${al} alerts)` +
      (trips ? `, ${found} in the timetable (${Math.round((100 * found) / trips)} %)` : "") +
      (missing.length ? `; not found e.g. ${missing.join(" ")}` : ""));
  } catch (e) {
    console.log(`vic ${p}: ${e.name} ${String(e.message).slice(0, 100)}`);
  }
}
