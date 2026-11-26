// Browser smoke test of the web app (phone-sized viewport):
// trains appear, a popup opens, the delayed list and language switch work.
//
//   node tools/feed-check/web-smoke.mjs http://localhost:8080/ OUT_DIR [--print-screenshot]
//
// Exits non-zero on failure. --print-screenshot writes a small JPEG of the
// map as base64 to stdout (between markers), so it can be read from CI logs.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const [url, out = ".", flag] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};

try {
  await page.goto(url);
  await page.waitForFunction(() => /[1-9][\d.]* trenes/.test(document.getElementById("stats").textContent), null, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__trainradar?.map?.getSource("trains"), null, { timeout: 30_000 });
  await page.waitForTimeout(3000); // tiles and a second render
  console.log("stats:", await page.textContent("#stats"), "|", await page.textContent("#status"), "| chip:", await page.textContent("#live-chip"));
  if (!(await page.isVisible("#live-chip")) || !/trenes/.test(await page.textContent("#live-chip"))) await fail("no live status chip");
  if (await page.isVisible(".bar")) await fail("desktop header shown on a phone");
  await page.screenshot({ path: `${out}/map.png` });
  if (flag === "--print-screenshot") {
    await page.screenshot({ path: `${out}/map-small.jpg`, type: "jpeg", quality: 55, scale: "css" });
    console.log("SCREENSHOT-BEGIN");
    console.log((await readFile(`${out}/map-small.jpg`)).toString("base64"));
    console.log("SCREENSHOT-END");
  }

  // Open the popup of a train with a gradient (track height known), else
  // one with a timetable match, else any.
  const pt = await page.evaluate(async () => {
    const { engine, map } = window.__trainradar;
    const n = engine.positions(Date.now()).length / 6;
    let pick = -1;
    let graded = false;
    for (let i = 0; i < n; i++) {
      const info = JSON.parse(engine.trainJson(i, Date.now()));
      if (info.grade_permille !== undefined) {
        pick = i;
        graded = true;
        break;
      }
      if (info.origin && pick < 0) pick = i;
    }
    pick = Math.max(pick, 0);
    const p = engine.positions(Date.now());
    map.jumpTo({ center: [p[pick * 6], p[pick * 6 + 1]], zoom: 11 });
    await new Promise((r) => setTimeout(r, 2000));
    const q = engine.positions(Date.now());
    return { ...map.project([q[pick * 6], q[pick * 6 + 1]]), graded };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector(".popup", { timeout: 5000 }).catch(() => fail("popup did not open"));
  console.log("popup:", (await page.textContent(".popup")).replace(/\s+/g, " "));
  await page.screenshot({ path: `${out}/popup.png` });
  // The tap can land on a neighbouring train, so check the popup that
  // opened: if it shows a gradient, it must also show the height profile.
  const shown = await page.textContent(".popup");
  if (/Pendiente|Gradient/.test(shown) && !(await page.$(".popup svg.profile path"))) {
    await fail("popup shows a gradient but no height profile");
  }

  await page.click("#tab-map"); // phone: back to the map, then expand the home sheet
  await page.click(".bucket-major");
  await page.waitForTimeout(400);
  const rows = await page.$$eval("#delayed-list li", (l) => l.length);
  console.log("delayed list rows:", rows);
  if (rows < 1) await fail("delayed list is empty");
  await page.screenshot({ path: `${out}/delayed.png` });

  // Notices panel with whatever Renfe publishes right now. On a phone the
  // open sheet covers the bottom buttons, so close it first like a person.
  await page.click("#tab-map");
  await page.click("#tab-incidents");
  await page.waitForTimeout(500);
  console.log("notices:", (await page.textContent("#incidents")).replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: `${out}/notices.png` });
  await page.click("#inc-close");

  await page.click("#tab-more");
  await page.click("#more-lang");
  await page.click("#lang-en");
  await page.waitForFunction(() => /trains/.test(document.getElementById("stats").textContent));
  console.log("english:", await page.textContent("#stats"));
  if (errors.length) await fail(`page errors: ${errors.join("; ")}`);
  console.log("OK");
} catch (e) {
  await fail(e.message);
}

// The other countries deployed (COUNTRIES="uk ie fr …", from the site's
// data/ folders): each must open from its link with its own data. Reported,
// not failed: countries still being built never stop Spain's deploy.
for (const c of (process.env.COUNTRIES || "").split(/\s+/).filter(Boolean)) {
  const p = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  try {
    await p.goto(`${url}?country=${c}`);
    await p.waitForFunction(() => window.__trainradar?.ref?.manifest, null, { timeout: 60_000 });
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => {
      const { ref, engine, map } = window.__trainradar;
      const at = map.getCenter();
      return {
        regions: ref.manifest.regions.map((x) => x.code).join(","),
        trains: engine.positions(Date.now()).length / 6,
        center: `${at.lng.toFixed(1)},${at.lat.toFixed(1)}`,
      };
    });
    await p.screenshot({ path: `${out}/country-${c}.png` });
    console.log(`country ${c}: OK, ${r.trains} trains, regions ${r.regions}, map at ${r.center}${errs.length ? `, errors: ${errs.join("; ")}` : ""}`);
  } catch (e) {
    await p.screenshot({ path: `${out}/country-${c}.png` }).catch(() => {});
    console.log(`country ${c}: FAIL ${e.message.split("\n")[0]} | ${await p.textContent("#status").catch(() => "")}`);
  }
  await p.close();
}
await browser.close();
