// Browser test of the United Kingdom view (plan 3) on the synthetic UK data
// from tools/demo-uk.sh (demo/data/uk, demo/rt/uk):
// - ?country=uk loads Great Britain's data and Network Rail's feed;
// - trains are placed by timetable + TRUST delay, in London time; a run
//   cancelled in its trip update is not on the map;
// - the train sheet says the position is estimated;
// - the network picker offers España / Reino Unido; Avisos shows National
//   Rail's notices with the National Rail credit, and "Próximas obras"
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
// The timetable places trains before the trip updates arrive: wait for them.
await page
  .waitForFunction(
    () => {
      const e = window.__trainradar.engine;
      const n = e.positions(Date.now()).length / 6;
      for (let i = 0; i < n; i++) if (JSON.parse(e.trainJson(i, Date.now())).delay !== null) return true;
      return false;
    },
    null,
    { timeout: 30000 },
  )
  .catch(() => {});
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
// Northern Ireland (plan 4): NI Railways by timetable only, apart from GB.
const ni = trains.filter((t) => t.operator === "NI Railways");
trains.splice(0, trains.length, ...trains.filter((t) => t.operator !== "NI Railways"));
console.log("NI trains:", ni.map((t) => t.number).join(" "));
if (!ni.length || !ni.every((t) => !t.live && /^P\d+$/.test(t.number))) await fail(`NI trains: ${JSON.stringify(ni)}`);
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
if (!/Network Rail Infrastructure Limited/.test(credits) || !/Open Government Licence/.test(credits) || !/Translink/.test(credits)) await fail(`credits: ${credits.slice(0, 300)}`);

// A train's sheet: estimated position, its delay.
await page.fill("#search-q", late.number);
await page.waitForSelector("#search-results li button", { timeout: 5000 }).catch(() => fail("search found no UK train"));
await page.click("#search-results li button");
await page.waitForSelector("#detail:not([hidden]) .popup-title, #detail:not([hidden])", { timeout: 10000 }).catch(() => fail("train sheet didn't open"));
const sheet = (await page.textContent("#detail")).replace(/\s+/g, " ");
if (!sheet.includes("posición estimada: horario + retraso en directo")) await fail(`sheet: ${sheet.slice(0, 200)}`);
// The delay pill: "+1" or "+7" (its accessible label says "+1 min").
if (!/\+[17](?!\d)/.test(sheet)) await fail(`delay not shown: ${sheet.slice(0, 200)}`);
// Where the figures come from: Network Rail, not Renfe.
if (!/Retraso: Network Rail/.test(sheet) || /Renfe/.test(sheet)) await fail(`sources: ${sheet.slice(Math.max(0, sheet.indexOf("Renfe") - 150), sheet.indexOf("Renfe") + 100)}`);
await page.screenshot({ path: `${out}/uk-train.png` });
await page.click("#detail-close").catch(() => page.keyboard.press("Escape"));

// An NI train: placed by timetable, credited to Translink.
await page.fill("#search-q", ni[0].number);
await page.waitForSelector("#search-results li button", { timeout: 5000 }).catch(() => fail("search found no NI train"));
await page.click("#search-results li button");
await page.waitForFunction(() => /NI Railways/.test(document.querySelector("#detail")?.textContent || ""), null, { timeout: 10000 }).catch(() => fail("NI train sheet"));
const niSheet = (await page.textContent("#detail")).replace(/\s+/g, " ");
if (!/los datos en directo de NI Railways no son públicos/.test(niSheet) || !/Horario: Translink \(NI Railways\)/.test(niSheet)) await fail(`NI sheet: ${niSheet.slice(0, 400)}`);
if (!/de NI Railways según horario/.test(await page.textContent("#stats"))) await fail(`stats: ${await page.textContent("#stats")}`);
if ((await page.textContent("#net-chip")).trim() !== "Reino Unido") await fail(`chip over NI: ${await page.textContent("#net-chip")}`);
await page.screenshot({ path: `${out}/uk-ni-train.png` });
await page.click("#detail-close").catch(() => page.keyboard.press("Escape"));

