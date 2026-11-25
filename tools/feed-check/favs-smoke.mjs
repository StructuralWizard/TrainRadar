// Browser test of Favoritos and the saved view (phone size, demo data):
// - trains and stations in two lists, each sorted with its handle (keys ↑ ↓
//   or a drag), the order saved;
// - the detail sheet's pager (‹ Favorito 2 de 3 ›) and a sideways swipe step
//   through the favourites, a station's sheet showing at once while the map
//   still moves;
// - reopening the page lands on the same map view with the station open.
//
//   node tools/feed-check/favs-smoke.mjs http://localhost:8080/ OUT_DIR
import { chromium } from "playwright";
const [URL, OUT = "."] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const ready = () => p.waitForFunction(() => window.__trainradar?.engine?.positions(Date.now()).length > 0, null, { timeout: 30000 });
const log = (...a) => console.log(...a);
const fail = async (m) => {
  console.error(`FAIL: ${m}`);
  await p.screenshot({ path: `${OUT}/favs-failure.png` }).catch(() => {});
  await b.close();
  process.exit(1);
};
const eq = (a, e, m) => JSON.stringify(a) === JSON.stringify(e) || fail(`${m}: ${JSON.stringify(a)}`);
await p.goto(URL); await ready();
// Two running trains with a next stop, and Atocha.
const seed = await p.evaluate(() => {
  const e = window.__trainradar.engine, n = e.positions(Date.now()).length / 6, tr = [];
  for (let i = 0; i < n && tr.length < 2; i++) { const t = JSON.parse(e.trainJson(i, Date.now())); if (t.origin && !t.timetable_only && t.next_stop) tr.push({ type: "train", number: t.number, label: t.number }); }
  const st = JSON.parse(e.stationsGeoJson()).features.find((f) => f.properties.id === "60000");
  const s = { type: "station", id: "60000", name: st.properties.name, lon: st.geometry.coordinates[0], lat: st.geometry.coordinates[1] };
  localStorage.setItem("favourites", JSON.stringify([s, ...tr]));
  return [...tr.map((x) => x.number), s.id];
});
log("seed", seed);
if (seed.length !== 3) await fail("needs two running trains in the demo data");
const [t1, t2, s1] = seed;
await p.reload(); await ready();
await p.click("#tab-favs"); await p.waitForSelector("#favs-trains li");
const heads = await p.$$eval("#favs-body h3", (h) => h.map((x) => x.textContent));
const order = () => p.evaluate(() => JSON.parse(localStorage.getItem("favourites")).map((f) => f.number || f.id));
log("headings", heads);
await eq(heads, ["Estaciones", "Trenes"], "groups");
await eq(await p.$$eval("#favs-trains li", (l) => l.length), 2, "train rows");
// Keyboard: first train down.
await p.focus("#favs-trains li:first-child .fav-handle"); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(200);
await eq(await order(), [s1, t2, t1], "after ↓");
// Drag: the second train's handle above the first.
const h2 = await (await p.$("#favs-trains li:nth-child(2) .fav-handle")).boundingBox();
const h1 = await (await p.$("#favs-trains li:nth-child(1) .fav-handle")).boundingBox();
await p.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2); await p.mouse.down();
await p.mouse.move(h1.x + h1.width / 2, h1.y - 5, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
await eq(await order(), [s1, t1, t2], "after the drag");
// Open the first train (after the station: stations come first): pager,
// next and previous, then a swipe back → the station.
await p.click("#favs-trains li:first-child button.link");
await p.waitForSelector("#fav-pager");
await eq((await p.textContent("#fav-pager")).trim(), "‹Favorito 2 de 3›", "pager");
await p.click("#fav-next"); await p.waitForTimeout(400);
await eq((await p.textContent("#fav-pager")).trim(), "‹Favorito 3 de 3›", "next");
await p.click("#fav-prev"); await p.waitForTimeout(400);
await eq((await p.textContent("#fav-pager")).trim(), "‹Favorito 2 de 3›", "previous");
// Swipe right (touch) → the station, shown at once while the map still moves.
await p.evaluate(() => {
  const d = document.getElementById("detail");
  const t = (x) => new Touch({ identifier: 1, target: d, clientX: x, clientY: 500 });
  d.dispatchEvent(new TouchEvent("touchstart", { touches: [t(150)], changedTouches: [t(150)], bubbles: true }));
  d.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [t(300)], bubbles: true }));
});
await p.waitForTimeout(150);
const swiped = await p.evaluate(() => [document.querySelector("#detail .sheet-station h2")?.textContent, document.querySelector("#fav-pager")?.textContent, window.__trainradar.map.isMoving()]);
await eq(swiped, ["Madrid-Puerta de Atocha", "‹Favorito 1 de 3›", true], "swipe: the station at once, the map still moving");
await p.waitForTimeout(3000);
const left = await p.evaluate(() => { const c = window.__trainradar.map.getCenter(); return { lon: c.lng, lat: c.lat, zoom: window.__trainradar.map.getZoom() }; });
// Reopen the app: same place, station sheet again.
await p.reload(); await ready(); await p.waitForTimeout(2500);
const back = await p.evaluate(() => { const c = window.__trainradar.map.getCenter(); return { lon: c.lng, lat: c.lat, zoom: window.__trainradar.map.getZoom(), station: document.querySelector("#detail:not([hidden]) .sheet-station h2")?.textContent }; });
log("reopened", back);
if (Math.abs(back.lon - left.lon) > 0.005 || Math.abs(back.lat - left.lat) > 0.005 || Math.abs(back.zoom - left.zoom) > 0.1 || back.station !== "Madrid-Puerta de Atocha") await fail(`not where it was left: ${JSON.stringify(back)}`);
await p.screenshot({ path: `${OUT}/favs-reopened.png` });
if (errs.length) await fail(`page errors: ${errs.join(" | ")}`);
console.log("OK");
await b.close();
