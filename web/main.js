// TrainRadar web app. Everything runs here in the browser: the engine
// (WebAssembly) decodes Renfe's feeds, matches trains to the timetable and
// works out delays, positions and spacing.
import init, { Engine } from "./pkg/engine.js";
import { CONFIG } from "./js/config.js";
import { RefData } from "./js/data.js";
import { Feeds } from "./js/feeds.js";
import { formatAgo } from "./js/format.js";
import { pickLang, t } from "./js/i18n.js";
import { addLayers, createMap, emptyGeoJson, maplibregl, pointGeoJson, trainsGeoJson } from "./js/map.js";
import { delayedItem, el, legend, statsText, trainPopup } from "./js/ui.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: language just isn't remembered */
    }
  },
};

let lang = pickLang(store.get("lang"));
let engine, ref, feeds, map, attr;
let selected = null; // { trip_id, number }
let popup = null;
let lastRender = 0;

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t(lang, "title");
  const btn = $("lang");
  btn.textContent = lang === "es" ? "EN" : "ES";
  btn.setAttribute("aria-label", t(lang, "languageLabel"));
  btn.title = t(lang, "language");
  $("legend").replaceChildren(...legend(lang));
  $("delayed-btn").textContent = t(lang, "delayedList");
  $("delayed-title").textContent = t(lang, "delayedTitle");
  $("delayed-close").setAttribute("aria-label", t(lang, "close"));
  if (attr) {
    attr.options.customAttribution = t(lang, "attribution");
    attr._updateAttributions?.();
  }
  render(true);
}

function regionName(code) {
  return ref?.region(code)?.name || "";
}

function selectTrain(info, { fly = false } = {}) {
  selected = { trip_id: info.trip_id, number: info.number };
  if (fly) map.flyTo({ center: [info.lon, info.lat], zoom: Math.max(map.getZoom(), 10) });
  showPopup(true);
}

function clearSelection() {
  selected = null;
  popup?.remove();
  popup = null;
  map.getSource("selected")?.setData(emptyGeoJson());
}

function selectedInfo(now) {
  if (!selected) return null;
  const i = engine.findTrain(selected.trip_id, selected.number);
  if (i < 0) return null;
  return JSON.parse(engine.trainJson(i, now));
}

function showPopup(open = false) {
  const now = Date.now();
  const info = selectedInfo(now);
  if (!info) {
    if (selected && open) clearSelection();
    return;
  }
  map.getSource("selected")?.setData(pointGeoJson(info.lon, info.lat));
  const body = trainPopup(lang, info, regionName(info.region));
  if (!popup) {
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", offset: 12, focusAfterOpen: false })
      .setLngLat([info.lon, info.lat])
      .setDOMContent(body)
      .addTo(map);
    popup.on("close", () => {
      popup = null;
      selected = null;
      map.getSource("selected")?.setData(emptyGeoJson());
    });
  } else {
    popup.setLngLat([info.lon, info.lat]).setDOMContent(body);
  }
}

function renderDelayedList() {
  const list = JSON.parse(engine.delayedJson(Date.now(), 50));
  const ul = $("delayed-list");
  if (!list.length) {
    ul.replaceChildren(el("li", { class: "muted" }, t(lang, "noDelays")));
    return;
  }
  ul.replaceChildren(
    ...list.map((info) =>
      delayedItem(lang, info, (i) => {
        $("delayed").hidden = true;
        selectTrain(i, { fly: true });
      }),
    ),
  );
}

/** Redraw trains. Trains move slowly on screen, so 1–4 updates a second is plenty. */
function render(force = false) {
  if (!engine || !map) return;
  const now = Date.now();
  const interval = map.getZoom() >= 10 ? 250 : 1000;
  if (!force && now - lastRender < interval) return;
  lastRender = now;
  map.getSource("trains")?.setData(trainsGeoJson(engine.positions(now)));
  $("stats").textContent = statsText(lang, JSON.parse(engine.statsJson(now)));
  const last = feeds?.lastUpdate() || 0;
  $("status").textContent = feeds?.failing()
    ? t(lang, "feedError")
    : last
      ? t(lang, "updated", { age: formatAgo(lang, (now - last) / 1000) })
      : t(lang, "loading");
  if ((popup || selected) && map.getSource("selected")) showPopup();
  if (!$("delayed").hidden && force) renderDelayedList();
}

function loop() {
  if (document.visibilityState === "visible") render();
  requestAnimationFrame(loop);
}

function loadVisibleRegions() {
  if (!ref?.manifest || map.getZoom() < CONFIG.regionZoom) return;
  const b = map.getBounds();
  for (const r of ref.regionsIn([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])) {
    ref.loadRegion(r.code).catch((e) => console.warn("region", r.code, e));
  }
}

async function main() {
  applyLang();
  ({ map, attr } = createMap("map", CONFIG, t(lang, "attribution")));
  const mapReady = new Promise((r) => map.on("load", r));

  await init();
  engine = new Engine();
  ref = new RefData(engine, CONFIG.dataBase);
  try {
    await ref.start();
  } catch (e) {
    console.error(e);
    $("status").textContent = t(lang, "loadError");
    setTimeout(() => location.reload(), 30_000);
    return;
  }
  feeds = new Feeds(engine, CONFIG.rtBase, {
    onUpdate: () => render(true),
    onError: (k, e) => console.warn("feed", k, e.message),
  });
  feeds.start();

  await mapReady;
  addLayers(map);
  map.getSource("stations").setData(JSON.parse(engine.stationsGeoJson()));
  map.on("moveend", loadVisibleRegions);
  map.on("click", (e) => {
    const pad = 10; // generous tap target on phones
    const hits = map.queryRenderedFeatures(
      [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ],
      { layers: ["trains"] },
    );
    if (!hits.length) return clearSelection();
    const info = JSON.parse(engine.trainJson(hits[0].properties.i, Date.now()));
    selectTrain(info);
  });
  map.on("mouseenter", "trains", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "trains", () => (map.getCanvas().style.cursor = ""));
  render(true);
  requestAnimationFrame(loop);
  window.__trainradar = { engine, map, ref, feeds }; // for tests and debugging
}

$("lang").addEventListener("click", () => {
  lang = lang === "es" ? "en" : "es";
  store.set("lang", lang);
  applyLang();
});
$("delayed-btn").addEventListener("click", () => {
  const panel = $("delayed");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderDelayedList();
});
$("delayed-close").addEventListener("click", () => ($("delayed").hidden = true));

main();
