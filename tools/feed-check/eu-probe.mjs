// One call to each M3/M5 live source, through backend-eu's own cycle code
// (the same fetch, filter and conversion the Worker does), and how many of
// its trips the timetable just built has:
//
//   node tools/feed-check/eu-probe.mjs ch|pl|se|cz GTFS_ZIP_TRIP_IDS_FILE OUT_DIR
//
// (For cz the file lists train numbers: Golemio's trips are PID's own and
// match ours by the number in the vehicle id, "train-9504".)
//
// Keys come from the environment (CH_OTD_*, PL_PLK_API_KEY,
// SE_TRAFIKLAB_RT_KEY) and are never printed: lines show feed names, sizes
// and counts only. Sweden isn't in the Worker yet: its regional feeds are
// fetched directly, to see which hold trains.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runCycle, emptyState } from "../../backend-eu/src/cycle.js";
import { CH, PL } from "../../backend-eu/src/central.js";
import { fields, str, sub } from "../../backend-eu/src/protobuf.js";

const [cc, tripsFile, out = "probe"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const known = new Set(readFileSync(tripsFile, "utf8").split("\n").filter(Boolean));

/** Trip ids of a GTFS-RT feed's trip updates and vehicles. */
function tripIds(bytes) {
  const ids = [];
  for (const f of fields(bytes)) {
    if (f.field !== 2 || f.wire !== 2) continue;
    const tu = sub(f.value, 3) || sub(f.value, 4);
    const trip = tu ? sub(tu, 1) : null;
    if (trip) ids.push(str(trip, 1));
  }
  return ids;
}

const report = (name, bytes, extra = "") => {
  const ids = tripIds(bytes);
  const matched = ids.filter((id) => known.has(id)).length;
  const sample = ids.filter((id) => !known.has(id)).slice(0, 3).join(" ");
  console.log(
    `${cc} ${name}: ${bytes.length} bytes, ${ids.length} trips, ${matched} in the timetable` +
      (ids.length ? ` (${Math.round((100 * matched) / ids.length)} %)` : "") +
      (sample ? `; not found e.g. ${sample}` : "") +
      extra,
  );
};

function bucket() {
  const m = new Map();
  return {
    put: async (k, v) => m.set(k, v),
    get: async (k) => (m.has(k) ? { arrayBuffer: async () => m.get(k) } : null),
    m,
  };
}

/** fetch, but the Swedish train list from the file just built. */
const fetchFn = async (url, init) =>
  url.endsWith("rail-trips.txt") ? new Response(readFileSync(tripsFile, "utf8")) : fetch(url, init);

async function viaWorker(country, minutes) {
  const LIVE = bucket();
  const env = { ...process.env, LIVE };
  for (const minute of minutes) {
    const s = await runCycle({ state: { ...emptyState(), minute }, env, fetchFn, now: Date.now(), country });
    const f = s.feeds[s.fetched] || {};
    console.log(`${cc} cycle ${minute}: ${s.fetched} ok=${s.ok} ${s.error || ""} entities=${f.entities ?? "-"} kept=${f.kept ?? "-"}`);
  }
  for (const [k, v] of LIVE.m) {
    if (!k.endsWith(".pb")) continue;
    const name = k.split("/").pop();
    writeFileSync(`${out}/${name}`, v);
    if (name.startsWith("trip_updates")) report(name, v);
    else console.log(`${cc} ${name}: ${v.length} bytes, ${fields(v).filter((f) => f.field === 2).length} entities`);
  }
}

if (cc === "ch") {
  // Trip updates; unplanned alerts (minute 3); planned alerts (minute 90).
  await viaWorker(CH, [1, 3, 90]);
  // Which key each alerts address takes (all 403 on the first run): every
  // key set, on each candidate address; status codes only.
  const keys = ["CH_OTD_GTFSRT_KEY", "CH_OTD_GTFSSA_KEY", "CH_OTD_GTFSSA_PLANNED_KEY"].filter((k) => process.env[k]);
  for (const path of ["gtfs-sa", "gtfs-sa-planned", "gtfs-sa-unplanned", "gtfs-sa/planned"]) {
    const codes = [];
    for (const k of keys) {
      const r = await fetch(CH.base + path, { headers: { authorization: `Bearer ${process.env[k]}`, "user-agent": "Metranos-TrainRadar" } });
      const n = r.ok ? (await r.arrayBuffer()).byteLength : 0;
      codes.push(`${k}: ${r.status}${r.ok ? ` (${n} bytes)` : ""}`);
    }
    console.log(`ch ${path}: ${codes.join(", ")}`);
  }
} else if (cc === "pl") {
  await viaWorker(PL, [0]);
} else if (cc === "se") {
  // Through the Worker's own code: each region in turn, kept to our trains
  // (the list the deploy publishes, here the one just built).
  const { SE } = await import("../../backend-eu/src/sweden.js");
  if (!process.env.SE_TRAFIKLAB_RT_KEY) {
    console.log("se: SE_TRAFIKLAB_RT_KEY is not set");
    process.exit(0);
  }
  await viaWorker(SE, SE.feeds.map((_, i) => i));
} else if (cc === "cz") {
  const { CZ } = await import("../../backend-eu/src/czechia.js");
  await viaWorker(CZ, [0, 1, 2]);
  // Which live trains' numbers run in the timetable just built.
  if (!existsSync(`${out}/vehicle_positions.pb`)) {
    console.log("cz: no vehicle positions fetched");
    process.exit(0);
  }
  const vp = readFileSync(`${out}/vehicle_positions.pb`);
  const nums = [];
  for (const f of fields(vp)) {
    if (f.field !== 2 || f.wire !== 2) continue;
    const v = sub(f.value, 4);
    const id = v ? str(sub(v, 8), 1) : "";
    if (id.startsWith("train-")) nums.push(id.slice(6));
  }
  const found = nums.filter((n) => known.has(n));
  console.log(`cz: ${nums.length} PID trains with GPS, ${found.length} of their numbers in the timetable` +
    (nums.length ? ` (${Math.round((100 * found.length) / nums.length)} %)` : "") +
    `; not found e.g. ${nums.filter((n) => !known.has(n)).slice(0, 5).join(" ")}`);
}
