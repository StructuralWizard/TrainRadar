// TrainRadar web app. Everything runs here in the browser: the engine
// (WebAssembly) decodes Renfe's feeds, matches trains to the timetable and
// works out delays, positions and spacing.
import init, { Engine } from "./pkg/engine.js";
import { CONFIG } from "./js/config.js";
import { RefData } from "./js/data.js";
import { Feeds } from "./js/feeds.js";
import { formatAgo, formatDistance } from "./js/format.js";
import { Locator, circlePolygon } from "./js/location.js";
import { pickLang, t } from "./js/i18n.js";
import {
  addLayers,
  createMap,
  emptyGeoJson,
  maplibregl,
  pointGeoJson,
  setMapLanguage,
  trainsGeoJson,
} from "./js/map.js";
import {
  delayedItem,
  el,
  incidentsPanel,
  legend,
  nearPanel,
  onboardBlock,
  statsText,
  trainPopup,
  trainTitle,
} from "./js/ui.js";

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
let locator = null;
let userFix = null;
let locMessage = null; // i18n key of the current location problem
let lastNear = 0;
let incidents = [];
let incFilter = null; // { label, test }
const SHEETS = ["delayed", "near", "incidents"];

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
  $("near-close").setAttribute("aria-label", t(lang, "close"));
  $("near-title").textContent = t(lang, "nearYou");
  $("inc-title").textContent = t(lang, "incidentsTitle");
  $("inc-close").setAttribute("aria-label", t(lang, "close"));
  renderIncidents();
  $("near-off").textContent = t(lang, "locationOff");
  $("near-privacy").textContent = t(lang, "privacy");
  $("center-btn").setAttribute("aria-label", t(lang, "centerOnMe"));
  $("center-btn").title = t(lang, "centerOnMe");
  updateLocButton();
  renderNear(true);
  if (attr) {
    attr.options.customAttribution = t(lang, "attribution");
    attr._updateAttributions?.();
  }
  if (map?.isStyleLoaded()) setMapLanguage(map, lang);
  render(true);
}

/** Fly to a point, keeping it clear of the bottom sheet if one is open. */
function flyToVisible(lon, lat, zoom) {
  const sheet = SHEETS.map($).find((x) => !x.hidden);
  const covered = sheet && sheet.getBoundingClientRect().width >= window.innerWidth - 1;
  map.flyTo({
    center: [lon, lat],
    zoom: Math.max(map.getZoom(), zoom),
    // Shift up by half the sheet so the point lands in the visible part.
    // The sheet can grow to 55% of the screen once its content loads.
    offset: [0, covered ? -(window.innerHeight * 0.55) / 2 : 0],
  });
}

function updateLocButton() {
  const on = !!locator?.active;
  const b = $("loc-btn");
  b.textContent = `📍 ${t(lang, "useLocation")}`;
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", t(lang, on ? "locationOff" : "useLocationLabel"));
  $("center-btn").hidden = !on || !userFix;
  $("near-off").hidden = !on;
}

function setUserLayers() {
  if (!map?.getSource("user")) return;
  if (!userFix) {
    map.getSource("user").setData(emptyGeoJson());
    map.getSource("user-accuracy").setData(emptyGeoJson());
    return;
  }
  map.getSource("user").setData(pointGeoJson(userFix.lon, userFix.lat));
  map.getSource("user-accuracy").setData({
    type: "FeatureCollection",
    features: [circlePolygon(userFix.lon, userFix.lat, Math.min(userFix.accuracy, 5000))],
  });
}

function startLocation() {
  if (!Locator.supported()) {
    locMessage = "noLocationApi";
    openSheet("near");
    renderNear(true);
    return;
  }
  locator ??= new Locator({
    onFix(fix) {
      const first = !userFix;
      userFix = fix;
      locMessage = null;
      engine?.onboardAdd(fix.lat, fix.lon, fix.accuracy, Date.now());
      setUserLayers();
      if (first) {
        flyToVisible(fix.lon, fix.lat, 12);
        // Cercanías timetables around the user, for boards and matching.
        const d = 0.1;
        for (const r of ref?.regionsIn([fix.lon - d, fix.lat - d, fix.lon + d, fix.lat + d]) || []) {
          ref.loadRegion(r.code).then(() => renderNear(true));
        }
      }
      updateLocButton();
      renderNear(first);
    },
    onError(kind) {
      locMessage = kind;
      if (kind === "denied") stopLocation({ keepPanel: true });
      renderNear(true);
    },
  });
  locMessage = "locating";
  locator.start();
  openSheet("near");
  updateLocButton();
  renderNear(true);
}

function stopLocation({ keepPanel = false } = {}) {
  locator?.stop();
  userFix = null;
  engine?.onboardClear(); // forget every fix
  setUserLayers();
  if (!keepPanel) $("near").hidden = true;
  updateLocButton();
}

