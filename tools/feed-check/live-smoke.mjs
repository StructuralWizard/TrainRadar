// Browser test of phase C2 on demo data:
// - live mode: the app reads rt/status.json every 10 s and downloads a feed
//   only when its Last-Modified changes (the fixtures don't change, so each
//   feed is downloaded once);
// - the About panel (legal pages, data source; no coffee link without a URL);
// - the "get the app" banner: from the 3rd visit, once, until dismissed.
//   Needs the dev server started with TEST_PLAY_URL set.
//
//   TEST_PLAY_URL=https://play.example/app DATA=… FIXTURES=… node tools/dev-server.mjs &
//   node tools/feed-check/live-smoke.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const requests = [];
page.on("request", (r) => requests.push(new URL(r.url()).pathname));
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await page.screenshot({ path: `${out}/live-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};

// Visits 1 and 2: no banner.
for (const visit of [1, 2]) {
  await page.goto(url);
  await page.waitForFunction(() => window.__trainradar?.engine, null, { timeout: 30000 });
  if (await page.isVisible("#app-banner")) await fail(`banner on visit ${visit}`);
}

// Visit 3: live mode and banner.
requests.length = 0;
await page.goto(url);
await page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 });
await page.waitForTimeout(25_000); // two or three status.json reads
const count = (p) => requests.filter((r) => r === p).length;
console.log("requests in 25 s:", { status: count("/rt/status.json"), vp: count("/rt/vehicle_positions.pb"), vpLd: count("/rt/vehicle_positions_LD.pb") });
if (count("/rt/status.json") < 2) await fail("status.json isn't polled");
if (count("/rt/vehicle_positions.pb") !== 1) await fail("an unchanged feed was downloaded more than once");
const mode = await page.evaluate(() => window.__trainradar.feeds.mode());
if (mode !== "live") await fail(`feed mode ${mode}, expected live`);

if (!(await page.isVisible("#app-banner"))) await fail("no app banner on visit 3");
const href = await page.getAttribute("#app-banner-link", "href");
if (!href?.startsWith("https://play.example")) await fail(`banner links to ${href}`);
await page.click("#app-banner-close");
await page.reload();
await page.waitForFunction(() => window.__trainradar?.engine, null, { timeout: 30000 });
if (await page.isVisible("#app-banner")) await fail("banner back after dismissing");

// About panel.
await page.click("#tab-more");
await page.click("#more-about");
await page.waitForSelector("#about-body a[href='legal/privacy.html']");
const about = (await page.textContent("#about")).replace(/\s+/g, " ");
console.log("about:", about.slice(0, 300));
for (const want of ["Privacidad", "Términos de uso", "Aviso legal", "Licencias y atribución", "servidor central", "Consigue la app"]) {
  if (!about.includes(want)) await fail(`about lacks "${want}"`);
}
if (about.includes("café")) await fail("coffee link shown without a URL");
await page.screenshot({ path: `${out}/about.png` });

// A legal page loads (static, no scripts).
const legal = await context.newPage();
const r = await legal.goto(new URL("legal/licences.html", url).href);
if (!r.ok() || !(await legal.textContent("body")).includes("CC BY 4.0")) await fail("legal page");

if (errors.length) await fail(`page errors: ${errors.join("; ")}`);
console.log("OK");
await browser.close();
