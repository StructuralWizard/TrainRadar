// Screenshot of the app with live data for the README: Madrid, desktop
// size, one train's popup open. Prints it base64 between markers so it can
// be copied from the CI log (artifacts need a login to download).
//
//   node tools/feed-check/readme-shot.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForFunction(() => window.__trainradar?.map?.getLayer("trains"), null, { timeout: 60000 });
await page.waitForFunction(() => window.__trainradar.engine.positions(Date.now()).length > 20, null, { timeout: 60000 });
// Madrid, close enough for its Cercanías lines and stations.
await page.evaluate(() => window.__trainradar.map.jumpTo({ center: [-3.68, 40.42], zoom: 10.2 }));
await page.waitForTimeout(8000); // núcleo timetable, lines and tiles
// Open the popup of a delayed train near the middle, if any, else any train.
const pt = await page.evaluate(() => {
  const { map } = window.__trainradar;
  const { width, height } = map.getCanvas().getBoundingClientRect();
  const feats = map.queryRenderedFeatures([[width * 0.3, height * 0.25], [width * 0.7, height * 0.6]], { layers: ["trains"] });
  feats.sort((a, b) => b.properties.c - a.properties.c);
  const live = feats.filter((x) => x.properties.sch !== 1); // not a timetable-only OUIGO
  const f = live.find((x) => x.properties.c === 1 || x.properties.c === 2) || live[0];
  return f ? map.project(f.geometry.coordinates) : null;
});
if (pt) {
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(6000); // pan + tiles under the popup
}
// Headless Chrome can leave the old popup area unpainted: repaint first.
await page.evaluate(() => window.__trainradar.map.triggerRepaint());
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/readme.jpg`, type: "jpeg", quality: 82 });
console.log("README-SHOT-BEGIN");
console.log((await readFile(`${out}/readme.jpg`)).toString("base64"));
console.log("README-SHOT-END");
await browser.close();
