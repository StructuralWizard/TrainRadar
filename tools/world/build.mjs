// The website's world view: every country's summary.json (written by
// refdata-build next to its manifest) merged into one data/world.json:
//
//   node tools/world/build.mjs build/data
//
// Spain's data is the root of data/, the others in data/<code>/. Per
// country: stations, lines, trains running each half hour of each day of
// its window (local time), and a coarse network to draw. The live part
// (how many trains have live data now) comes every ten minutes from
// backend-eu (world/live.json on the live domain); the page shows the
// timetable figure where there is none.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir = "build/data"] = process.argv.slice(2);
const CODES = ["es", "uk", "ie", "fr", "lu", "fi", "no", "nl", "sk", "ee", "ch", "se", "pl", "at", "cz", "it", "dk", "hu", "de", "be", "au", "nz", "sg", "pt", "jp"];
const countries = {};
for (const c of CODES) {
  const f = c === "es" ? join(dir, "summary.json") : join(dir, c, "summary.json");
  if (!existsSync(f)) continue;
  try {
    countries[c] = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.error(`world: ${f}: ${e.message}`);
  }
}
const out = { generatedAt: new Date().toISOString(), countries };
const text = JSON.stringify(out);
writeFileSync(join(dir, "world.json"), text);
console.log(`world.json: ${Object.keys(countries).length} countries (${Object.keys(countries).join(" ")}), ${Math.round(text.length / 1024)} KB`);
for (const [c, s] of Object.entries(countries)) {
  console.log(`  ${c}: ${s.stations} stations, ${s.lines} lines, ${s.net.length / 4} segments, peak ${Math.max(0, ...(s.running[1] || s.running[0] || []))} trains`);
}
