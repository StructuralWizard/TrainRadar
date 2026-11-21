// Browser test of the United Kingdom view (plan 3) on the synthetic UK data
// from tools/demo-uk.sh (demo/data/uk, demo/rt/uk):
// - ?country=uk loads Great Britain's data and Network Rail's feed;
// - trains are placed by timetable + TRUST delay, in London time; a run
//   cancelled in its trip update is not on the map;
// - the train sheet says the position is estimated;
// - the network picker offers España / Reino Unido; Avisos shows National
//   Rail's notices with the Rail Delivery Group credit, and "Próximas obras"
//   (planned works further ahead, free); the map credits
//   Network Rail (OGL);
// - the choice is remembered, and España goes back to Spain.
//
//   tools/demo-uk.sh
//   DATA=demo/data FIXTURES=demo/rt node tools/dev-server.mjs &
//   node tools/feed-check/uk-smoke.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";

const [url, out = "."] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fail = async (msg) => {
  console.error(`FAIL: ${msg}`);
  await page.screenshot({ path: `${out}/uk-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};

await page.goto(`${url}?country=uk`);
await page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 }).catch(() => fail("no UK trains"));
const trains = await page.evaluate(() => {
  const e = window.__trainradar.engine;
  const n = e.positions(Date.now()).length / 6;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = JSON.parse(e.trainJson(i, Date.now()));
    out.push({ i, number: t.number, trip: t.trip_id, delay: t.delay, position: t.position, operator: t.operator, live: !t.timetable_only });
  }
  return out;
});
console.log("UK trains:", trains.map((t) => `${t.number}(${t.delay ?? "-"})`).join(" "));
if (!trains.every((t) => t.position === "scheduled" && t.live)) await fail(`not timetable-placed live trains: ${JSON.stringify(trains[0])}`);
// From demo-uk.sh: every train ending in 3 is cancelled, even ones late.
if (trains.some((t) => /3:2026/.test(t.trip))) await fail("a cancelled run is on the map");
const late = trains.find((t) => t.delay === 420 || t.delay === 60);
if (!late) await fail(`no TRUST delay applied: ${JSON.stringify(trains)}`);
// London time: a train every 10 minutes taking 45: four or five running.
if (trains.length < 3 || trains.length > 6) await fail(`${trains.length} trains running (London time?)`);
if ((await page.textContent("#net-chip")).trim() !== "Reino Unido") await fail("chip isn't Reino Unido");
const credits = await page.evaluate(() => document.querySelector(".maplibregl-ctrl-attrib")?.textContent || "");
if (!/Network Rail Infrastructure Limited/.test(credits) || !/Open Government Licence/.test(credits)) await fail(`credits: ${credits.slice(0, 200)}`);

// A train's sheet: estimated position, its delay.
await page.fill("#search-q", late.number);
await page.waitForSelector("#search-results li button", { timeout: 5000 }).catch(() => fail("search found no UK train"));
await page.click("#search-results li button");
await page.waitForSelector("#detail:not([hidden]) .popup-title, #detail:not([hidden])", { timeout: 10000 }).catch(() => fail("train sheet didn't open"));
const sheet = (await page.textContent("#detail")).replace(/\s+/g, " ");
if (!sheet.includes("posición estimada: horario + retraso en directo")) await fail(`sheet: ${sheet.slice(0, 200)}`);
if (!/\+[17]\s*min/.test(sheet)) await fail(`delay not shown: ${sheet.slice(0, 200)}`);
await page.screenshot({ path: `${out}/uk-train.png` });
await page.click("#detail-close").catch(() => page.keyboard.press("Escape"));

// Avisos: National Rail's notices, credited.
await page.click("#tab-incidents");
await page.waitForSelector("#uk-incidents li", { timeout: 10000 }).catch(() => fail("no National Rail notices"));
const notices = (await page.textContent("#inc-body")).replace(/\s+/g, " ");
if ((await page.$$("#uk-incidents li")).length !== 2) await fail(`notices: ${notices.slice(0, 200)}`);
if (!/Rail Delivery Group/.test(notices) || !/out of date|desactualizada|out of date/i.test(notices)) await fail(`credit/notice missing: ${notices.slice(-300)}`);
if ((await page.textContent("#inc-title")).trim() !== "Avisos de National Rail") await fail("sheet title");
if ((await page.textContent("#tab-incidents-n")).trim() !== "2") await fail("notice count badge");
// "Próximas obras" (free): planned works further ahead, with an operator filter.
const upcoming = await page.$$eval("#uk-upcoming li", (l) => l.map((x) => x.textContent));
if (upcoming.length !== 1 || !/Works next March/.test(upcoming[0])) await fail(`upcoming: ${JSON.stringify(upcoming)}`);
if (!(await page.$("#upcoming-operator"))) await fail("no operator filter");
if (!/Próximas obras/.test(await page.textContent("#upcoming-h"))) await fail("upcoming title");
await page.screenshot({ path: `${out}/uk-incidents.png` });
await page.click("#tab-incidents");

// The picker: España / Reino Unido; the choice is remembered.
await page.click("#net-chip");
await page.waitForSelector("#networks:not([hidden]) .net-countries");
const countries = await page.$$eval(".net-countries button", (b) => b.map((x) => [x.dataset.country, x.getAttribute("aria-pressed")]));
if (JSON.stringify(countries) !== JSON.stringify([["es", "false"], ["uk", "true"]])) await fail(`countries: ${JSON.stringify(countries)}`);
await page.screenshot({ path: `${out}/uk-networks.png` });
await Promise.all([page.waitForNavigation(), page.click('.net-countries button[data-country="es"]')]);
await page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 }).catch(() => fail("Spain didn't load"));
if ((await page.textContent("#net-chip")).trim() === "Reino Unido") await fail("still the UK after choosing España");
const saved = await page.evaluate(() => localStorage.getItem("country"));
if (saved !== "es") await fail(`saved country ${saved}`);
console.log("switch back to Spain:", (await page.textContent("#net-chip")).trim());

if (errors.length) await fail(`page errors: ${errors.join(" | ")}`);
console.log("OK");
await browser.close();
