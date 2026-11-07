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
// …and for the app's own plugin (alerts, widget), recording its calls.
await pro.addInitScript(() => {
  const calls = [];
  window.__nativeCalls = calls;
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      TrainRadar: {
        setAlerts: async (o) => calls.push(["setAlerts", o]),
        requestNotifications: async () => (calls.push(["requestNotifications"]), { granted: true }),
        notify: async (o) => calls.push(["notify", o]),
        refreshWidget: async () => calls.push(["refreshWidget"]),
      },
    },
  };
});
const pp = await pro.newPage();
// The history API (absent from the static bundle): made-up days.
await pp.route("**/v1/history/**", (route) => {
  const u = new URL(route.request().url());
  const n = Number(u.searchParams.get("days")) || 7;
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - i) * 86_400_000).toISOString().slice(0, 10));
  const kind = u.pathname.split("/")[3];
  const products = ["CERCANIAS", "AVE", "ALVIA", "MD", "AVLO", "AVANT", "REGIONAL", "INTERCITY"];
  const body = kind === "train"
    ? { runs: dates.map((date, i) => ({ date, arr_delay_min: i % 9, cancelled: false })) }
    : { days: dates.flatMap((date) => products.map((product) => ({ date, product, trips: 20, on_time: 17, late_5: 3, late_15: 1, cancelled: 0, median_delay: 2 }))) };
  route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
});
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
// Pro history: 30 days unlocked.
await pp.click("#history-open").catch(() => fail("no history link in the Pro popup"));
await pp.waitForSelector("#history-body .history-chart rect");
await pp.click("#history-body button:text-is('30 días')");
await pp.waitForFunction(() => document.querySelectorAll("#history-body .history-chart rect").length === 30, null, { timeout: 5000 })
  .catch(() => fail("Pro didn't get 30 days of history"));
await pp.click("#history-close");
if (!(await pp.$(".popup .trip-btn"))) {
  await pp.fill("#search-q", live[2]);
  await pp.waitForSelector("#search-results li button");
  await pp.click("#search-results li button");
  await pp.waitForSelector(".popup .trip-btn");
}

// My trips: log the open train, stop it, claim summary, CSV and image.
await pp.click(".popup .trip-btn");
await pp.waitForSelector('.popup .trip-btn[aria-pressed="true"]', { timeout: 3000 }).catch(() => fail("trip not logged"));
await pp.click(".popup .trip-btn"); // stop: the trip ends
await pp.waitForSelector('.popup .trip-btn[aria-pressed="false"]');
await pp.click(".maplibregl-popup-close-button");
await pp.click("#about-btn");
await pp.click("#settings-btn");
await pp.waitForSelector("#pro-state.pro-on");
console.log("pro:", await pp.textContent("#pro-state"));
// Delay alerts: on → permission asked, background check scheduled, config
// stored for it; favourites refreshed the widget.
await pp.click("#alerts-btn");
await pp.waitForSelector('#alerts-btn[aria-pressed="true"]', { timeout: 3000 }).catch(() => fail("alerts didn't turn on"));
const native = await pp.evaluate(() => ({ calls: window.__nativeCalls.map((c) => c[0]), cfg: JSON.parse(localStorage.getItem("alert-config") || "{}") }));
console.log("native:", JSON.stringify(native));
if (!native.calls.includes("requestNotifications") || !native.calls.includes("setAlerts")) await fail("alerts not scheduled");
if (!native.calls.includes("refreshWidget")) await fail("saving a favourite didn't refresh the widget");
if (native.cfg.enabled !== true || native.cfg.minor !== 5 || native.cfg.major !== 15) await fail(`alert config ${JSON.stringify(native.cfg)}`);
await pp.click("#trips-btn");
await pp.waitForSelector(".trips-list li");
console.log("trips:", (await pp.textContent("#trips-body")).replace(/\s+/g, " ").slice(0, 200));
await pp.click(".trips-list li button:text-is('Reclamar')");
await pp.waitForSelector("#claim-text");
const claim = await pp.textContent("#claim-text");
if (!/^Tren .+ Llegada prevista/.test(claim)) await fail(`claim text: ${claim}`);
if (!(await pp.$('a[href="https://www.renfe.com/es/es/ayuda/compromiso-puntualidad"]'))) await fail("no link to Renfe's punctuality commitment");
const [csv] = await Promise.all([pp.waitForEvent("download"), pp.click("#trips-csv")]);
await csv.saveAs(`${out}/trips.csv`);
const csvText = await readFile(`${out}/trips.csv`, "utf8");
if (csvText.trim().split("\n").length !== 2) await fail(`trips CSV: ${csvText}`);
const [png] = await Promise.all([pp.waitForEvent("download"), pp.click(".trips-list li button:text-is('Imagen')")]);
if (!png.suggestedFilename().endsWith(".png")) await fail(`card named ${png.suggestedFilename()}`);
await png.saveAs(`${out}/trip-card.png`);
await pp.screenshot({ path: `${out}/app-trips.png` });

