// Browser test of "Use my location" with emulated GPS (demo data):
// nearest stations and boards, permission denied, and "Am I on this train?"
// while following a moving train for ~70 s.
//
//   node tools/feed-check/location-smoke.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await browser.close();
  process.exit(1);
};
const ready = (page) =>
  page.waitForFunction(() => window.__trainradar?.map?.getSource("user") && /\d+ trenes/.test(document.getElementById("stats").textContent));

// 1. Nearby stations and boards (Pinto, on the demo C3 line).
let ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  geolocation: { latitude: 40.2440, longitude: -3.7010, accuracy: 25 },
  permissions: ["geolocation"],
});
let page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await ready(page);
if (await page.evaluate(() => !document.getElementById("near").hidden)) await fail("panel open before tapping");
await page.click("#loc-btn");
await page.waitForFunction(() => document.querySelectorAll("#near-body li").length > 0, null, { timeout: 15000 });
await page.waitForTimeout(1500);
const near = (await page.textContent("#near")).replace(/\s+/g, " ");
console.log("near:", near.slice(0, 600));
if (!/Pinto/.test(near)) await fail("Pinto not listed");
if (!/no se envía/.test(near)) await fail("privacy note missing");
await page.screenshot({ path: `${out}/near.png` });
await page.click("#near-off"); // turn off from inside the panel
if (!(await page.evaluate(() => document.getElementById("near").hidden))) await fail("panel still open after turning off");
if (await page.evaluate(() => window.__trainradar.map.getSource("user")._data.features?.length)) await fail("user dot left on map");
await ctx.close();

// 2. Permission denied: a clear message, the rest keeps working.
ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
page = await ctx.newPage();
await page.goto(url);
await ready(page);
await page.click("#loc-btn");
await page.waitForFunction(() => /denegado/.test(document.getElementById("near-status").textContent), null, { timeout: 15000 });
console.log("denied:", await page.textContent("#near-status"));
await ctx.close();

// 3. Ride along with a Cercanías train for ~70 s.
ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, permissions: ["geolocation"], geolocation: { latitude: 40.3, longitude: -3.71, accuracy: 20 } });
page = await ctx.newPage();
await page.goto(url);
await ready(page);
// Turning location on near Madrid loads the Cercanías timetable there.
await page.click("#loc-btn");
await page.waitForFunction(() => window.__trainradar.ref.loaded.size > 1, null, { timeout: 15000 });
await page.waitForTimeout(1000);
const pick = await page.evaluate(() => {
  const { engine } = window.__trainradar;
  const p = engine.positions(Date.now());
  for (let i = 0; i < p.length / 6; i++) {
    const info = JSON.parse(engine.trainJson(i, Date.now()));
    if (info.feed === "vp_cer" && info.next_stop) return { i, number: info.number };
  }
  return null;
});
if (!pick) await fail("no moving Cercanías train in the demo right now");
const follow = async () => {
  const p = await page.evaluate((i) => {
    const q = window.__trainradar.engine.positions(Date.now());
    return { latitude: q[i * 6 + 1] + 0.0002, longitude: q[i * 6], accuracy: 20 };
  }, pick.i);
  await ctx.setGeolocation(p);
};
await follow();
for (let k = 0; k < 8; k++) {
  await page.waitForTimeout(9000);
  await follow();
}
await page.waitForTimeout(6000);
const onboard = (await page.textContent("#onboard")).replace(/\s+/g, " ");
console.log("onboard:", onboard, "| expected train", pick.number);
await page.screenshot({ path: `${out}/onboard.png` });
if (!onboard.includes(pick.number)) await fail("onboard match not found");
if (errors.length) await fail(errors.join("; "));
console.log("OK");
await browser.close();
