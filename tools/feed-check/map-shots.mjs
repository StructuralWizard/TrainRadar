// Map legibility screenshots on a Pixel 7: all of Spain, Madrid at zoom 11
// and at zoom 14, with the home sheet tucked away so the map shows.
//
//   node tools/feed-check/map-shots.mjs http://localhost:8080/ OUT_DIR PREFIX
import { chromium, devices } from "playwright";

const [url, out = ".", prefix = "map"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["Pixel 7"] });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem("home-hidden", "1"));
await page.goto(url);
await page.waitForFunction(() => window.__trainradar?.map?.getLayer("track-av"), null, { timeout: 30000 });
await page.waitForFunction(() => window.__trainradar.engine.positions(Date.now()).length > 0, null, { timeout: 30000 });
const views = [
  ["spain", [-3.7, 40.0], 5.2],
  ["madrid-z11", [-3.69, 40.33], 11],
  ["madrid-z14", [-3.6895, 40.4065], 14],
];
for (const [name, center, zoom] of views) {
  await page.evaluate(([c, z]) => window.__trainradar.map.jumpTo({ center: c, zoom: z }), [center, zoom]);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png` });
  console.log("shot", `${prefix}-${name}.png`);
}
if (errors.length) console.error("page errors:", errors);
await browser.close();
