// One call to each M3/M5 live source, through backend-eu's own cycle code
// (the same fetch, filter and conversion the Worker does), and how many of
// its trips the timetable just built has:
//
//   node tools/feed-check/eu-probe.mjs ch|pl|se GTFS_ZIP_TRIP_IDS_FILE OUT_DIR
//
// Keys come from the environment (CH_OTD_*, PL_PLK_API_KEY,
// SE_TRAFIKLAB_RT_KEY) and are never printed: lines show feed names, sizes
// and counts only. Sweden isn't in the Worker yet: its regional feeds are
// fetched directly, to see which hold trains.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

async function viaWorker(country, minutes) {
  const LIVE = bucket();
  const env = { ...process.env, LIVE };
  for (const minute of minutes) {
    const s = await runCycle({ state: { ...emptyState(), minute }, env, now: Date.now(), country });
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
  const key = process.env.SE_TRAFIKLAB_RT_KEY;
  if (!key) {
    console.log("se: SE_TRAFIKLAB_RT_KEY is not set");
    process.exit(0);
  }
  // Bronze allows 50 calls a minute: a few regions, both of Trafiklab's
  // realtime APIs (GTFS Sweden 3 Realtime; GTFS Regional Realtime).
  const ops = ["skane", "otraf", "ul", "sl"];
  for (const op of ops) {
    for (const [api, path] of [["Sweden 3", `gtfs-rt-sweden/${op}/TripUpdatesSweden.pb`], ["Regional", `gtfs-rt/${op}/TripUpdates.pb`]]) {
      try {
        // Trafiklab takes the key only in the URL (AGENTS.md); never printed.
        const r = await fetch(`https://opendata.samtrafiken.se/${path}?key=${encodeURIComponent(key)}`, {
          headers: { "user-agent": "Metranos-TrainRadar", "accept-encoding": "gzip" },
        });
        if (!r.ok) {
          const msg = (await r.text()).slice(0, 200).replaceAll(key, "***");
          console.log(`se ${op} (${api}): HTTP ${r.status} ${msg}`);
          continue;
        }
        report(`${op} (${api})`, new Uint8Array(await r.arrayBuffer()));
      } catch (e) {
        console.log(`se ${op} (${api}): ${String(e.message).replaceAll(key, "***")}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
