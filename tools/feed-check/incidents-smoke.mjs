// Browser test of the notices (incidents) panel on demo data: button count,
// panel, station marker filter, and the link from a train's popup.
//
//   node tools/feed-check/incidents-smoke.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await page.screenshot({ path: `${out}/incidents-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};
const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, " ");

await page.goto(url);
await page.waitForFunction(() => window.__trainradar?.map?.getSource("incidents"), null, { timeout: 30000 });
await page.waitForFunction(() => /\(2\)/.test(document.getElementById("inc-btn").textContent), null, { timeout: 30000 });
console.log("button:", await page.textContent("#inc-btn"));
await page.click("#tab-incidents");
await page.waitForSelector("#inc-body li");
const panel = await text("#incidents");
console.log("panel:", panel.slice(0, 400));
for (const want of ["Pinto", "C3", "Actualizados por Renfe", "Estado de la red", "Iryo", "OUIGO"]) {
  if (!panel.includes(want)) await fail(`panel lacks "${want}"`);
}
if (panel.includes("#MadC3")) await fail("tag not stripped");
if (panel.includes("[object")) await fail("element rendered as text");
await page.screenshot({ path: `${out}/incidents.png` });
await page.click("#inc-close");

// Tap the Pinto marker: the panel opens filtered to Pinto. (If a train is
// standing on it, the tap rightly opens the train; skip this check then.)
const pt = await page.evaluate(async () => {
  const { map } = window.__trainradar;
  map.jumpTo({ center: [-3.7016, 40.2433], zoom: 12 });
  await new Promise((r) => setTimeout(r, 1500));
  const p = map.project([-3.7016, 40.2433]);
  const box = [[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]];
  return { ...p, covered: map.queryRenderedFeatures(box, { layers: ["trains"] }).length > 0 };
});
if (pt.covered) {
  console.log("marker filter: skipped (a train is standing at Pinto)");
} else {
  await page.mouse.click(pt.x, pt.y);
  await page
    .waitForFunction(() => /Avisos de Pinto/.test(document.getElementById("incidents").textContent), null, { timeout: 5000 })
    .catch(() => fail("marker filter"));
  console.log("marker filter:", (await text("#inc-body")).slice(0, 120));
  await page.click("#inc-close");
}

// A C3 train's popup links to the notices on its line.
await page.waitForFunction(() => window.__trainradar.ref.loaded.has("10"), null, { timeout: 15000 });
const tp = await page.evaluate(async () => {
  const { engine, map } = window.__trainradar;
  const p = engine.positions(Date.now());
  for (let i = 0; i < p.length / 6; i++) {
    const info = JSON.parse(engine.trainJson(i, Date.now()));
    if (info.route === "C3" && info.incidents > 0) {
      map.jumpTo({ center: [p[i * 6], p[i * 6 + 1]], zoom: 12 });
      await new Promise((r) => setTimeout(r, 1500));
      const q = engine.positions(Date.now());
      return map.project([q[i * 6], q[i * 6 + 1]]);
    }
  }
  return null;
});
if (!tp) await fail("no C3 train with a notice");
await page.mouse.click(tp.x, tp.y);
await page.waitForSelector(".popup button.warn", { timeout: 5000 }).catch(() => fail("popup notice link"));
console.log("popup link:", await page.textContent(".popup button.warn"));
await page.click(".popup button.warn");
await page.waitForFunction(() => /Avisos de C3/.test(document.getElementById("incidents").textContent));
if (errors.length) await fail(errors.join("; "));
console.log("OK");
await browser.close();
