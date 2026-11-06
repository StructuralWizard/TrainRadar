// Google Play graphics (phase C6): six phone screenshots (1080 × 1920) of the
// app bundle and the feature graphic (1024 × 500). Run by the "Store assets"
// workflow on the live data; locally on the demo bundle to check the script.
//
//   (cd app/www && python3 -m http.server 8080) &
//   node tools/feed-check/store-shots.mjs http://localhost:8080/ OUT_DIR
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const phone = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, locale: "es-ES", timezoneId: "Europe/Madrid" };

/** A stand-in for Google Play (Pro `owned` or not) so the screens show
 * prices and Pro features without a Play account. */
const playStandIn = (owned) => {
  const product = (id) => ({ id, title: id, owned: owned && id === "pro_monthly", getOffer: () => ({ pricingPhases: [{ price: id === "pro_monthly" || id === "tip_small" ? "1,99 €" : id === "tip_medium" ? "4,99 €" : "9,99 €" }], order: async () => {} }) });
  const when = { approved: () => when, finished: () => when, productUpdated: () => when, receiptUpdated: () => when };
  window.CdvPurchase = {
    ProductType: { PAID_SUBSCRIPTION: "s", CONSUMABLE: "c", NON_CONSUMABLE: "n" },
    Platform: { GOOGLE_PLAY: "g" },
    ErrorCode: {},
    store: { register() {}, when: () => when, error() {}, initialize: async () => [], get: product, localTransactions: owned ? [{ products: [{ id: "pro_monthly" }], isAutoRenewing: true }] : [], restorePurchases: async () => {}, manageSubscriptions() {}, update: async () => {} },
  };
};

async function open(owned) {
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(playStandIn, owned);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  return page;
}

/** A busy, live AV/LD/MD or Cercanías train, preferably a bit late. */
const pickTrain = (page) =>
  page.evaluate(() => {
    const { engine } = window.__trainradar;
    const n = engine.positions(Date.now()).length / 6;
    let best = null;
    for (let i = 0; i < n; i++) {
      const t = JSON.parse(engine.trainJson(i, Date.now()));
      if (!t.origin || t.timetable_only || !t.next_stop) continue;
      const score = (t.delay > 300 && t.delay < 1800 ? 2 : 0) + (t.history_product !== "CERCANIAS" ? 1 : 0);
      if (!best || score > best.score) best = { score, number: t.number, lon: t.lon, lat: t.lat };
    }
    return best;
  });

async function openTrain(page, number) {
  await page.fill("#search-q", number);
  await page.waitForSelector("#search-results li button");
  await page.click(`#search-results li button:has-text("${number}")`);
  await page.waitForSelector(".popup .popup-title");
  await page.waitForTimeout(2500); // fly, tiles, history teaser
}

const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

// 1. The map around Madrid, free edition.
const free = await open(false);
await free.evaluate(() => window.__trainradar.map.jumpTo({ center: [-3.69, 40.42], zoom: 10.5 }));
await free.waitForTimeout(4000);
await shot(free, "phone-1-map");

// 2. A train (Pro: with track details and spacing).
const pro = await open(true);
const train = await pickTrain(pro);
if (!train) throw new Error("no train to show");
await openTrain(pro, train.number);
await shot(pro, "phone-2-train");

// 3. Its history (Pro: 30 days).
if (await pro.$("#history-open")) {
  await pro.click("#history-open");
  await pro.click("#history-body button:text-is('30 días')").catch(() => {});
  await pro.waitForTimeout(2500);
  await shot(pro, "phone-3-history");
  await pro.click("#history-close");
}

// 4. A station board.
const station = await free.evaluate(() => {
  const { engine, map } = window.__trainradar;
  const f = JSON.parse(engine.stationsGeoJson()).features.find((x) => /Atocha|Chamart|Sants|Santa Justa/.test(x.properties.name)) || JSON.parse(engine.stationsGeoJson()).features[0];
  map.jumpTo({ center: f.geometry.coordinates, zoom: 13 });
  return f.properties.id;
});
await free.waitForTimeout(3000);
await free.goto(`${url}?station=${encodeURIComponent(station)}`);
await free.waitForSelector(".maplibregl-popup", { timeout: 40000 }).catch(() => {});
await free.waitForTimeout(3000);
await shot(free, "phone-4-station");

// 5. Favourites with live delays (Pro).
await pro.click(".maplibregl-popup-close-button").catch(() => {});
const numbers = await pro.evaluate(() => {
  const { engine } = window.__trainradar;
  const n = engine.positions(Date.now()).length / 6;
  const out = [];
  for (let i = 0; i < n && out.length < 4; i++) {
    const t = JSON.parse(engine.trainJson(i, Date.now()));
    if (t.origin && !t.timetable_only && t.delay !== null) out.push(t.number);
  }
  return out;
});
for (const n of numbers) {
  await openTrain(pro, n);
  await pro.click(".popup .fav-btn").catch(() => {});
  await pro.click(".maplibregl-popup-close-button").catch(() => {});
}
await pro.click("#fav-btn");
await pro.waitForTimeout(1000);
await shot(pro, "phone-5-favourites");
await pro.click("#favs-close");

// 6. The Pro screen with its price (free edition).
await free.click(".maplibregl-popup-close-button").catch(() => {});
await free.click("#about-btn");
await free.click("#settings-btn");
await free.waitForTimeout(1500);
await shot(free, "phone-6-pro");

// Feature graphic: icon, name and line on the app's blue. The map pages
// are closed first: on CI their rendering starves the capture.
await free.context().close();
await pro.context().close();
const icon = (await readFile(new URL("../../web/icons/icon-512.png", import.meta.url))).toString("base64");
const g = await (await browser.newContext({ viewport: { width: 1024, height: 500 } })).newPage();
await g.setContent(`<!doctype html><html><body style="margin:0;width:1024px;height:500px;background:#1d4ed8;font-family:system-ui,sans-serif;display:flex;align-items:center;gap:48px;padding:0 72px;box-sizing:border-box;color:#fff">
<img src="data:image/png;base64,${icon}" width="280" height="280" style="border-radius:56px;background:#fff">
<div><div style="font-size:84px;font-weight:800;letter-spacing:-1px">TrainRadar</div>
<div style="font-size:36px;margin-top:12px;opacity:.95;white-space:nowrap;line-height:1.3">Los trenes de España en directo,<br>coloreados por su retraso</div></div></body></html>`);
for (let i = 0; ; i++) {
  try {
    await g.screenshot({ path: `${out}/feature-graphic.png` });
    break;
  } catch (e) {
    if (i >= 2) throw e;
    await g.waitForTimeout(2000);
  }
}

await browser.close();
console.log("OK");
