// TfL's live arrivals now, matched to the timetable index as the UK ingest
// Worker does (backend-uk/src/tfl.js): how many predictions and trains match.
//
//   UK_TFL_APP_KEY=… node tools/feed-check/tfl-match.mjs gtfs/uk/tfl-index.json
import { readFileSync } from "node:fs";
import { MODES, buildLookup, matchPredictions } from "../../backend-uk/src/tfl.js";

const [path] = process.argv.slice(2);
const lookup = buildLookup(JSON.parse(readFileSync(path, "utf8")));
const headers = { "User-Agent": "Metranos-TrainRadar (+https://mytrainradar.com)", Accept: "application/json" };
if (process.env.UK_TFL_APP_KEY) headers.app_key = process.env.UK_TFL_APP_KEY;
const preds = [];
for (const m of MODES) {
  const r = await fetch(`https://api.tfl.gov.uk/Mode/${m}/Arrivals?count=-1`, { headers });
  if (!r.ok) {
    console.log(`TfL ${m}: HTTP ${r.status}`);
    process.exit(1);
  }
  preds.push(...(await r.json()));
}
const { updates, matched, predictions } = matchPredictions(lookup, preds, Date.now());
const ds = updates.map((u) => u.delay).sort((a, b) => a - b);
const q = (f) => ds[Math.min(ds.length - 1, Math.floor(ds.length * f))];
console.log(`TfL live: ${predictions} predictions, ${matched} matched (${Math.round((100 * matched) / Math.max(1, predictions))} %), ${updates.length} trains with a delay`);
if (ds.length) console.log(`delays (s): p10 ${q(0.1)}, median ${q(0.5)}, p90 ${q(0.9)}`);