// Avisos: National Rail's notices, credited.
await page.click("#tab-incidents");
await page.waitForSelector("#uk-incidents li", { timeout: 10000 }).catch(() => fail("no National Rail notices"));
const notices = (await page.textContent("#inc-body")).replace(/\s+/g, " ");
if ((await page.$$("#uk-incidents li")).length !== 2) await fail(`notices: ${notices.slice(0, 200)}`);
if (!/Avisos: National Rail\./.test(notices) || !/out of date|desactualizada|out of date/i.test(notices)) await fail(`credit/notice missing: ${notices.slice(-300)}`);
if ((await page.textContent("#inc-title")).trim() !== "Avisos de National Rail") await fail("sheet title");
if ((await page.textContent("#tab-incidents-n")).trim() !== "2") await fail("notice count badge");
// "Próximas obras" (free): planned works further ahead, with an operator filter.
const upcoming = await page.$$eval("#uk-upcoming li", (l) => l.map((x) => x.textContent));
if (upcoming.length !== 1 || !/Works next March/.test(upcoming[0])) await fail(`upcoming: ${JSON.stringify(upcoming)}`);
if (!(await page.$("#upcoming-operator"))) await fail("no operator filter");
if (!/Próximas obras/.test(await page.textContent("#upcoming-h"))) await fail("upcoming title");
await page.screenshot({ path: `${out}/uk-incidents.png` });
await page.click("#tab-incidents");

// Cómo llegar (plan journeys): Euston → Milton Keynes, direct trains every
// 10 minutes, times in London.
await page.click("#tab-map").catch(() => {});
await page.fill("#search-q", "euston a milton keynes");
await page.click("#search-route-go").catch(() => fail("no origin → destination row in the UK"));
await page.waitForSelector("#route:not([hidden]) #route-count", { timeout: 10000 }).catch(async () => fail(`UK route: ${await page.textContent("#route-body").catch(() => "")}`));
const ukRoute = (await page.textContent("#route-body")).replace(/\s+/g, " ");
console.log("UK route:", ukRoute.slice(0, 160));
if (!/formas de llegar/.test(ukRoute) || !(await page.$('#route .journey-row[data-changes="0"]'))) await fail("UK route: no direct journey");
await page.click("#route-close");

// The picker: the country drop-down, the country shown (the UK) first,
// then every other country A–Z; the choice is remembered.
await page.click("#net-chip");
await page.waitForSelector("#networks:not([hidden]) #net-country");
const countries = await page.$$eval("#net-country option", (o) => o.map((x) => [x.value, String(x.selected), x.textContent]));
const rest = countries.slice(1).filter(([v]) => v !== "overview").map(([, , name]) => name);
const sorted = [...rest].sort((a, b) => a.localeCompare(b, "es"));
if (JSON.stringify(countries[0].slice(0, 2)) !== JSON.stringify(["uk", "true"]) || JSON.stringify(rest) !== JSON.stringify(sorted) || countries.length < 20) await fail(`countries: ${JSON.stringify(countries)}`);
await page.screenshot({ path: `${out}/uk-networks.png` });
await Promise.all([page.waitForNavigation(), page.selectOption("#net-country", "es")]);
await page.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 }).catch(() => fail("Spain didn't load"));
if ((await page.textContent("#net-chip")).trim() === "Reino Unido") await fail("still the UK after choosing España");
const saved = await page.evaluate(() => localStorage.getItem("country"));
if (saved !== "es") await fail(`saved country ${saved}`);
console.log("switch back to Spain:", (await page.textContent("#net-chip")).trim());

if (errors.length) await fail(`page errors: ${errors.join(" | ")}`);
console.log("OK");
await browser.close();
