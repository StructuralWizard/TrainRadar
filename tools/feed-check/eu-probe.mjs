// One call to each M3/M5 live source, through backend-eu's own cycle code
// (the same fetch, filter and conversion the Worker does), and how many of
// its trips the timetable just built has:
//
//   node tools/feed-check/eu-probe.mjs ch|pl|se|cz|dk|de GTFS_ZIP_TRIP_IDS_FILE OUT_DIR
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
    get: async (k) => (m.has(k) ? { arrayBuffer: async () => m.get(k), text: async () => String(m.get(k)) } : null),
    m,
  };
}

/** fetch, but the Swedish train list from the file just built. */
const fetchFn = async (url, init) =>
  url.endsWith("rail-trips.txt")
    ? new Response(readFileSync(tripsFile, "utf8"))
    : url.endsWith("boards.txt") && process.env.DE_BOARDS_FILE
      ? new Response(readFileSync(process.env.DE_BOARDS_FILE, "utf8"))
      : fetch(url, init);

async function viaWorker(country, minutes, pauseMs = 0) {
  const LIVE = bucket();
  const env = { ...process.env, LIVE };
  for (const minute of minutes) {
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    const s = await runCycle({ state: { ...emptyState(), minute }, env, fetchFn, now: Date.now(), country });
    const f = s.feeds[s.fetched] || {};
    console.log(`${cc} cycle ${minute}: ${s.fetched} ok=${s.ok} ${s.error || ""} entities=${f.entities ?? "-"} kept=${f.kept ?? "-"}`);
  }
  for (const [k, v] of LIVE.m) {
    if (!k.endsWith(".pb")) continue;
    const name = k.split("/").pop();
    writeFileSync(`${out}/${name}`, v);
    if (name.startsWith("trip_updates") || name === "tu_trafikverket.pb") report(name, v);
    if (name === "tu_trafikverket.pb") {
      const n = tripIds(v).filter((id) => id.startsWith("#"));
      console.log(`${cc} Trafikverket: ${n.length} trains with a delay, e.g. ${n.slice(0, 8).join(" ")}`);
    }
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
  // The changes (cycle 1) and the disruptions (cycle 15).
  await viaWorker(PL, [1, 15]);
} else if (cc === "se") {
  // Through the Worker's own code: each region in turn, kept to our trains
  // (the list the deploy publishes, here the one just built).
  const { SE } = await import("../../backend-eu/src/sweden.js");
  if (!process.env.SE_TRAFIKLAB_RT_KEY) {
    console.log("se: SE_TRAFIKLAB_RT_KEY is not set");
    process.exit(0);
  }
  // Each feed once: every region and Trafikverket's delays
  // (the trips file also lists the timetable's train numbers, "#1059").
  const names = [...new Set(SE.feeds.map((f) => f.name))];
  console.log(`se: Trafikverket key ${process.env.SE_TRAFIKVERKET_KEY ? "set" : "not set"}`);
  await viaWorker(SE, names.map((n) => SE.feeds.findIndex((f) => f.name === n)));
} else if (cc === "dk") {
  // Denmark: every topic once, through the Worker's own code (login, HTTPS
  // receive, SIRI-ET parse, journey state); messages are acknowledged.
  const { DK } = await import("../../backend-eu/src/denmark.js");
  if (!process.env.DK_NAP_CLIENT_SECRET) {
    console.log("dk: DK_NAP_CLIENT_SECRET is not set");
    process.exit(0);
  }
  await viaWorker(DK, DK.feeds.map((_, i) => i));
} else if (cc === "au") {
  // New South Wales: one turn of every feed through the Worker's own code.
  const { AU } = await import("../../backend-eu/src/australia.js");
  if (!process.env.AU_NSW_API_KEY) {
    console.log("au: AU_NSW_API_KEY is not set");
    process.exit(0);
  }
  // New South Wales' calls are the even ones (Victoria's the odd ones).
  await viaWorker(AU, [0, 2, 6, 10, 14, 18, 26, 62], 500);
} else if (cc === "au-vic") {
  // Victoria: every feed once (the odd calls), through the Worker's own
  // code, AU_VIC_LIVE on; trip ids against Victoria's timetable.
  const { AU } = await import("../../backend-eu/src/australia.js");
  if (!process.env.AU_VIC_API_KEY || !process.env.AU_NSW_API_KEY) {
    console.log("au-vic: AU_VIC_API_KEY or AU_NSW_API_KEY is not set");
    process.exit(0);
  }
  process.env.AU_VIC_LIVE = "true";
  await viaWorker(AU, [1, 3, 7, 11, 15], 500);
} else if (cc === "nz") {
  // New Zealand: one turn of every feed (both regions) through the
  // Worker's own code, kept to trains.
  const { NZ } = await import("../../backend-eu/src/newzealand.js");
  if (!process.env.NZ_METLINK_API_KEY || !process.env.NZ_AT_API_KEY) {
    console.log("nz: NZ_METLINK_API_KEY or NZ_AT_API_KEY is not set");
    process.exit(0);
  }
  await viaWorker(NZ, NZ.feeds.map((_, i) => i), 500);
} else if (cc === "sg") {
  // Singapore: LTA's train service alerts, once, through the Worker's own
  // code (JSON → GTFS-RT alerts).
  const { SG } = await import("../../backend-eu/src/singapore.js");
  if (!process.env.SG_LTA_ACCOUNT_KEY) {
    console.log("sg: SG_LTA_ACCOUNT_KEY is not set");
    process.exit(0);
  }
  const k = process.env.SG_LTA_ACCOUNT_KEY;
  console.log(`sg: key ${k.length} characters${k.trim() === k ? "" : ", with spaces or a newline around it"}`);
  await viaWorker(SG, [0]);
} else if (cc === "be") {
  // Belgium: trip updates (cycle 1) and alerts (cycle 10), through the
  // Worker's own code; trip ids should be the static GTFS's.
  const { BE } = await import("../../backend-eu/src/belgium.js");
  if (!process.env.BE_SNCB_KEY) {
    console.log("be: BE_SNCB_KEY is not set");
    process.exit(0);
  }
  await viaWorker(BE, [1, 10]);
} else if (cc === "de") {
  // Germany: a few cycles of OpenBoards through the Worker's own code (the
  // station list just built), and how many boards' trains the timetable has
  // by number (the file lists "#8230").
  const { DE } = await import("../../backend-eu/src/germany.js");
  if (!process.env.DE_DB_CLIENT_ID || !process.env.DE_DB_API_KEY) {
    console.log("de: DE_DB_CLIENT_ID or DE_DB_API_KEY is not set");
    process.exit(0);
  }
  // A cycle every 2 s here: three calls a second, within the plan's ten.
  await viaWorker(DE, [0, 1, 2, 3, 4], 2000);
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