// Commute mode: a saved commute opens on its next trains at start.
const pair = await pp.evaluate(() => {
  const { engine } = window.__trainradar;
  const st = JSON.parse(engine.stationsGeoJson()).features.map((f) => ({ id: f.properties.id, name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  for (const a of st) for (const b of st) if (a.id !== b.id && JSON.parse(engine.commuteJson(a.id, b.id, Date.now(), 3 * 3600, 8)).length) return { from: a, to: b };
  return null;
});
if (!pair) await fail("no commute in the demo data");
await pp.evaluate((c) => localStorage.setItem("commute", JSON.stringify(c)), pair);
await pp.reload();
await pp.waitForSelector("#commute:not([hidden]) #commute-body li", { timeout: 30000 }).catch(() => fail("commute didn't open at start"));
console.log("commute:", (await pp.textContent("#commute-body")).replace(/\s+/g, " ").slice(0, 160));
await pp.screenshot({ path: `${out}/app-commute.png` });

// Several commutes (Pro): tabs, the last used one opens, switching works.
const back = { from: pair.to, to: pair.from };
await pp.evaluate((s) => localStorage.setItem("commute", JSON.stringify(s)), { v: 2, list: [pair, back], active: 1, draft: null });
await pp.reload();
await pp.waitForSelector("#commute:not([hidden]) .commute-tabs button", { timeout: 30000 }).catch(() => fail("commute tabs didn't show"));
const tabs = await pp.$$eval(".commute-tabs button", (b) => b.map((x) => [x.textContent, x.getAttribute("aria-pressed")]));
if (tabs.length !== 2 || tabs[1][1] !== "true") await fail(`commute tabs: ${JSON.stringify(tabs)}`);
await pp.click(".commute-tabs button >> nth=0");
await pp.waitForFunction((name) => document.querySelector("#commute-body strong")?.textContent.startsWith(name), pair.from.name, { timeout: 5000 }).catch(() => fail("switching commute didn't change the board"));
const savedActive = await pp.evaluate(() => JSON.parse(localStorage.getItem("commute")).active);
if (savedActive !== 0) await fail(`active commute not saved: ${savedActive}`);
console.log("commutes:", tabs.map((t) => t[0]).join(" | "));
await pp.screenshot({ path: `${out}/app-commutes.png` });

// Delays list (Pro): "All" or one commute's trains only, remembered.
await pp.click("#commute-close");
await pp.click("#delayed-btn");
await pp.waitForSelector("#delayed-filter:not([hidden]) button", { timeout: 5000 }).catch(() => fail("delays filter didn't show"));
const chips = await pp.$$eval("#delayed-filter button", (b) => b.map((x) => x.textContent));
if (chips.length !== 3 || chips[0] !== "Todos") await fail(`delays filter: ${JSON.stringify(chips)}`);
const allLate = await pp.$$eval("#delayed-list li", (l) => l.map((x) => x.textContent));
await pp.click("#delayed-filter button >> nth=1");
const onlyLate = await pp.$$eval("#delayed-list li", (l) => l.map((x) => x.textContent));
if (!onlyLate.length || !onlyLate.every((x) => allLate.includes(x) || /Ningún tren de/.test(x))) await fail(`commute delays: ${JSON.stringify(onlyLate)}`);
if ((await pp.evaluate(() => localStorage.getItem("delayed-filter"))) !== `${pair.from.id}>${pair.to.id}`) await fail("delays filter not remembered");
console.log("delays:", allLate.length, "all,", onlyLate.length, "on", chips[1]);
await pp.screenshot({ path: `${out}/app-delays-commute.png` });
await pp.click("#delayed-filter button >> nth=0");
await pp.click("#delayed-close");

// Notices (Pro): "All" or one commute's notices only, remembered.
await pp.click("#inc-btn");
await pp.waitForSelector("#inc-commutes button", { timeout: 5000 }).catch(() => fail("notices filter didn't show"));
const allNotices = await pp.$$eval("#inc-body ul.incidents > li", (l) => l.length);
await pp.click("#inc-commutes button >> nth=1");
const commuteNotices = await pp.$$eval("#inc-body ul.incidents > li", (l) => l.length);
const noneMsg = await pp.$$eval("#inc-body p.muted", (p) => p.some((x) => /Ningún aviso de Renfe en/.test(x.textContent)));
if (commuteNotices > allNotices || (!commuteNotices && !noneMsg)) await fail(`commute notices: ${commuteNotices} of ${allNotices}`);
await pp.click("#inc-close");
await pp.click("#inc-btn");
const pressed = await pp.$eval("#inc-commutes button >> nth=1", (b) => b.getAttribute("aria-pressed")).catch(() => null);
if (pressed !== "true") await fail("notices filter not remembered");
console.log("notices:", allNotices, "all,", commuteNotices, "on the commute");
await pp.click("#inc-commutes button >> nth=0");

if (errors.length) await fail(`page errors: ${errors.join("; ")}`);
console.log("OK");
await browser.close();
