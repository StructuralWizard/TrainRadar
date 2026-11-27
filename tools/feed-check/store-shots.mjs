// Google Play graphics (docs/design/ui-redesign/PLAN.md, step 10): eight
// phone screenshots of the app, each captured at 1080 × 2340 and framed
// with a short headline (1080 × 1920: Play takes at most 2:1), in Spanish
// and English, and the feature graphic (1024 × 500: the live map and the
// logo). Run by the "Store assets" workflow on the live data; locally on
// the demo bundle to check the script.
//
//   (cd app/www && python3 -m http.server 8080) &
//   node tools/feed-check/store-shots.mjs http://localhost:8080/ OUT_DIR
//
// OUT_DIR/raw/<lang>-<n>-<name>.png are the captures; OUT_DIR/<lang>/<n>-<name>.png
// the framed images to upload (es: es-ES listing, en: en-GB).
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
// 360 × 780 CSS px at 3× = 1080 × 2340.
const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, timezoneId: "Europe/Madrid" };

/** A stand-in for Google Play (Pro `owned` or not) so the screens show
 * prices and Pro features without a Play account. */
const playStandIn = (owned) => {
  const product = (id) => ({ id, title: id, owned: owned && id === "pro_yearly", getOffer: () => ({ pricingPhases: [{ price: id === "pro_yearly" || id === "tip_small" ? "1,99 €" : id === "tip_medium" ? "4,99 €" : "9,99 €" }], order: async () => {} }) });
  const when = { approved: () => when, finished: () => when, productUpdated: () => when, receiptUpdated: () => when };
  window.CdvPurchase = {
    ProductType: { PAID_SUBSCRIPTION: "s", CONSUMABLE: "c", NON_CONSUMABLE: "n" },
    Platform: { GOOGLE_PLAY: "g" },
    ErrorCode: {},
    store: { register() {}, when: () => when, error() {}, initialize: async () => [], get: product, localTransactions: owned ? [{ products: [{ id: "pro_yearly" }], isAutoRenewing: true }] : [], restorePurchases: async () => {}, manageSubscriptions() {}, update: async () => {} },
  };
};

/** The headline (5–7 words), a line under it and the frame's colour. */
const FRAMES = {
  es: [
    ["map", "¿Llega tu tren a su hora?", "Los trenes en directo, coloreados por su retraso.", "#1d4ed8"],
    ["train", "Sigue tu tren parada a parada", "Retraso, próxima parada y dónde va ahora.", "#0f172a"],
    ["station", "Salidas y llegadas de cada estación", "Ahora, hoy o mañana, con su retraso.", "#15803d"],
    ["notices", "Obras, huelgas e incidencias en el mapa", "Los avisos de los operadores, por línea y estación.", "#b45309"],
    ["pro", "Avisos cuando tu tren se retrasa", "TrainRadar Pro: alertas, widget y tu trayecto habitual.", "#b91c1c"],
    ["uk", "Reino Unido y 23 países más", "Un toque cambia de país.", "#1d4ed8"],
    ["dark", "Modo oscuro para el andén de noche", "Se adapta al tema de tu móvil.", "#020617"],
    ["about", "Sin cuenta, sin anuncios, sin rastreo", "Tus favoritos se quedan en tu móvil. Código abierto.", "#0f172a"],
  ],
  en: [
    ["map", "Is your train on time?", "Live trains, coloured by their delay.", "#1d4ed8"],
    ["train", "Follow your train stop by stop", "Delay, next stop and where it is now.", "#0f172a"],
    ["station", "Departures and arrivals at every station", "Now, today or tomorrow, with delays.", "#15803d"],
    ["notices", "Works, strikes and disruptions, mapped", "Operators' notices by line and station.", "#b45309"],
    ["pro", "Alerts when your train runs late", "TrainRadar Pro: alerts, widget and your commute.", "#b91c1c"],
    ["uk", "The UK and 23 more countries", "One tap switches country.", "#1d4ed8"],
    ["dark", "Dark mode for late platforms", "Follows your phone's theme.", "#020617"],
    ["about", "No account, no ads, no tracking", "Your favourites stay on your phone. Open source.", "#0f172a"],
  ],
};

