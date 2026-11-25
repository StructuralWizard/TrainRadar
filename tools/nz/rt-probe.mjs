// New Zealand: which of a region's GTFS-Realtime endpoints its key opens
// (only in a request header, never printed), in which format (protobuf or
// JSON), and how many of their trips the timetable just built has:
//
//   NZ_METLINK_API_KEY=… node tools/nz/rt-probe.mjs wlg TRIPS.txt [OUT_DIR]
//   NZ_AT_API_KEY=… node tools/nz/rt-probe.mjs akl TRIPS.txt [OUT_DIR]
//
// One call per address (and one more asking for JSON if the first wasn't).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fields, str, sub } from "../../backend-eu/src/protobuf.js";

const REGIONS = {
  // Metlink (Wellington): the key in x-api-key.
  wlg: {
    env: "NZ_METLINK_API_KEY",
    header: "x-api-key",
    base: "https://api.opendata.metlink.org.nz/v1",
    paths: ["/gtfs-rt/tripupdates", "/gtfs-rt/vehiclepositions", "/gtfs-rt/servicealerts"],
  },
  // Auckland Transport: the key in Ocp-Apim-Subscription-Key; the combined
  // feed and its three parts.
  akl: {
    env: "NZ_AT_API_KEY",
    header: "Ocp-Apim-Subscription-Key",
    base: "https://api.at.govt.nz/realtime/legacy",
    paths: ["", "/tripupdates", "/vehiclelocations", "/servicealerts"],
  },
};

const [region, tripsFile, out = "samples/nz"] = process.argv.slice(2);
const cfg = REGIONS[region];
if (!cfg) {
  console.log(`usage: rt-probe.mjs ${Object.keys(REGIONS).join("|")} TRIPS.txt [OUT_DIR]`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const key = process.env[cfg.env];
if (!key) {
  console.log(`${region}: ${cfg.env} is not set: skipped.`);
  process.exit(0);
}
const known = new Set(readFileSync(tripsFile, "utf8").split("\n").filter(Boolean));

function countPb(b) {
  const c = { n: 0, tu: 0, vp: 0, al: 0, trips: [] };
  for (const f of fields(b)) {
    if (f.field !== 2 || f.wire !== 2) continue;
    c.n++;
    const t = sub(f.value, 3), v = sub(f.value, 4), a = sub(f.value, 5);
    const trip = t ? sub(t, 1) : v ? sub(v, 1) : null;
    if (t) c.tu++;
    if (v) c.vp++;
    if (a) c.al++;
    if (trip) c.trips.push(str(trip, 1));
  }
  return c;
}

function countJson(j) {
  const c = { n: 0, tu: 0, vp: 0, al: 0, trips: [] };
  const body = j.response || j;
  for (const e of body.entity || body.entities || []) {
    c.n++;
    const t = e.trip_update || e.tripUpdate, v = e.vehicle, a = e.alert;
    if (t) c.tu++;
    if (v) c.vp++;
    if (a) c.al++;
    const trip = (t || v)?.trip;
    if (trip) c.trips.push(trip.trip_id ?? trip.tripId);
  }
  return c;
}

function report(p, how, bytes, c) {
  const rail = c.trips.filter((id) => known.has(id)).length;
  const sample = [...new Set(c.trips)].slice(0, 3).join(" ");
  console.log(`${region} ${p || "/"} (${how}): ${bytes} bytes, ${c.n} entities (${c.tu} trip updates, ${c.vp} vehicles, ${c.al} alerts)` +
    (c.trips.length ? `, ${rail} trips in the train timetable` : "") + (sample ? `; trip ids e.g. ${sample}` : ""));
}

for (const p of cfg.paths) {
  for (const accept of ["application/x-protobuf", "application/json"]) {
    try {
      const r = await fetch(cfg.base + p, { headers: { [cfg.header]: key, accept, "user-agent": "Metranos-TrainRadar" } });
      const b = new Uint8Array(await r.arrayBuffer());
      const ctype = r.headers.get("content-type") || "?";
      if (!r.ok) {
        console.log(`${region} ${p || "/"} (accept ${accept}): HTTP ${r.status} ${new TextDecoder().decode(b.slice(0, 120)).replace(/\s+/g, " ")}`);
        continue;
      }
      const name = `${out}/${region}${(p || "/all").replaceAll("/", "_")}`;
      if (b[0] === 0x7b) {
        writeFileSync(`${name}.json`, b);
        const j = JSON.parse(new TextDecoder().decode(b));
        const body = j.response || j;
        report(p, `accept ${accept} → ${ctype}, JSON; top keys ${Object.keys(j).join(",")}; first entity keys ${Object.keys((body.entity || [])[0] || {}).join(",")}`, b.length, countJson(j));
        const e = (body.entity || []).find((x) => x.trip_update || x.tripUpdate);
        if (e) console.log(`${region} ${p || "/"}: a trip update's shape: ${JSON.stringify(e).slice(0, 400)}`);
        break; // JSON already: no need to ask again.
      }
      writeFileSync(`${name}.pb`, b);
      report(p, `accept ${accept} → ${ctype}, protobuf`, b.length, countPb(b));
      break;
    } catch (e) {
      console.log(`${region} ${p || "/"} (accept ${accept}): ${e.name} ${String(e.message).slice(0, 100)}`);
    }
  }
}
