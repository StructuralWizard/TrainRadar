// Browser test of the Android app's web bundle (TARGET=android, with the
// demo data and fixture feeds bundled, like the app's test build):
// - free edition: no enthusiast details (track facts, gradient, spacing);
// - favourites: save a train and a station, the 2-item limit, the panel,
//   kept after a reload;
// - links (?train=…) open the train; no coffee link, no service worker.
//
//   TARGET=android DIST=dir DATA_DIR=demo/data RT_FIXTURES=demo/rt tools/build-web.sh
//   (cd dir && python3 -m http.server 8090) &
//   node tools/feed-check/app-smoke.mjs http://localhost:8090/ OUT_DIR
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await page.screenshot({ path: `${out}/app-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};
const ready = () => page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 });

await page.goto(url);
await ready();
const live = await page.evaluate(() => {
  const { engine } = window.__trainradar;
  const n = engine.positions(Date.now()).length / 6;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = JSON.parse(engine.trainJson(i, Date.now()));
    if (t.origin && !t.timetable_only) out.push(t.number);
  }
  return out;
});
if (live.length < 3) await fail(`only ${live.length} matched trains`);

async function openTrain(number) {
  await page.fill("#search-q", number);
  await page.waitForSelector("#search-results li button", { timeout: 5000 });
  await page.click("#search-results li button");
  await page.waitForSelector(".popup .popup-title", { timeout: 5000 });
}

// Free edition: the enthusiast rows are gone.
await openTrain(live[0]);
const text = (await page.textContent(".popup")).replace(/\s+/g, " ");
console.log("popup:", text.slice(0, 200));
for (const gone of ["Pendiente", "Vía", "Tren delante", "Tren detrás"]) {
  if (text.includes(gone)) await fail(`free app popup shows "${gone}"`);
}
if (!text.includes("Retraso")) await fail("popup lacks the delay");

// Favourites: save two trains, the third hits the limit.
await page.click(".popup .fav-btn");
await page.waitForSelector('.popup .fav-btn[aria-pressed="true"]');
await page.click(".maplibregl-popup-close-button");
await openTrain(live[1]);
await page.click(".popup .fav-btn");
await page.waitForSelector('.popup .fav-btn[aria-pressed="true"]');
await page.click(".maplibregl-popup-close-button");
await openTrain(live[2]);
await page.click(".popup .fav-btn");
await page.waitForSelector(".popup .fav-full", { timeout: 3000 }).catch(() => fail("no limit message"));
if (await page.$('.popup .fav-btn[aria-pressed="true"]')) await fail("third favourite saved past the limit");
await page.click(".maplibregl-popup-close-button");

// Kept after a reload; the panel lists them and opens one.
await page.reload();
await ready();
await page.click("#fav-btn");
await page.waitForSelector("#favs-body li");
const items = await page.$$eval("#favs-body li", (l) => l.length);
console.log("favourites:", (await page.textContent("#favs-body")).replace(/\s+/g, " "));
if (items !== 2) await fail(`${items} favourites after reload, expected 2`);
await page.click("#favs-body li button.link");
await page.waitForSelector(".popup .popup-title", { timeout: 5000 }).catch(() => fail("favourite didn't open its train"));
if (!(await page.isHidden("#favs"))) await fail("panel still open");
await page.screenshot({ path: `${out}/app-favourite.png` });

// A link opens its train.
await page.goto(`${url}?train=${live[1]}`);
await ready();
await page.waitForSelector(".popup .popup-title", { timeout: 25000 }).catch(() => fail("?train= link didn't open the train"));
const title = await page.textContent(".popup .popup-title");
if (!title.includes(live[1].replace(/^0+/, ""))) await fail(`link opened ${title}`);

// About: no coffee link in the app.
await page.click("#about-btn");
if ((await page.textContent("#about")).includes("café")) await fail("coffee link in the app");
const sw = await page.evaluate(() => navigator.serviceWorker?.getRegistrations().then((r) => r.length) ?? 0);
if (sw) await fail("service worker registered in the app bundle");

if (errors.length) await fail(`page errors: ${errors.join("; ")}`);
console.log("OK");
await browser.close();
