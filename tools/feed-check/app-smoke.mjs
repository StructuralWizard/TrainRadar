// Browser test of the Android app's web bundle (TARGET=android, with the
// demo data and fixture feeds bundled, like the app's test build):
// - free edition: no enthusiast details (track facts, gradient, spacing);
// - favourites: save a train and a station, the 2-item limit, the panel,
//   kept after a reload;
// - links (?train=…) open the train; no coffee link, no service worker;
// - settings: backup export/import; Pro (with a stand-in for Google Play)
//   unlocks the details and unlimited favourites.
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

// Settings: Pro screen (no Play in a browser), backup export and import.
if (await page.isHidden("#about")) await page.click("#about-btn");
await page.click("#settings-btn");
await page.waitForSelector("#pro-state");
const settings = (await page.textContent("#settings")).replace(/\s+/g, " ");
console.log("settings:", settings.slice(0, 160));
if (!settings.includes("versión gratuita")) await fail("Pro state missing");
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#backup-export")]);
const backupPath = `${out}/${download.suggestedFilename()}`;
await download.saveAs(backupPath);
if (!/^trainradar-backup-\d{8}\.json$/.test(download.suggestedFilename())) await fail(`backup named ${download.suggestedFilename()}`);
const { readFile, writeFile } = await import("node:fs/promises");
const saved = JSON.parse(await readFile(backupPath, "utf8"));
if (saved.app !== "trainradar" || saved.favourites.length !== 2) await fail(`backup content ${JSON.stringify(saved).slice(0, 200)}`);
await writeFile(`${out}/bad.json`, '{"app":"other"}');
await page.setInputFiles("#import-file", `${out}/bad.json`);
await page.waitForSelector("#settings-msg");
if (!(await page.textContent("#settings-msg")).includes("no es una copia")) await fail("bad backup accepted");
await page.setInputFiles("#import-file", backupPath);
await page.waitForFunction(() => /Importado: 0/.test(document.getElementById("settings-msg")?.textContent || ""));

// Pro (a stand-in for Google Play): details and unlimited favourites.
const pro = await browser.newContext({ viewport: { width: 390, height: 780 } });
await pro.addInitScript(() => {
  const owned = { pro_monthly: true };
  const product = (id) => ({ id, title: id, owned: !!owned[id], getOffer: () => ({ pricingPhases: [{ price: "1,99 €" }], order: async () => {} }) });
  const when = { approved: () => when, finished: () => when, productUpdated: () => when, receiptUpdated: () => when };
  window.CdvPurchase = {
    ProductType: { PAID_SUBSCRIPTION: "s", CONSUMABLE: "c", NON_CONSUMABLE: "n" },
    Platform: { GOOGLE_PLAY: "g" },
    ErrorCode: {},
    store: {
      register() {}, when: () => when, error() {}, initialize: async () => [], get: product,
      localTransactions: [{ products: [{ id: "pro_monthly" }], isAutoRenewing: true }],
      restorePurchases: async () => {}, manageSubscriptions() {}, update: async () => {},
    },
  };
});
const pp = await pro.newPage();
pp.on("pageerror", (e) => errors.push(e.message));
await pp.goto(url);
await pp.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 });
await pp.fill("#search-q", live[0]);
await pp.waitForSelector("#search-results li button");
await pp.click("#search-results li button");
await pp.waitForSelector(".popup .popup-title");
await pp.waitForFunction(() => /Tren delante|Vía/.test(document.querySelector(".popup")?.textContent || ""), null, { timeout: 8000 })
  .catch(() => fail("Pro didn't unlock the details"));
for (const n of live.slice(0, 3)) {
  await pp.click(".maplibregl-popup-close-button").catch(() => {});
  await pp.fill("#search-q", n);
  await pp.waitForSelector("#search-results li button");
  await pp.click("#search-results li button");
  await pp.click(".popup .fav-btn");
  await pp.waitForSelector('.popup .fav-btn[aria-pressed="true"]', { timeout: 3000 }).catch(() => fail(`Pro couldn't save favourite ${n}`));
}
await pp.click("#about-btn");
await pp.click("#settings-btn");
await pp.waitForSelector("#pro-state.pro-on");
console.log("pro:", await pp.textContent("#pro-state"));

if (errors.length) await fail(`page errors: ${errors.join("; ")}`);
console.log("OK");
await browser.close();
