// Plan 4a (Northern Ireland): what Translink publishes for NI Railways, so
// the plan (docs/plan-ni.md) rests on facts. No login, public data only.
// - OpenDataNI's catalogue (CKAN API): each dataset's resources, formats,
//   sizes, dates and licence;
// - downloads the timetable files (out/timetable/) for the workflow to
//   list and sample, and the small real-time ones (station codes, example);
// - the live feed's index (tiger.worldline.global/toc/NIR) and, when a
//   station URL can be found in it, one station's board.
// Writes out/report.md.
//
//   node tools/ni-feed-check/check.mjs --out out
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[process.argv.indexOf("--out") + 1] || "out";
mkdirSync(`${out}/timetable`, { recursive: true });
mkdirSync(`${out}/realtime`, { recursive: true });
const report = [];
const say = (s = "") => (report.push(s), console.log(s));

const CKAN = ["https://admin.opendatani.gov.uk", "https://www.opendatani.gov.uk"];
const DATASETS = { timetable: "nir20160126v2", realtime: "real-time-rail-stations-arrivals-and-departures" };
const TIGER = "https://tiger.worldline.global/toc/NIR";

async function get(url, { max = 20_000_000 } = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "TrainRadar feed check" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > max) throw new Error(`${url}: ${buf.length} bytes, over ${max}`);
  return { res, buf, ms: Date.now() - t0 };
}
const text = (buf) => new TextDecoder().decode(buf);
const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

async function packageShow(id) {
  for (const base of CKAN) {
    try {
      const { res, buf } = await get(`${base}/api/3/action/package_show?id=${id}`);
      if (!res.ok) continue;
      const j = JSON.parse(text(buf));
      if (j.success) return { base, pkg: j.result };
    } catch (e) {
      say(`- ${base}: ${e.message}`);
    }
  }
  return null;
}

say("# NI Railways open data check");
say(`Run: ${new Date().toISOString()}`);
const found = {};
for (const [kind, id] of Object.entries(DATASETS)) {
  say(`\n## Dataset: ${id}`);
  const r = await packageShow(id);
  if (!r) {
    say("**Not found** in the CKAN API.");
    continue;
  }
  const p = r.pkg;
  found[kind] = p;
  say(`- Title: ${p.title}`);
  say(`- Licence: ${p.license_title || p.license_id} · Updated: ${p.metadata_modified}`);
  if (p.notes) say(`- Notes: ${p.notes.replace(/\s+/g, " ").slice(0, 600)}`);
  say("\n| Resource | Format | Size | Modified | URL |\n|---|---|---|---|---|");
  for (const res of p.resources || []) {
    say(`| ${res.name} | ${res.format} | ${res.size ?? "?"} | ${res.last_modified || res.created || "?"} | ${res.url} |`);
  }
  // Download: the timetable's files; the real-time dataset's small ones.
  for (const res of p.resources || []) {
    if (!/^https?:\/\//.test(res.url || "")) continue;
    const dir = kind === "timetable" ? "timetable" : "realtime";
    try {
      const { res: h, buf, ms } = await get(res.url);
      const name = safeName(res.name || res.id) + (/\.\w{2,4}$/.test(res.url) ? res.url.match(/\.\w{2,4}$/)[0] : "");
      writeFileSync(`${out}/${dir}/${name}`, buf);
      say(`- downloaded ${name}: HTTP ${h.status}, ${buf.length} bytes, ${ms} ms, ${h.headers.get("content-type")}`);
    } catch (e) {
      say(`- ${res.name}: ${e.message}`);
    }
  }
}

say("\n## Live feed: " + TIGER);
try {
  const { res, buf, ms } = await get(TIGER, { max: 5_000_000 });
  const body = text(buf);
  writeFileSync(`${out}/realtime/tiger-index.txt`, body);
  say(`- HTTP ${res.status}, ${buf.length} bytes, ${ms} ms, ${res.headers.get("content-type")}, X-Cached: ${res.headers.get("x-cached")}`);
  say("```\n" + body.slice(0, 1500) + "\n```");
  // A station's board: the first link in the index that looks like one.
  const links = [...body.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1], TIGER + "/").toString());
  const station = links.find((u) => /\.(xml|json)$|station|board/i.test(u));
  if (station) {
    const s = await get(station, { max: 5_000_000 });
    writeFileSync(`${out}/realtime/station-example.txt`, s.buf);
    say(`\n### One station: ${station}\n- HTTP ${s.res.status}, ${s.buf.length} bytes, ${s.res.headers.get("content-type")}, X-Cached: ${s.res.headers.get("x-cached")}`);
    say("```\n" + text(s.buf).slice(0, 3000) + "\n```");
  } else {
    say(`- No station link found in the index (${links.length} links).`);
  }
} catch (e) {
  say(`- **Failed:** ${e.message}`);
}

writeFileSync(`${out}/report.md`, report.join("\n") + "\n");