/** Refresh the "Near you" panel (at most every 5 s unless forced). */
function renderNear(force = false) {
  if ($("near").hidden || !engine) return;
  const now = Date.now();
  if (!force && now - lastNear < 5000) return;
  lastNear = now;
  const status = $("near-status");
  status.className = "small";
  if (locMessage && locMessage !== "locating") {
    status.textContent = t(lang, locMessage);
    status.className = "small warn";
  } else if (!userFix) {
    status.textContent = t(lang, "locating");
  } else {
    const acc = formatDistance(lang, userFix.accuracy);
    const low = userFix.accuracy > 1000;
    status.textContent = t(lang, low ? "lowAccuracy" : "accuracy", { acc });
    if (low) status.className = "small warn";
  }
  if (!userFix) {
    $("onboard").replaceChildren();
    $("near-body").replaceChildren();
    return;
  }
  const titles = (c) => {
    const i = engine.findTrain(c.trip_id, c.number);
    return i >= 0 ? trainTitle(JSON.parse(engine.trainJson(i, now))) : c.number;
  };
  $("onboard").replaceChildren(
    onboardBlock(lang, JSON.parse(engine.onboardJson()), titles, (c) => {
      selectTrain(JSON.parse(engine.trainJson(c.index, Date.now())), { fly: true });
    }),
  );
  const stations = JSON.parse(engine.nearestStationsJson(userFix.lat, userFix.lon, 3, 30_000));
  const s0 = stations[0];
  $("near-body").replaceChildren(
    ...nearPanel(lang, {
      stations,
      board: s0 ? JSON.parse(engine.stationBoardJson(s0.id, now, 90 * 60, 8)) : [],
      approaching: s0 ? JSON.parse(engine.approachingJson(s0.id, now, 30 * 60)).slice(0, 6) : [],
      onStation: (s) => flyToVisible(s.lon, s.lat, 14),
      onTrain: (a) => selectTrain(a, { fly: true }),
    }),
  );
}

/** Show one bottom sheet and hide the others. */
function openSheet(id) {
  for (const s of SHEETS) $(s).hidden = s !== id;
}

/** Refresh the notices button, map markers and (if open) the panel. */
function renderIncidents() {
  if (engine) incidents = JSON.parse(engine.incidentsJson(Date.now()));
  $("inc-btn").textContent = `⚠ ${t(lang, "incidents")}${incidents.length ? ` (${incidents.length})` : ""}`;
  const seen = new Set();
  const features = [];
  for (const i of incidents) {
    for (const s of i.stops) {
      if (s.lat === null || seen.has(s.id)) continue;
      seen.add(s.id);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { id: s.id, name: s.name },
      });
    }
  }
  map?.getSource("incidents")?.setData({ type: "FeatureCollection", features });
  if ($("incidents").hidden) return;
  $("inc-body").replaceChildren(
    ...incidentsPanel(lang, {
      list: incidents,
      modifiedMs: feeds?.modified("alerts"),
      filter: incFilter,
      regionName,
      onShowAll: () => {
        incFilter = null;
        renderIncidents();
      },
      onStop: (s) => flyToVisible(s.lon, s.lat, 13),
    }),
  );
  if (!incidents.length && !feeds?.modified("alerts")) {
    $("inc-body").prepend(el("p", { class: "muted" }, t(lang, "incidentsLoading")));
  }
}

function showIncidents(filter = null) {
  incFilter = filter;
  openSheet("incidents");
  renderIncidents();
}

function regionName(code) {
  return ref?.region(code)?.name || "";
}

function selectTrain(info, { fly = false } = {}) {
  selected = { trip_id: info.trip_id, number: info.number };
  if (fly) flyToVisible(info.lon, info.lat, 10);
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
  const body = trainPopup(lang, info, regionName(info.region), (i) =>
    showIncidents({
      label: i.route,
      test: (x) => x.lines.includes(i.route) && (!i.region || x.nucleos.includes(i.region)),
    }),
  );
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
  renderNear(force);
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
    onUpdate: (key) => {
      if (key === "alerts") renderIncidents();
      render(true);
    },
    onError: (k, e) => console.warn("feed", k, e.message),
  });
  feeds.start();

  await mapReady;
  setMapLanguage(map, lang);
  addLayers(map);
  setUserLayers();
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
    if (!hits.length) {
      const inc = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: ["incidents"] },
      );
      if (inc.length) {
        const { id, name } = inc[0].properties;
        return showIncidents({ label: name, test: (x) => x.stops.some((s) => s.id === id) });
      }
      return clearSelection();
    }
    const info = JSON.parse(engine.trainJson(hits[0].properties.i, Date.now()));
    selectTrain(info);
  });
  renderIncidents();
  map.on("mouseenter", "incidents", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "incidents", () => (map.getCanvas().style.cursor = ""));
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
  if (panel.hidden) {
    openSheet("delayed");
    renderDelayedList();
  } else panel.hidden = true;
});
$("delayed-close").addEventListener("click", () => ($("delayed").hidden = true));
$("loc-btn").addEventListener("click", () => (locator?.active ? stopLocation() : startLocation()));
$("near-close").addEventListener("click", () => ($("near").hidden = true));
$("inc-btn").addEventListener("click", () => ($("incidents").hidden ? showIncidents() : ($("incidents").hidden = true)));
$("inc-close").addEventListener("click", () => ($("incidents").hidden = true));
$("near-off").addEventListener("click", () => stopLocation());
$("center-btn").addEventListener("click", () => {
  if (locator?.active) {
    openSheet("near");
    renderNear(true);
  }
  if (userFix) flyToVisible(userFix.lon, userFix.lat, 13);
});

main();

// Installable app (PWA). Not on localhost, so development always gets fresh files.
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker", e));
}
