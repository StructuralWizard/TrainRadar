// Browser test on demo data of the map tools: train search, station popup,
// layer switches, base map switch, and dragging a popup out of the way.
//
//   node tools/feed-check/features-smoke.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await page.screenshot({ path: `${out}/features-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};

await page.goto(url);
await page.waitForFunction(() => window.__trainradar?.map?.getLayer("track"), null, { timeout: 30000 });
await page.waitForFunction(() => window.__trainradar.engine.positions(Date.now()).length > 0, null, { timeout: 30000 });

// Search by train number: pick a live train's number, type it, choose it.
const number = await page.evaluate(() => {
  const { engine } = window.__trainradar;
  return JSON.parse(engine.trainJson(0, Date.now())).number;
});
await page.fill("#search-q", number);
await page.waitForSelector("#search-results li button", { timeout: 5000 }).catch(() => fail("no search results"));
console.log("search:", number, "→", (await page.textContent("#search-results")).replace(/\s+/g, " "));
await page.click("#search-results li button");
await page.waitForSelector(".popup", { timeout: 5000 }).catch(() => fail("search didn't open the train"));
const title = await page.textContent(".popup .popup-title");
if (!title.includes(number)) await fail(`popup shows ${title}, not ${number}`);
const popupText = (await page.textContent(".popup")).replace(/\s+/g, " ");
for (const want of ["Posición: GPS de Renfe", "tiempo real"]) {
  if (!popupText.includes(want)) await fail(`popup lacks "${want}"`);
}

// Drag the popup by its title: it moves and loses its pointer.
const box = await page.locator(".maplibregl-popup").boundingBox();
const tb = await page.locator(".popup .popup-title").boundingBox();
await page.mouse.move(tb.x + 10, tb.y + 5);
await page.mouse.down();
await page.mouse.move(tb.x + 10, tb.y + 205, { steps: 5 });
await page.mouse.up();
const moved = await page.locator(".maplibregl-popup").boundingBox();
console.log("popup y:", Math.round(box.y), "→", Math.round(moved.y));
if (moved.y - box.y < 150) await fail("popup didn't move when dragged");
if (!(await page.$(".maplibregl-popup.dragged"))) await fail("dragged popup still has its pointer");
await page.screenshot({ path: `${out}/dragged.png` });
await page.click(".maplibregl-popup-close-button");

// Station popup: click a C3 station square that no train or notice marker
// covers right now (trains and notices take the tap first, by design).
const pt = await page.evaluate(async () => {
  const { map } = window.__trainradar;
  const stops = [[-3.7110, 40.3460], [-3.7186, 40.3115], [-3.6763, 40.1905], [-3.6157, 40.0358]];
  for (const c of stops) {
    map.jumpTo({ center: c, zoom: 13 });
    await new Promise((r) => setTimeout(r, 1200));
    const p = map.project(c);
    const box = [[p.x - 16, p.y - 16], [p.x + 16, p.y + 16]];
    if (!map.queryRenderedFeatures(box, { layers: ["trains", "incidents"] }).length) return p;
  }
  return null;
});
if (!pt) await fail("every C3 station had a train on it");
await page.mouse.click(pt.x, pt.y);
await page.waitForFunction(() => /Próximas salidas/.test(document.querySelector(".maplibregl-popup")?.textContent || ""), null, { timeout: 5000 })
  .catch(() => fail("station popup didn't open"));
console.log("station:", (await page.textContent(".maplibregl-popup")).replace(/\s+/g, " ").slice(0, 200));
await page.screenshot({ path: `${out}/station.png` });

// Layer switches hide and show their layers; the satellite choice adds imagery.
await page.click("#layers summary");
for (const [box, layer] of [["#f-track", "track"], ["#f-stations", "stations"], ["#f-stopped", "stopped-ring"]]) {
  await page.uncheck(box);
  const v = await page.evaluate((l) => window.__trainradar.map.getLayoutProperty(l, "visibility"), layer);
  if (v !== "none") await fail(`${layer} still visible`);
  await page.check(box);
}
// Notice kinds: the demo's Pinto marker is a works notice.
const markers = () => page.evaluate(() => window.__trainradar.map.getSource("incidents").serialize().data.features.length);
if ((await markers()) < 1) await fail("no notice marker");
await page.uncheck("#f-k-works");
if ((await markers()) !== 0) await fail("works notices still on the map");
await page.check("#f-k-works");
// Train types: hiding high speed removes the AVE trains.
const count = () => page.evaluate(() => window.__trainradar.map.getSource("trains").serialize().data.features.length);
const before = await count();
await page.uncheck("#f-av");
await page.waitForTimeout(1500);
const after = await count();
console.log("trains with / without AV:", before, after);
if (!(after < before)) await fail("hiding AV didn't hide any train");
await page.check("#f-av");
await page.check('input[name="basemap"][value="satellite"]');
const sat = await page.evaluate(() => window.__trainradar.map.getLayoutProperty("satellite", "visibility"));
if (sat !== "visible") await fail("satellite layer not shown");
await page.check('input[name="basemap"][value="standard"]');

if (errors.length) await fail(`page errors: ${errors.join("; ")}`);
console.log("OK");
await browser.close();