async function open(lang, { owned = false, dark = false, path = "" } = {}) {
  const ctx = await browser.newContext({ ...PHONE, locale: lang === "es" ? "es-ES" : "en-GB", colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript(playStandIn, owned);
  await ctx.addInitScript((l) => localStorage.setItem("lang", l), lang);
  const page = await ctx.newPage();
  await page.goto(url + path);
  await page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  return page;
}

/** A busy, live train, preferably a bit late and long distance. */
const pickTrain = (page) =>
  page.evaluate(() => {
    const { engine } = window.__trainradar;
    const n = engine.positions(Date.now()).length / 6;
    let best = null;
    for (let i = 0; i < n; i++) {
      const t = JSON.parse(engine.trainJson(i, Date.now()));
      if (!t.origin || t.timetable_only || !t.next_stop || t.next_stop === t.destination) continue;
      const score = (t.delay > 300 && t.delay < 1800 ? 2 : 0) + (t.history_product !== "CERCANIAS" ? 1 : 0) + (t.ahead ? 1 : 0);
      if (!best || score > best.score) best = { score, number: t.number };
    }
    return best;
  });

async function openTrain(page, number) {
  await page.fill("#search-q", number);
  await page.waitForSelector("#search-results li button");
  await page.click(`#search-results li button:has-text("${number.replace(/^0+/, "")}")`);
  await page.waitForSelector("#detail:not([hidden]) .sheet-train");
  await page.waitForTimeout(2500); // fly, tiles, history teaser
}

/** Raise the open sheet to about two thirds of the screen (or `vh`). */
const raise = (page, id = "detail", vh = 64) => page.evaluate(([x, h]) => (document.getElementById(x).style.height = `${h}vh`), [id, vh]);

await mkdir(`${out}/raw`, { recursive: true });
const raw = (lang, i, name) => `${out}/raw/${lang}-${i + 1}-${name}.png`;

for (const lang of ["es", "en"]) {
  const shot = (page, i) => page.screenshot({ path: raw(lang, i, FRAMES[lang][i][0]) });

  // 1. The map around Madrid.
  const free = await open(lang);
  await free.evaluate(() => window.__trainradar.map.jumpTo({ center: [-3.69, 40.42], zoom: 10.5 }));
  await free.waitForTimeout(4000);
  await shot(free, 0);

  // 2. A train's detail.
  const train = await pickTrain(free);
  if (!train) throw new Error("no train to show");
  await openTrain(free, train.number);
  await raise(free);
  await free.waitForTimeout(800);
  await shot(free, 1);
  await free.click("#detail-close").catch(() => {});

  // 3. A big station's departures.
  const station = await free.evaluate(() => {
    const f = JSON.parse(window.__trainradar.engine.stationsGeoJson()).features;
    return (f.find((x) => /Atocha|Chamart|Sants|Santa Justa/.test(x.properties.name)) || f[0]).properties.id;
  });
  await free.goto(`${url}?station=${encodeURIComponent(station)}`);
  await free.waitForSelector("#detail:not([hidden]) .sheet-station", { timeout: 40000 }).catch(() => {});
  await free.waitForTimeout(2500);
  await raise(free, "detail", 78);
  await free.waitForTimeout(800);
  await shot(free, 2);

  // 4. Notices.
  await free.click("#tab-incidents");
  await free.waitForTimeout(1500);
  await shot(free, 3);

  // 5. TrainRadar Pro, with its price.
  await free.click("#tab-more");
  await free.click("#more-settings").catch(async () => {
    await free.click("#more-about");
    await free.click("#settings-btn");
  });
  await free.waitForTimeout(1500);
  await shot(free, 4);
  await free.context().close();

  // 6. The UK.
  const uk = await open(lang, { path: "?country=uk" });
  await uk.waitForTimeout(3000);
  await shot(uk, 5);
  await uk.context().close();

  // 7. Dark mode: a train's detail over the map.
  const dark = await open(lang, { dark: true });
  const t2 = await pickTrain(dark);
  if (t2) {
    await openTrain(dark, t2.number);
    await raise(dark);
    await dark.waitForTimeout(800);
  }
  await shot(dark, 6);
  await dark.context().close();

  // 8. About: no account, no ads.
  const about = await open(lang);
  await about.click("#tab-more");
  await about.click("#more-about");
  await about.waitForTimeout(1200);
  await raise(about, "about");
  await about.waitForTimeout(600);
  await shot(about, 7);
  await about.context().close();
}

// Framing: the headline and a line under it on the frame's colour, the
// whole capture below it in a phone outline.
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
const fontCss = await readFile(new URL("../../web/vendor/inter/inter-latin-wght-normal.woff2", import.meta.url))
  .then((b) => `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${b.toString("base64")}) format("woff2");font-weight:100 900}`)
  .catch(() => "");
for (const lang of ["es", "en"]) {
  await mkdir(`${out}/${lang}`, { recursive: true });
  for (const [i, [name, head, sub, bg]] of FRAMES[lang].entries()) {
    const img = (await readFile(raw(lang, i, name))).toString("base64");
    await page.setContent(`<!doctype html><html><head><style>${fontCss}
      body{margin:0;width:1080px;height:1920px;overflow:hidden;background:${bg};color:#fff;font-family:Inter,system-ui,sans-serif}
      h1{margin:0;padding:120px 96px 0;font-size:84px;line-height:1.08;font-weight:800;letter-spacing:-1.5px}
      p{margin:28px 96px 0;font-size:40px;line-height:1.3;opacity:.88}
      .phone{position:absolute;left:236px;top:520px;width:608px;border-radius:64px;background:#0b1220;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
      .phone img{display:block;width:100%;border-radius:46px}
    </style></head><body><h1>${head}</h1><p>${sub}</p><div class="phone"><img src="data:image/png;base64,${img}"></div></body></html>`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/${lang}/${i + 1}-${name}.png` });
  }
}

// Feature graphic: the live map of Spain with its trains, the logo and the
// name over it.
const map = await (await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1, timezoneId: "Europe/Madrid", locale: "es-ES" })).newPage();
await map.goto(url);
await map.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 60000 });
await map.evaluate(() => {
  for (const s of document.querySelectorAll(".sheet, .tabbar, .controls, .fabs, .maplibregl-control-container, .panel-bg, .panel-brand, .legend, .delayed-show")) s.style.display = "none";
  document.getElementById("map").style.left = "0";
  window.__trainradar.map.resize();
  window.__trainradar.map.jumpTo({ center: [-1.2, 40.0], zoom: 5.3 });
});
await map.waitForTimeout(5000);
const mapShot = (await map.screenshot()).toString("base64");
await map.context().close();
const icon = (await readFile(new URL("../../web/icons/icon-512.png", import.meta.url))).toString("base64");
const g = await (await browser.newContext({ viewport: { width: 1024, height: 500 } })).newPage();
// One per listing: es-ES (feature-graphic.png) and en-GB (feature-graphic-en.png).
for (const [file, line] of [["feature-graphic.png", "Trenes en directo, coloreados<br>por su retraso"], ["feature-graphic-en.png", "Live trains, coloured<br>by their delay"]]) {
  await g.setContent(`<!doctype html><html><head><style>${fontCss}</style></head><body style="margin:0;width:1024px;height:500px;overflow:hidden;font-family:Inter,system-ui,sans-serif;position:relative">
<img src="data:image/png;base64,${mapShot}" style="position:absolute;inset:0;width:1024px;height:500px">
<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(15,23,42,.92) 0,rgba(15,23,42,.75) 42%,rgba(15,23,42,0) 70%)"></div>
<div style="position:absolute;left:64px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:22px;color:#fff">
<div style="display:flex;align-items:center;gap:22px"><img src="data:image/png;base64,${icon}" width="104" height="104" style="border-radius:24px;background:#fff"><span style="font-size:68px;font-weight:800;letter-spacing:-1px">TrainRadar</span></div>
<div style="font-size:32px;line-height:1.3;opacity:.95">${line}</div></div></body></html>`);
  for (let k = 0; ; k++) {
    try {
      await g.screenshot({ path: `${out}/${file}` });
      break;
    } catch (e) {
      if (k >= 2) throw e;
      await g.waitForTimeout(2000);
    }
  }
}

await browser.close();
console.log("OK");
