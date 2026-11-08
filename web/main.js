// TrainRadar web app. Everything runs here in the browser: the engine
// (WebAssembly) decodes Renfe's feeds, matches trains to the timetable and
// works out delays, positions and spacing.
import init, { Engine } from "./pkg/engine.js";
import { CONFIG } from "./js/config.js";
import { RefData } from "./js/data.js";
import { Feeds } from "./js/feeds.js";
import { formatAgo, formatCount, formatDelay, formatDistance } from "./js/format.js";
import { Sheets, isPhone } from "./js/sheet.js";
import { icon } from "./js/icons.js";
import { stationSheet, trainSheet } from "./js/sheetui.js";
import { Locator, circlePolygon } from "./js/location.js";
import { pickLang, t } from "./js/i18n.js";
import {
  FLAG,
  addLayers,
  createMap,
  emptyGeoJson,
  maplibregl,
  pointGeoJson,
  setBasemap,
  setMapLanguage,
  trainsGeoJson,
} from "./js/map.js";
import { formatClock } from "./js/format.js";
import { countVisit, dismissAppBanner, showAppBanner } from "./js/visits.js";
import { ReplayData, madridToMs, msToMadrid, replayGeoJson, replayRoot } from "./js/replay.js";
import { FREE_DAYS, HistoryApi, HistoryCache, RANGES, dailySeries, rangeBefore, renfeOfficialUrl } from "./js/history.js";
import { FREE_LIMIT, STORAGE_KEY, isFavourite, parseFavourites, toggleFavourite } from "./js/favourites.js";
import { enthusiast } from "./js/features.js";
import { appNative, canShare, copyText, exportBlob, exportFile, isNative, onAppLink, onBackButton, onResume, parseLink, prefs, share, styleStatusBar } from "./js/native.js";
import { backupName, makeBackup, mergeFavourites, mergeTrips, parseBackup } from "./js/backup.js";
import { Billing, ENTITLEMENT_KEY } from "./js/billing.js";
import { decide, parseCache } from "./js/entitlement.js";
import { tripCard } from "./js/card.js";
import { ALERT_CONFIG_KEY, ALERT_STATE_KEY, MAJOR, MINOR, decideAlerts, liveState } from "./js/alerts.js";
import { MAX_COMMUTES, activeCommute, emptyCommutes, parseCommutes, removeActive, selectCommute, serializeCommutes, setDestination, setOrigin, swapActive } from "./js/commutes.js";
import { CLAIMS_URL, TRIPS_KEY, activeTrip, claimText, completeFromRun, monthlyStats, needsArrival, parseTrips, runForTrip, serializeTrips, startTrip, tripsCsv, updateTrip } from "./js/trips.js";
import {
  delayedItem,
  favouritesPanel,
  settingsPanel,
  tripsPanel,
  historyPanel,
  commutePanel,
  claimBox,
  el,
  incidentsPanel,
  legend,
  nearPanel,
  onboardBlock,
  stationPopup,
  aboutPanel,
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
let popupKey = "";
let popupToTop = false; // a train was just chosen: show its card from the top
// Line punctuality for the train popup (public history API, phase C2b).
const history = new HistoryCache(CONFIG.apiBase, {
  // One redraw when the answer arrives, even under the pointer.
  onLoad: () => {
    if (popup) showPopup(true);
  },
});
let popupAt = 0;
let lastRender = 0;
let locator = null;
let userFix = null;
let locMessage = null; // i18n key of the current location problem
let lastNear = 0;
let incidents = [];
let incFilter = null; // { label, test }
const SHEETS = ["delayed", "near", "incidents", "about", "favs", "settings", "trips", "history", "commute", "more", "detail"];
const histApi = new HistoryApi(CONFIG.apiBase);
let historyView = null; // {kind: "train"|"station", ...} shown in the history sheet
let commutes = emptyCommutes(); // commute mode (Pro): saved commutes, one active
let commuteNote = ""; // e.g. "the list is full", shown once in the commute sheet
const COMMUTE_KEY = "commute";
let trips = []; // my trips (Pro), trips.js
let claimFor = null; // the trip whose claim summary is shown
let lastTripCheck = 0;
let alertsOn = false; // delay alerts (Pro), alerts.js
let lastAlertCheck = 0;
let billing = null; // Google Play (Android app only)
let entitlement = { pro: false, state: "none", checkedAt: 0 };
let settingsMsg = "";
const favLimit = () => (CONFIG.pro ? Infinity : FREE_LIMIT);
let favs = []; // favourite trains and stations (favourites.js)
let favFull = null; // key of the item whose save just hit the limit
const show = {
  commuter: true, av: true, ld: true, md: true, scheduled: true,
  lines: true, tav: true, tld: true, tmd: true, stations: true, stopped: true,
};
// Map layers each "Capas" checkbox shows or hides (trains are filtered in render()).
const LAYER_IDS = {
  lines: ["lines", "lines-notice"],
  tav: ["track-av"],
  tld: ["track-ld"],
  tmd: ["track-md"],
  stations: ["stations", "stations-ld", "station-labels"],
  stopped: ["stopped-ring"],
};
// Kinds of Renfe notice (engine incidents::Kind bits), each with a switch.
const KINDS = { strike: 1, accessibility: 2, works: 4, disruption: 8, other: 16 };
const showKind = { strike: true, accessibility: true, works: true, disruption: true, other: true };
const kindMask = () => Object.entries(KINDS).reduce((m, [k, bit]) => (showKind[k] ? m | bit : m), 0);
let stationPop = null;
let dragOffset = [0, 0]; // where the user dragged the train popup to
let highlight = null; // Set of train indexes on the selected train's line
// Phone: what the detail sheet shows ("train" | "station" | null), the
// station shown and its board tab, and each line's colour for badges.
let detailKind = null;
let stationView = null;
let stationTab = "dep";
let detailAt = 0;
let detailKey = "";
const lineColors = new Map(); // "region|line" and "|line" → "#rrggbb"

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
  $("layers-title").textContent = t(lang, "layers");
  for (const [id, k] of [
    ["g-trains", "groupTrains"],
    ["g-map", "groupMap"],
    ["g-incidents", "groupIncidents"],
    ["g-base", "groupBase"],
    ["f-commuter-l", "showCommuter"],
    ["f-av-l", "showAv"],
    ["f-ld-l", "showLd"],
    ["f-md-l", "showMd"],
    ["f-scheduled-l", "showScheduled"],
    ["f-k-disruption-l", "kind_disruption"],
    ["f-k-works-l", "kind_works"],
    ["f-k-accessibility-l", "kind_accessibility"],
    ["f-k-strike-l", "kind_strike"],
    ["f-k-other-l", "kind_other"],
    ["f-stopped-l", "showStopped"],
    ["f-lines-l", "showLines"],
    ["f-tav-l", "showTrackAv"],
    ["f-tld-l", "showTrackLd"],
    ["f-tmd-l", "showTrackMd"],
    ["f-stations-l", "showStations"],
    ["b-standard-l", "baseStandard"],
    ["b-satellite-l", "baseSatellite"],
  ]) {
    $(id).textContent = t(lang, k);
  }
  $("search-q").placeholder = t(lang, isPhone() ? "searchPlaceholderPhone" : "searchPlaceholder");
  phoneChrome();
  $("about-btn").setAttribute("aria-label", t(lang, "about"));
  $("about-btn").title = t(lang, "about");
  $("about-title").textContent = t(lang, "about");
  $("about-close").setAttribute("aria-label", t(lang, "close"));
  $("fav-btn").setAttribute("aria-label", t(lang, "favourites"));
  $("fav-btn").title = t(lang, "favourites");
  $("favs-title").textContent = t(lang, "favourites");
  $("favs-close").setAttribute("aria-label", t(lang, "close"));
  $("settings-title").textContent = t(lang, CONFIG.platform === "android" ? "settingsPro" : "settings");
  $("settings-close").setAttribute("aria-label", t(lang, "close"));
  $("trips-title").textContent = t(lang, "tripsTitle");
  $("history-title").textContent = t(lang, "historyTitle");
  $("history-close").setAttribute("aria-label", t(lang, "close"));
  $("commute-title").textContent = t(lang, "commuteTitle");
  $("commute-close").setAttribute("aria-label", t(lang, "close"));
  $("trips-close").setAttribute("aria-label", t(lang, "close"));
  $("more-title").textContent = t(lang, "moreTitle");
  $("more-close").setAttribute("aria-label", t(lang, "close"));
  buildTabs();
  if (!$("more").hidden) renderMore();
  $("app-banner-link").textContent = `📱 ${t(lang, "appBanner")}`;
  $("app-banner-close").setAttribute("aria-label", t(lang, "close"));
  if (!$("about").hidden) renderAbout();
  fillJump();
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
/** Fold the map credits into their ⓘ button (still one tap away), so they
 * don't cover a popup or, on a phone, the bottom of the map. */
function foldCredits() {
  document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
}

/** If a point is low on the screen, pan it up so the popup that opens below
 * it fits above the bottom buttons. */
function makeRoomBelow(lon, lat) {
  const h = map.getContainer().clientHeight;
  const y = map.project([lon, lat]).y;
  if (y > h * 0.35) map.panBy([0, y - h * 0.25], { duration: 300 });
}

/** Fly to a point so it lands in the visible part of the map: above a
 * bottom sheet, or (`forPopup`) in the upper third, leaving room for the
 * popup that opens below it. */
function flyToVisible(lon, lat, zoom, { forPopup = false } = {}) {
  if (isPhone()) return map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), zoom), offset: phoneOffset(forPopup) });
  const sheet = SHEETS.map($).find((x) => !x.hidden);
  const covered = sheet && sheet.getBoundingClientRect().width >= window.innerWidth - 1;
  const h = map.getContainer().clientHeight;
  map.flyTo({
    center: [lon, lat],
    zoom: Math.max(map.getZoom(), zoom),
    // The sheet can grow to 55% of the screen once its content loads.
    offset: [0, covered ? -(h * 0.55) / 2 : forPopup ? -h * 0.25 : 0],
  });
}

/** Phone: how far from the screen's centre the middle of the map left
 * visible is — under the top bar, above the tab bar and the sheet (at
 * half height when one is about to open). */
function phoneOffset(sheetOpening = false) {
  const h = map.getContainer().clientHeight;
  const topEl = $("chips");
  const top = topEl ? topEl.getBoundingClientRect().bottom : 0;
  const sheetH = Math.max(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-h")) || 0, sheetOpening ? sheets.heights().half : 0);
  const bottom = h - ($("tabbar").offsetHeight || 0) - sheetH;
  return [0, Math.round((top + bottom) / 2 - h / 2)];
}

/** Phone: pan a point into the visible part of the map if it's hidden. */
function keepVisible(lon, lat) {
  const [, dy] = phoneOffset(true);
  const h = map.getContainer().clientHeight;
  const y = map.project([lon, lat]).y;
  const mid = h / 2 + dy;
  const room = Math.max(60, h / 2 - Math.abs(dy) - 80);
  if (Math.abs(y - mid) > room) map.easeTo({ center: [lon, lat], offset: [0, dy], duration: 350 });
}

function updateLocButton() {
  const on = !!locator?.active;
  const b = $("loc-btn");
  b.textContent = `📍 ${t(lang, "useLocation")}`;
  b.setAttribute("aria-pressed", String(on));
  $("fab-locate").setAttribute("aria-pressed", String(on));
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
          ref.loadRegion(r.code).then(() => {
            refreshLines();
            renderNear(true);
          });
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
  const onboard = JSON.parse(engine.onboardJson());
  // Sure you're on a train: log the trip (Pro).
  const top = onboard.candidates?.[0];
  if (CONFIG.pro && onboard.status === "match" && top?.confidence === "high" && top.index >= 0 && !activeTrip(trips, top.number)) {
    logTrip(JSON.parse(engine.trainJson(top.index, now)), "onboard");
  }
  $("onboard").replaceChildren(
    onboardBlock(lang, onboard, titles, (c) => {
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

function hiddenByFilter(flags) {
  if (flags & FLAG.scheduled) return !show.scheduled;
  if (flags & FLAG.commuter) return !show.commuter;
  if (flags & FLAG.highSpeed) return !show.av;
  if (flags & FLAG.medium) return !show.md;
  return !show.ld;
}

/** Draw the selected train's route and highlight its line's trains. */
function updateRoute() {
  const i = engine.findTrain(selected.trip_id, selected.number);
  const r = i >= 0 ? JSON.parse(engine.tripJson(i)) : null;
  if (!r) {
    highlight = null;
    map.getSource("route")?.setData(emptyGeoJson());
    return;
  }
  highlight = new Set([i, ...r.same_line]);
  map.getSource("route")?.setData({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: r.line }, properties: {} },
      ...r.stops.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { name: s.name, time: formatClock(s.time) },
      })),
    ],
  });
}

function refreshLines() {
  if (!engine || !map?.getSource("lines")) return;
  const data = JSON.parse(engine.linesGeoJson(Date.now()));
  const mask = kindMask();
  for (const f of data.features) {
    f.properties.notice = (f.properties.notice_kinds & mask) !== 0;
    const { line, region, color } = f.properties;
    if (line && color) {
      lineColors.set(`${region}|${line}`, color);
      if (!lineColors.has(`|${line}`)) lineColors.set(`|${line}`, color);
    }
  }
  map.getSource("lines").setData(data);
}

/** "Ir a…": the whole country, then each Cercanías network (núcleo) A–Z.
 * AV/LD/MD trains run all over Spain, so they only need "Toda España". */
function fillJump() {
  const sel = $("jump");
  const nucleos = (ref?.manifest?.regions || [])
    .filter((r) => r.code !== "ld" && r.live !== false)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  sel.replaceChildren(
    el("option", { value: "" }, t(lang, "goTo")),
    el("option", { value: "es" }, t(lang, "allSpain")),
    nucleos.length
      ? el("optgroup", { label: t(lang, "cercaniasNetworks") }, nucleos.map((r) => el("option", { value: r.code }, r.name)))
      : null,
  );
}

/** Show one bottom sheet and hide the others. */
function openSheet(id) {
  for (const s of SHEETS) $(s).hidden = s !== id;
}

/** Refresh the notices button, map markers and (if open) the panel. */
function renderIncidents() {
  if (engine) incidents = JSON.parse(engine.incidentsJson(Date.now()));
  refreshLines();
  $("inc-btn").textContent = `⚠ ${t(lang, "incidents")}${incidents.length ? ` (${incidents.length})` : ""}`;
  const badge = $("tab-incidents-n");
  if (badge) {
    badge.hidden = !incidents.length;
    badge.textContent = incidents.length > 99 ? "99+" : String(incidents.length);
    $("tab-incidents").setAttribute("aria-label", incidents.length ? `${t(lang, "tabNotices")}: ${t(lang, "noticesCount", { n: incidents.length })}` : t(lang, "tabNotices"));
  }
  // One marker per station, coloured by its most serious shown notice.
  const rank = ["disruption", "strike", "works", "accessibility", "other"];
  const byStop = new Map();
  for (const i of incidents) {
    if (!showKind[i.kind]) continue;
    for (const s of i.stops) {
      if (s.lat === null) continue;
      const prev = byStop.get(s.id);
      if (!prev || rank.indexOf(i.kind) < rank.indexOf(prev.kind)) byStop.set(s.id, { s, kind: i.kind });
    }
  }
  const features = [...byStop.values()].map(({ s, kind }) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { id: s.id, name: s.name, kind },
  }));
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
        store.set(INC_FILTER_KEY, "");
        renderIncidents();
      },
      onStop: (s) => flyToVisible(s.lon, s.lat, 13),
      stopped: JSON.parse(engine.stoppedJson(Date.now())),
      onTrain: (i) => selectTrain(i, { fly: true }),
    }),
  );
  if (!incidents.length && !feeds?.modified("alerts")) {
    $("inc-body").prepend(el("p", { class: "muted" }, t(lang, "incidentsLoading")));
  }
  const chips = noticeChips();
  if (chips) $("inc-body").prepend(chips);
}

/** The Notices filter for a commute (Pro): notices at any station between
 * its ends (both included) or on a line its trains run on. */
const INC_FILTER_KEY = "incidents-filter";
const commuteKey = (c) => `${c.from.id}>${c.to.id}`;

function commuteNoticeFilter(c) {
  // Cercanías timetables load lazily: load the ones around both ends.
  for (const st of [c.from, c.to]) {
    const d = 0.05;
    for (const r of ref?.regionsIn([st.lon - d, st.lat - d, st.lon + d, st.lat + d]) || []) {
      if (!ref.loaded.has(r.code))
        ref.loadRegion(r.code).then(() => {
          if (incFilter?.commute === commuteKey(c)) showIncidents(commuteNoticeFilter(c));
        }).catch(() => {});
    }
  }
  const ids = new Set(JSON.parse(engine.betweenStationsJson(c.from.id, c.to.id)).map((x) => x.id));
  const routes = new Set(JSON.parse(engine.commuteJson(c.from.id, c.to.id, Date.now(), 24 * 3600, 50)).map((r) => r.route));
  return {
    label: `${c.from.name} → ${c.to.name}`,
    commute: commuteKey(c),
    test: (i) => i.stops.some((x) => ids.has(x.id)) || i.lines.some((l) => routes.has(l)),
  };
}

/** Opened from the ⚠ button: the remembered commute filter, if any. */
function defaultNoticeFilter() {
  if (!CONFIG.pro || !engine) return null;
  const c = commutes.list.find((x) => commuteKey(x) === store.get(INC_FILTER_KEY));
  return c ? commuteNoticeFilter(c) : null;
}

function noticeChips() {
  if (!CONFIG.pro || !commutes.list.length) return null;
  const current = incFilter?.commute ?? (incFilter ? null : "");
  const pick = (c) => () => {
    store.set(INC_FILTER_KEY, c ? commuteKey(c) : "");
    showIncidents(c ? commuteNoticeFilter(c) : null);
  };
  const chip = (label, v, c) =>
    el("button", { class: v === current ? "pill small pill-strong" : "pill small", type: "button", "aria-pressed": String(v === current), onclick: pick(c) }, label);
  return el("p", { class: "commute-tabs", id: "inc-commutes" }, chip(t(lang, "delayedAll"), "", null), ...commutes.list.map((c) => chip(`${c.from.name} → ${c.to.name}`, commuteKey(c), c)));
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
  popupToTop = true;
  updateRoute();
  render(true);
  if (fly) flyToVisible(info.lon, info.lat, 10, { forPopup: true });
  showPopup(true);
}

function clearSelection() {
  selected = null;
  highlight = null;
  map.getSource("route")?.setData(emptyGeoJson());
  popup?.remove();
  popup = null;
  map.getSource("selected")?.setData(emptyGeoJson());
}

function selectedProfile(now) {
  const i = selected ? engine.findTrain(selected.trip_id, selected.number) : -1;
  return i < 0 ? null : JSON.parse(engine.profileJson(i, now));
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
  if (isPhone()) return showTrainSheet(info, open, now);
  if (popup) {
    popup.setLngLat([info.lon, info.lat]);
    // Rebuilding the content swaps its buttons out from under a finger, so
    // only do it when something changed, at most every 2 s, and never while
    // the pointer is over the popup.
    const key = JSON.stringify({ ...info, lat: 0, lon: 0, fix_age: Math.floor(info.fix_age / 10) });
    const over = popup.getElement()?.matches(":hover");
    if (!open && (key === popupKey || over || Date.now() - popupAt < 2000)) return;
    popupKey = key;
  }
  popupAt = Date.now();
  const body = trainPopup(
    lang,
    info,
    regionName(info.region),
    (i) =>
      showIncidents({
        label: i.route,
        test: (x) => x.lines.includes(i.route) && (!i.region || x.nucleos.includes(i.region)),
      }),
    {
      napDate: ref?.napDate(),
      profile: info.altitude_m === undefined ? null : selectedProfile(now),
      onTrain: (i) => selectTrain(JSON.parse(engine.trainJson(i, Date.now())), { fly: true }),
      appUrl: CONFIG.platform === "web" ? CONFIG.playUrl : "",
      proLink: CONFIG.platform === "android" && !CONFIG.pro ? () => (openSheet("settings"), renderSettings()) : null,
      trip: CONFIG.platform === "android" && !info.timetable_only ? tripButton(info) : null,
      onHistory: CONFIG.apiBase && info.history_line
        ? () => openHistory({ kind: "train", trainNo: info.number, line: info.history_line, product: info.history_product, title: trainTitle(info), days: FREE_DAYS })
        : null,
      history: info.timetable_only ? null : history.get(info.history_line, info.history_product),
      enthusiast: enthusiast(CONFIG),
      fav: favButton({ type: "train", number: info.number, label: trainTitle(info) }),
      onShare: canShare()
        ? () => share({ title: trainTitle(info), text: t(lang, "shareTrain", { train: trainTitle(info) }), url: `${CONFIG.siteUrl}?train=${encodeURIComponent(info.number)}` })
        : null,
    },
  );
  if (!popup) {
    foldCredits();
    if (!map.isMoving()) makeRoomBelow(info.lon, info.lat);
    dragOffset = [0, 0];
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", offset: 12, focusAfterOpen: false })
      .setLngLat([info.lon, info.lat])
      .setDOMContent(body)
      .addTo(map);
    makeDraggable(popup, () => dragOffset, (o) => (dragOffset = o));
    popup.on("close", () => {
      popup = null;
      selected = null;
      highlight = null;
      map.getSource("route")?.setData(emptyGeoJson());
      map.getSource("selected")?.setData(emptyGeoJson());
    });
  } else {
    popup.setDOMContent(body);
    // A train just chosen (tap, search, link) starts at its title, not
    // where the card was scrolled to before (e.g. its history link); the
    // refresh every few seconds keeps the scroll.
    if (popupToTop) {
      const content = popup.getElement()?.querySelector(".maplibregl-popup-content");
      if (content) content.scrollTop = 0;
    }
  }
  popupToTop = false;
}

/** Phone: the selected train in the detail sheet (desktop: a popup). */
function showTrainSheet(info, open, now) {
  const sheet = $("detail");
  if (!open) {
    if (sheet.hidden || detailKind !== "train") return;
    // As for the popup: rebuild only on a change, at most every 2 s, and
    // not under a finger.
    const key = JSON.stringify({ ...info, lat: 0, lon: 0, fix_age: Math.floor(info.fix_age / 10) });
    if (key === detailKey || sheet.matches(":active") || Date.now() - detailAt < 2000) return;
    detailKey = key;
  }
  detailAt = Date.now();
  const i = engine.findTrain(info.trip_id, info.number);
  const trip = i < 0 ? null : JSON.parse(engine.tripJson(i));
  const favItem = { type: "train", number: info.number, label: trainTitle(info) };
  const fav = favButton(favItem);
  const route = info.route || info.line;
  const body = trainSheet(lang, info, {
    now,
    regionName: regionName(info.region),
    lineColor: lineColors.get(`${info.region}|${route}`) || lineColors.get(`|${route}`),
    stops: trip?.stops,
    redraw: () => showPopup(true),
    onClose: () => (sheet.hidden = true),
    fav,
    notify: notifyAction(info, favItem),
    onShare: canShare()
      ? () => share({ title: trainTitle(info), text: t(lang, "shareTrain", { train: trainTitle(info) }), url: `${CONFIG.siteUrl}?train=${encodeURIComponent(info.number)}` })
      : null,
    onHistory: CONFIG.apiBase && info.history_line
      ? () => openHistory({ kind: "train", trainNo: info.number, line: info.history_line, product: info.history_product, title: trainTitle(info), days: FREE_DAYS })
      : null,
    trip: CONFIG.platform === "android" && !info.timetable_only ? tripButton(info) : null,
    onIncidents: (x) =>
      showIncidents({
        label: x.route,
        test: (n) => n.lines.includes(x.route) && (!x.region || n.nucleos.includes(x.region)),
      }),
    history: info.timetable_only ? null : history.get(info.history_line, info.history_product),
    rows: {
      napDate: ref?.napDate(),
      profile: info.altitude_m === undefined ? null : selectedProfile(now),
      onTrain: (j) => selectTrain(JSON.parse(engine.trainJson(j, Date.now())), { fly: true }),
      appUrl: CONFIG.platform === "web" ? CONFIG.playUrl : "",
      proLink: CONFIG.platform === "android" && !CONFIG.pro ? () => (openSheet("settings"), renderSettings()) : null,
      enthusiast: enthusiast(CONFIG),
    },
  });
  $("detail-body").replaceChildren(body);
  if (open) {
    const was = detailKind;
    detailKind = "train";
    stationView = null;
    if (sheet.hidden) {
      openSheet("detail");
      sheets.setSnap("detail", "half");
    } else if (was !== "train") sheets.setSnap("detail", "half");
    if (popupToTop) sheet.scrollTop = 0;
    if (!map.isMoving()) keepVisible(info.lon, info.lat);
  }
  popupToTop = false;
}

/** "Avisarme": delay alerts for this train (Pro, Android), the Pro screen
 * (free app), or the Android app (web, once it has a listing). */
function notifyAction(info, favItem) {
  if (info.timetable_only) return null;
  if (CONFIG.platform === "android") {
    if (!CONFIG.pro) return { on: false, onToggle: () => (openSheet("settings"), renderSettings()) };
    const on = alertsOn && isFavourite(favs, favItem);
    return {
      on,
      onToggle: async () => {
        if (on) return openSheet("settings"), renderSettings();
        if (!isFavourite(favs, favItem)) {
          const r = toggleFavourite(favs, favItem, favLimit());
          if (!r.full) saveFavourites(r.list);
        }
        if (!alertsOn) await setAlerts(true);
        showPopup(true);
      },
    };
  }
  return CONFIG.playUrl ? { href: CONFIG.playUrl } : null;
}

/** Let the user drag a popup out of the way by its title. It then keeps
 * that offset from the train (or station) as the map moves. */
function makeDraggable(p, get, set) {
  const box = p.getElement();
  let start = null;
  box.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".popup-title")) return;
    const [ox, oy] = get();
    start = { x: e.clientX, y: e.clientY, ox, oy };
    // Keep the popup on the side of the train it's on now: otherwise the
    // map may flip it to the other side mid-drag, and it jumps.
    const side = [...box.classList].find((c) => c.startsWith("maplibregl-popup-anchor-"));
    if (side) p.options.anchor = side.slice("maplibregl-popup-anchor-".length);
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener("pointermove", (e) => {
    if (!start) return;
    const o = [start.ox + e.clientX - start.x, start.oy + e.clientY - start.y];
    set(o);
    box.classList.add("dragged");
    const at = (x, y) => [x + o[0], y + o[1]];
    p.setOffset({
      center: at(0, 0), top: at(0, 12), bottom: at(0, -12), left: at(12, 0), right: at(-12, 0),
      "top-left": at(9, 9), "top-right": at(-9, 9), "bottom-left": at(9, -9), "bottom-right": at(-9, -9),
    });
  });
  const end = () => (start = null);
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
}

/** Popup with a station's next departures and approaching trains. */
function showStation(f, { refresh = false } = {}) {
  const { id, name } = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const now = Date.now();
  // Its núcleo's timetable may not be loaded yet: load, then refresh.
  const d = 0.05;
  const regions = ref?.regionsIn([lon - d, lat - d, lon + d, lat + d]) || [];
  for (const r of regions) {
    if (!ref.loaded.has(r.code)) ref.loadRegion(r.code).then(() => (stationPop?.isOpen() || (detailKind === "station" && stationView === f)) && showStation(f, { refresh: true }));
  }
  if (isPhone()) return showStationSheet(f, regions, refresh);
  const body = stationPopup(
    lang,
    { id, name },
    JSON.parse(engine.stationBoardJson(id, now, 90 * 60, 10)),
    JSON.parse(engine.approachingJson(id, now, 30 * 60)).slice(0, 6),
    (a) => {
      stationPop?.remove();
      selectTrain(a, { fly: true });
    },
    {
      fav: favButton({ type: "station", id, name, lon, lat }, () => showStation(f)),
      onHistory: CONFIG.apiBase ? () => openHistory({ kind: "station", id, title: t(lang, "histTitleStation", { name }), days: FREE_DAYS }) : null,
      commute:
        CONFIG.platform === "android" && CONFIG.pro
          ? {
              // Origin chosen for the next commute, or this is an end of the active one.
              isFrom: commutes.draft ? commutes.draft.id === id : activeCommute(commutes)?.from.id === id,
              isTo: !commutes.draft && activeCommute(commutes)?.to.id === id,
              setFrom: () => saveCommutes(setOrigin(commutes, { id, name, lon, lat }), () => showStation(f)),
              setTo: () => {
                const r = setDestination(commutes, { id, name, lon, lat });
                commuteNote = r.full ? t(lang, "commuteFull", { max: MAX_COMMUTES }) : "";
                saveCommutes(r.state, () => showStation(f), r.added || r.full);
              },
            }
          : null,
      onShare: canShare()
        ? () => share({ title: name, text: t(lang, "shareStation", { station: name }), url: `${CONFIG.siteUrl}?station=${encodeURIComponent(id)}` })
        : null,
    },
  );
  if (stationPop?.isOpen()) return stationPop.setLngLat([lon, lat]).setDOMContent(body);
  clearSelection();
  foldCredits();
  makeRoomBelow(lon, lat);
  let off = [0, 0];
  stationPop = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", offset: 10, focusAfterOpen: false })
    .setLngLat([lon, lat])
    .setDOMContent(body)
    .addTo(map);
  makeDraggable(stationPop, () => off, (o) => (off = o));
}

/** Phone: a station's board in the detail sheet. */
function showStationSheet(f, regions, refresh) {
  const { id, name } = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const now = Date.now();
  const sheet = $("detail");
  if (!refresh) {
    stationTab = "dep";
    selected = null;
    highlight = null;
    map.getSource("route")?.setData(emptyGeoJson());
    map.getSource("selected")?.setData(emptyGeoJson());
  }
  const board = JSON.parse(engine.stationBoardJson(id, now, 90 * 60, 12));
  const approaching = JSON.parse(engine.approachingJson(id, now, 30 * 60)).slice(0, 10);
  const nucleo = regions.find((r) => r.code !== "ld");
  const routes = [...new Set(board.map((r) => r.route).filter(Boolean))].slice(0, 4);
  const sub = [];
  if (nucleo) sub.push(t(lang, "cercanias", { region: nucleo.name }));
  if (routes.length) sub.push(routes.join(", "));
  if (userFix) sub.push(t(lang, "awayDistance", { d: formatDistance(lang, distanceM(userFix, { lat, lon })) }));
  const redraw = () => showStation(f, { refresh: true });
  const region = nucleo?.code || "";
  const body = stationSheet(lang, { id, name }, {
    sub: sub.join(" · "),
    board,
    approaching,
    tab: stationTab,
    onTab: (tab) => {
      stationTab = tab;
      redraw();
    },
    lineColor: (route) => lineColors.get(`${region}|${route}`) || lineColors.get(`|${route}`),
    onDeparture: (r) => {
      const i = engine.findTrain(r.trip_id, r.number);
      if (i >= 0) selectTrain(JSON.parse(engine.trainJson(i, Date.now())), { fly: true });
    },
    onTrain: (a) => selectTrain(a, { fly: true }),
    onClose: () => (sheet.hidden = true),
    fav: favButton({ type: "station", id, name, lon, lat }, redraw),
    onHistory: CONFIG.apiBase ? () => openHistory({ kind: "station", id, title: t(lang, "histTitleStation", { name }), days: FREE_DAYS }) : null,
    commute:
      CONFIG.platform === "android" && CONFIG.pro
        ? {
            isFrom: commutes.draft ? commutes.draft.id === id : activeCommute(commutes)?.from.id === id,
            isTo: !commutes.draft && activeCommute(commutes)?.to.id === id,
            setFrom: () => saveCommutes(setOrigin(commutes, { id, name, lon, lat }), redraw),
            setTo: () => {
              const r = setDestination(commutes, { id, name, lon, lat });
              commuteNote = r.full ? t(lang, "commuteFull", { max: MAX_COMMUTES }) : "";
              saveCommutes(r.state, redraw, r.added || r.full);
            },
          }
        : null,
    onShare: canShare()
      ? () => share({ title: name, text: t(lang, "shareStation", { station: name }), url: `${CONFIG.siteUrl}?station=${encodeURIComponent(id)}` })
      : null,
  });
  const scroll = sheet.scrollTop;
  $("detail-body").replaceChildren(body);
  if (refresh) {
    sheet.scrollTop = scroll;
    return;
  }
  detailKind = "station";
  stationView = f;
  if (sheet.hidden) openSheet("detail");
  sheets.setSnap("detail", "half");
  sheet.scrollTop = 0;
  keepVisible(lon, lat);
}

/** Metres between two { lat, lon } points (small distances). */
function distanceM(a, b) {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function refreshTrack() {
  if (engine && map?.getSource("track")) map.getSource("track").setData(JSON.parse(engine.trackGeoJson()));
}

/** Pro from Google Play's answer (or the cached one), applied everywhere. */
async function refreshEntitlement() {
  const cache = parseCache(await prefs.get(ENTITLEMENT_KEY).catch(() => null));
  const next = decide(billing?.proStatus() ?? null, cache, Date.now());
  const changed = next.pro !== entitlement.pro || next.state !== entitlement.state;
  entitlement = next;
  CONFIG.pro = next.pro;
  if (next.checkedAt) prefs.set(ENTITLEMENT_KEY, JSON.stringify(next)).catch(() => {});
  if (changed) {
    popupKey = "";
    render(true);
    if (!next.pro && alertsOn) setAlerts(false);
    appNative.refreshWidget().catch(() => {});
  }
  renderSettings();
}

/** What the background check needs (read natively from Preferences). */
function writeAlertConfig() {
  const cfg = { enabled: alertsOn, lang, liveBase: CONFIG.liveBase, minor: MINOR, major: MAJOR };
  return prefs.set(ALERT_CONFIG_KEY, JSON.stringify(cfg)).catch(() => {});
}

async function setAlerts(on) {
  if (on && !(await appNative.requestNotifications().catch(() => false))) {
    settingsMsg = t(lang, "alertsDenied");
    return renderSettings();
  }
  alertsOn = on;
  await writeAlertConfig();
  await appNative.setAlerts(on, lang).catch((e) => console.warn("alerts", e));
  settingsMsg = "";
  renderSettings();
}

/** While the app is open: the same alerts, live from the engine (every minute). */
async function checkAlertsLive(now) {
  if (!alertsOn || !CONFIG.pro || now - lastAlertCheck < 60_000) return;
  lastAlertCheck = now;
  const trains = new Map();
  for (const f of favs) {
    if (f.type !== "train") continue;
    const info = liveTrain(f.number);
    if (info) trains.set(String(f.number).replace(/^0+/, ""), liveState(info));
  }
  if (!trains.size) return;
  let state = {};
  try {
    state = JSON.parse((await prefs.get(ALERT_STATE_KEY)) || "{}");
  } catch {
    state = {};
  }
  const r = decideAlerts(favs, trains, state, new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(now)), { lang });
  await prefs.set(ALERT_STATE_KEY, JSON.stringify(r.state)).catch(() => {});
  for (const a of r.alerts) appNative.notify(a.trainNo, a.title, a.body).catch(() => {});
}

async function startBilling() {
  if (CONFIG.platform !== "android") return;
  await refreshEntitlement(); // cached answer first, before Play replies
  const go = async () => {
    if (!Billing.available() || billing) return;
    billing = new Billing(window.CdvPurchase, CONFIG.products, {
      onChange: () => refreshEntitlement(),
      onTip: () => ((settingsMsg = t(lang, "tipThanks")), renderSettings()),
      onError: (e) => console.warn("billing", e?.code, e?.message),
    });
    await billing.start().catch((e) => console.warn("billing", e));
    refreshEntitlement();
  };
  document.addEventListener("deviceready", go, { once: true });
  go();
  onResume(() => billing?.cdv.store.update?.().then(refreshEntitlement).catch(() => {}));
}

function renderSettings() {
  if ($("settings").hidden) return;
  $("settings-body").replaceChildren(
    ...settingsPanel(lang, {
      platform: CONFIG.platform,
      pro: entitlement,
      catalogue: billing?.ready ? billing.catalogue() : billing?.failed ? [] : null,
      message: settingsMsg,
      onBuy: async (id) => {
        settingsMsg = "";
        try {
          await billing.buy(id);
        } catch (e) {
          settingsMsg = t(lang, "proError", { error: e.message });
        }
        await refreshEntitlement();
        if (entitlement.pro && CONFIG.products.find((p) => p.id === id)?.pro) settingsMsg = t(lang, "proThanks");
        renderSettings();
      },
      onRestore: async () => {
        await billing?.restore().catch(() => {});
        refreshEntitlement();
      },
      onManage: () => billing?.manage(),
      onTrips: () => {
        openSheet("trips");
        fillArrivals();
        renderTrips();
      },
      alerts: appNative.available() ? { on: alertsOn, onToggle: () => setAlerts(!alertsOn) } : null,
      onCommute: () => {
        openSheet("commute");
        renderCommute();
      },
      onReplay: replaySource() ? () => startReplay() : null,
      onExport: () =>
        exportFile(backupName(), makeBackup({ favourites: favs, trips, settings: { lang: store.get("lang"), basemap: store.get("basemap") } })).catch((e) => {
          settingsMsg = t(lang, "proError", { error: e.message });
          renderSettings();
        }),
      onImport: async (file) => {
        try {
          const b = parseBackup(await file.text());
          const m = mergeFavourites(favs, b.favourites, favLimit());
          saveFavourites(m.list);
          if (b.trips.length) saveTrips(mergeTrips(trips, b.trips));
          for (const [k, v] of Object.entries(b.settings)) store.set(k, v);
          settingsMsg = t(lang, "backupDone", { added: m.added }) + (m.skipped ? t(lang, "backupSkipped", { skipped: m.skipped, limit: favLimit() }) : "");
        } catch (e) {
          settingsMsg = t(lang, "backupBad", { why: e.message });
        }
        renderSettings();
      },
      onDelete: async () => {
        if (!window.confirm(t(lang, "deleteConfirm"))) return;
        await prefs.clear();
        location.reload();
      },
    }),
  );
}

/** "I'm on this train" in a train popup (Android): Pro logs the trip, the
 * free edition opens the Pro screen. */
function tripButton(info) {
  const on = !!activeTrip(trips, info.number);
  return {
    on,
    pro: CONFIG.pro,
    onToggle: () => {
      if (!CONFIG.pro) {
        openSheet("settings");
        return renderSettings();
      }
      if (on) {
        const t = activeTrip(trips, info.number);
        saveTrips(trips.map((x) => (x === t ? { ...x, endedAt: Date.now() } : x)));
      } else {
        logTrip(info, "manual");
      }
      showPopup(true);
    },
  };
}

function logTrip(info, how) {
  const i = engine.findTrain(info.trip_id, info.number);
  const route = i >= 0 ? JSON.parse(engine.tripJson(i)) : null;
  const next = startTrip(trips, info, route, Date.now(), how);
  if (next !== trips) saveTrips(next);
}

function saveTrips(list) {
  trips = list;
  prefs.set(TRIPS_KEY, serializeTrips(list)).catch((e) => console.warn("trips", e));
  renderTrips();
}

/**
 * Trips that ended without the app seeing the arrival (it was closed):
 * ask the history server, which records every run. At most every 10 min.
 */
let lastArrivalLookup = 0;
async function fillArrivals(now = Date.now()) {
  if (!CONFIG.pro || !CONFIG.apiBase || now - lastArrivalLookup < 10 * 60_000) return;
  const pending = trips.filter((t) => needsArrival(t, now));
  if (!pending.length) return;
  lastArrivalLookup = now;
  const found = new Map();
  for (const trainNo of new Set(pending.map((t) => t.trainNo))) {
    try {
      const r = await histApi.get("train", trainNo, 4, { today: true });
      for (const t of pending.filter((x) => x.trainNo === trainNo)) {
        const run = runForTrip(t, r.runs || []);
        // Not recorded yet (the server writes a run once it's over): ask
        // again later, unless the trip ended more than a day ago.
        const u = completeFromRun(t, run, { final: !!run || now - t.endedAt > 86_400_000 });
        if (u !== t) found.set(t.id, u);
      }
    } catch (e) {
      console.warn("arrival lookup", trainNo, e);
    }
  }
  if (found.size) {
    saveTrips(trips.map((t) => found.get(t.id) || t));
  }
}

/** Follow the trips in progress (every ~15 s). */
function trackTrips(now) {
  if (!CONFIG.pro || now - lastTripCheck < 15_000 || !trips.some((t) => !t.endedAt)) return;
  lastTripCheck = now;
  let changed = false;
  const next = trips.map((t) => {
    if (t.endedAt) return t;
    const u = updateTrip(t, liveTrain(t.trainNo), now);
    changed ||= u !== t && JSON.stringify(u.stops) + u.endedAt + u.lastDelayMin !== JSON.stringify(t.stops) + t.endedAt + t.lastDelayMin;
    return u;
  });
  if (changed) saveTrips(next);
  else trips = next;
  if (next.some((t) => needsArrival(t, now))) fillArrivals(now);
}

/** A problem exporting from My trips, shown at the top of the sheet. */
let tripsMsg = "";
function exportProblem(e) {
  const why = e?.message || String(e);
  if (/cancel/i.test(why)) return; // the user closed the share sheet
  console.warn("export", e);
  tripsMsg = t(lang, "exportError", { error: why });
  renderTrips();
}

function renderTrips() {
  if ($("trips").hidden) return;
  const body = [];
  if (claimFor) body.push(...claimBox(lang, claimText(lang, claimFor), CLAIMS_URL[lang] || CLAIMS_URL.es, async () => {
    if (!(await copyText(claimText(lang, claimFor)))) share({ title: claimFor.label, text: claimText(lang, claimFor) });
  }));
  body.push(
    ...tripsPanel(lang, {
      trips,
      stats: monthlyStats(trips),
      message: tripsMsg,
      onClaim: (t) => {
        claimFor = t;
        renderTrips();
        $("trips").scrollTop = 0;
      },
      onCard: async (tr) => {
        tripsMsg = "";
        try {
          const png = await tripCard(lang, tr);
          if (!png) throw new Error("the image couldn't be drawn");
          await exportBlob(`trainradar-${tr.day}-${tr.trainNo}.png`, png);
        } catch (e) {
          exportProblem(e);
        }
      },
      onDelete: (t) => {
        if (claimFor?.id === t.id) claimFor = null;
        saveTrips(trips.filter((x) => x.id !== t.id));
      },
      onCsv: () => {
        tripsMsg = "";
        if (!trips.some((x) => x.endedAt)) {
          tripsMsg = t(lang, "tripsCsvEmpty");
          return renderTrips();
        }
        exportFile(`trainradar-trips-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`, tripsCsv(trips, lang), "text/csv").catch(exportProblem);
      },
      onDeleteAll: () => {
        if (!window.confirm(t(lang, "tripsDeleteConfirm"))) return;
        claimFor = null;
        saveTrips([]);
      },
    }),
  );
  $("trips-body").replaceChildren(...body);
}

function openHistory(view) {
  historyView = view;
  stationPop?.remove();
  openSheet("history");
  renderHistory();
}

async function renderHistory() {
  if ($("history").hidden || !historyView) return;
  const v = historyView;
  const ranges = RANGES.map((days) => ({ days, locked: days > FREE_DAYS && !CONFIG.pro }));
  const draw = (state, series = [], runs = []) =>
    $("history-body").replaceChildren(
      ...historyPanel(lang, {
        title: v.title,
        series,
        runs,
        days: v.days,
        ranges,
        state,
        since: CONFIG.historySince,
        sinceShort: rangeBefore(CONFIG.historySince, v.days),
        officialUrl: renfeOfficialUrl(v.kind === "station" ? null : v.product),
        onRange: (days) => {
          historyView = { ...v, days };
          renderHistory();
        },
        onPro: () => {
          if (CONFIG.platform === "android") {
            openSheet("settings");
            renderSettings();
          } else if (CONFIG.playUrl) {
            window.open(CONFIG.playUrl, "_blank", "noopener");
          }
        },
      }),
    );
  draw("loading");
  try {
    if (v.kind === "station") {
      const r = await histApi.get("station", v.id, v.days);
      if (historyView === v) draw("ok", dailySeries(r.days));
    } else {
      // A train found by number (not on the map): its line from its runs.
      const train = await histApi.get("train", v.trainNo, v.days);
      const last = (train.runs || []).at(-1);
      const lineId = v.line || last?.line;
      const product = v.product || last?.product || null;
      const line = lineId ? await histApi.get("line", lineId, v.days) : { days: [] };
      if (historyView === v) draw("ok", dailySeries(line.days, product), train.runs || []);
    }
  } catch {
    if (historyView === v) draw("error");
  }
}

function saveCommutes(next, redraw = () => {}, open = false) {
  commutes = next;
  prefs.set(COMMUTE_KEY, serializeCommutes(next)).catch(() => {});
  redraw();
  if (open) {
    openSheet("commute");
    renderCommute();
  }
}

/** Commute mode (Pro): next trains between the two saved stations. */
function renderCommute() {
  if ($("commute").hidden || !engine) return;
  const note = commuteNote;
  commuteNote = "";
  const c = activeCommute(commutes);
  const from = c?.from || null;
  const to = c?.to || null;
  // Their Cercanías timetables may not be loaded yet: load, then redraw.
  for (const st of [from, to].filter(Boolean)) {
    const d = 0.05;
    for (const r of ref?.regionsIn([st.lon - d, st.lat - d, st.lon + d, st.lat + d]) || []) {
      if (!ref.loaded.has(r.code)) ref.loadRegion(r.code).then(renderCommute).catch(() => {});
    }
  }
  const rows = from && to ? JSON.parse(engine.commuteJson(from.id, to.id, Date.now(), 3 * 3600, 8)) : [];
  $("commute-body").replaceChildren(
    ...commutePanel(lang, {
      from,
      to,
      rows,
      list: commutes.list,
      active: commutes.active,
      draft: commutes.draft,
      note,
      onSelect: (i) => {
        saveCommutes(selectCommute(commutes, i));
        renderCommute();
      },
      onTrain: (r) => {
        const info = liveTrain(r.number);
        if (info) {
          $("commute").hidden = true;
          selectTrain(info, { fly: true });
        }
      },
      onSwap: () => {
        saveCommutes(swapActive(commutes));
        renderCommute();
      },
      onClear: () => {
        saveCommutes(removeActive(commutes));
        renderCommute();
      },
    }),
  );
}

/** Star button state for a popup; `redraw` refreshes that popup. */
function favButton(item, redraw = () => showPopup(true)) {
  const k = JSON.stringify([item.type, item.number ?? item.id]);
  return {
    on: isFavourite(favs, item),
    full: favFull === k,
    limit: favLimit(),
    onToggle: () => {
      const r = toggleFavourite(favs, item, favLimit());
      favFull = r.full ? k : null;
      if (!r.full) saveFavourites(r.list);
      redraw();
    },
  };
}

function saveFavourites(list) {
  favs = list;
  prefs
    .set(STORAGE_KEY, JSON.stringify(list))
    .then(() => appNative.refreshWidget())
    .catch((e) => console.warn("favourites", e));
  renderFavourites();
}

/** The live train for a favourite (by number), as popup info, or null. */
function liveTrain(number) {
  if (!engine) return null;
  const n = String(number).replace(/^0+/, "");
  const hit = JSON.parse(engine.searchJson(number, 8)).find((h) => h.number.replace(/^0+/, "") === n);
  return hit ? JSON.parse(engine.trainJson(hit.i, Date.now())) : null;
}

function openStation(st) {
  flyToVisible(st.lon, st.lat, 13, { forPopup: true });
  map.once("moveend", () => showStation({ properties: { id: st.id, name: st.name }, geometry: { coordinates: [st.lon, st.lat] } }));
}

function renderFavourites() {
  if ($("favs").hidden) return;
  $("favs-body").replaceChildren(
    ...favouritesPanel(lang, favs, {
      trainInfo: (f) => liveTrain(f.number),
      onTrain: (info) => {
        $("favs").hidden = true;
        selectTrain(info, { fly: true });
      },
      onStation: (st) => {
        $("favs").hidden = true;
        openStation(st);
      },
      onRemove: (f) => saveFavourites(toggleFavourite(favs, f).list),
      limit: favLimit(),
    }),
  );
}

/** Open what a link asks for (app link or the web's ?train= / ?station=). */
function openLink(link) {
  if (!link || !engine) return;
  if (link.type === "train") {
    const info = liveTrain(link.number);
    if (info) return selectTrain(info, { fly: true });
    $("search-q").value = link.number; // not running now: show what search finds
    return renderSearch();
  }
  const st = JSON.parse(engine.stationsGeoJson()).features.find((x) => x.properties.id === link.id);
  if (st) openStation({ id: st.properties.id, name: st.properties.name, lon: st.geometry.coordinates[0], lat: st.geometry.coordinates[1] });
}

/** Android back button: close the top-most thing; false when nothing was open. */
function goBack() {
  if (isPhone() && sheets.back()) return true;
  const sheet = SHEETS.map($).find((x) => !x.hidden);
  if (sheet) return (sheet.hidden = true), true;
  if (popup) return popup.remove(), true;
  if (stationPop?.isOpen()) return stationPop.remove(), true;
  if (!$("search-results").hidden) return ($("search-results").hidden = true), true;
  if (replayPop?.isOpen()) return replayPop.remove(), true;
  if (replay) return stopReplay(), true;
  return false;
}

function renderSearch() {
  const q = $("search-q").value.trim();
  const ul = $("search-results");
  if (!q || !engine) {
    ul.hidden = true;
    return;
  }
  const hits = JSON.parse(engine.searchJson(q, 8));
  ul.hidden = false;
  // Phone: stations too ("Buscar tren, línea o estación").
  const stationRows = isPhone()
    ? searchStations(q).map((st) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              class: "link search-station",
              onclick: () => {
                ul.hidden = true;
                $("search-q").value = "";
                $("search-q").blur();
                openStation(st);
              },
            },
            icon("pin", 16),
            el("strong", {}, st.name),
            el("span", { class: "muted" }, ` · ${t(lang, "searchStation")}`),
          ),
        ),
      )
    : [];
  // A train number that isn't on the map now: its history (Pro, app).
  const n = /^\d{2,6}$/.test(q) ? q.replace(/^0+/, "") : "";
  const offMap = n && !hits.some((h) => h.number.replace(/^0+/, "") === n) && CONFIG.platform === "android" && CONFIG.apiBase;
  const offRow = !offMap
    ? null
    : CONFIG.pro
      ? el(
          "li",
          {},
          el(
            "button",
            {
              class: "link",
              id: "search-history",
              onclick: () => {
                ul.hidden = true;
                $("search-q").value = "";
                openHistory({ kind: "train", trainNo: n, line: null, product: null, title: t(lang, "searchTrainTitle", { n }), days: FREE_DAYS });
              },
            },
            el("strong", {}, t(lang, "searchTrainTitle", { n })),
            ` · ${t(lang, "searchNotRunning")}`,
          ),
        )
      : el(
          "li",
          {},
          el(
            "button",
            {
              class: "link muted",
              id: "search-history-pro",
              onclick: () => {
                ul.hidden = true;
                openSheet("settings");
                renderSettings();
              },
            },
            t(lang, "searchNotRunningPro", { n }),
          ),
        );
  if (!hits.length && !stationRows.length) return ul.replaceChildren(...(offRow ? [offRow] : [el("li", { class: "muted" }, t(lang, "searchNone"))]));
  ul.replaceChildren(
    ...hits.map((h) =>
      el(
        "li",
        {},
        el(
          "button",
          {
            class: "link",
            onclick: () => {
              ul.hidden = true;
              $("search-q").value = "";
              selectTrain(JSON.parse(engine.trainJson(h.i, Date.now())), { fly: true });
            },
          },
          el("strong", {}, trainTitle(h)),
          h.destination ? ` → ${h.destination}` : "",
        ),
      ),
    ),
    ...(offRow ? [offRow] : []),
    ...stationRows,
  );
}

/*
 * Phone layout (≤ 719 px, and the Android app): bottom sheets with snap
 * points (js/sheet.js) and an app tab bar instead of the floating buttons.
 * The home sheet is the Delays list, peeking with a summary.
 */
const sheets = new Sheets({
  home: "delayed",
  tabbar: $("tabbar"),
  scrim: $("scrim"),
  onChange: () => updateTabs(),
  onSnap: () => haptic(),
});
for (const id of SHEETS) {
  sheets.add($(id), id === "delayed" ? { initial: "peek", closable: false } : { initial: "half" });
}
// Closing the detail sheet (swipe, Back, ✕, another tab) drops the selection.
new MutationObserver(() => {
  if (!$("detail").hidden) return;
  if (detailKind === "train") clearSelection();
  $("detail-body").replaceChildren();
  detailKind = null;
  stationView = null;
  detailKey = "";
}).observe($("detail"), { attributes: true, attributeFilter: ["hidden"] });
const TABS = [
  ["map", "tabMap", "map"],
  ["near", "tabNear", "pin"],
  ["incidents", "tabNotices", "warning"],
  ["favs", "tabFavs", "star"],
  ["more", "tabMore", "menu"],
];
/** Which tab a sheet belongs to. */
function tabFor(sheet) {
  if (["near", "incidents", "favs"].includes(sheet)) return sheet;
  if (["more", "about", "settings", "trips", "history", "commute"].includes(sheet)) return "more";
  return "map";
}

function buildTabs() {
  const bar = $("tabbar");
  bar.setAttribute("aria-label", t(lang, "tabsLabel"));
  bar.replaceChildren(
    ...TABS.map(([id, key, ic]) =>
      el(
        "button",
        { type: "button", class: "tab", id: `tab-${id}`, onclick: () => tabClick(id) },
        icon(ic),
        el("span", { class: "tab-label" }, t(lang, key)),
        id === "incidents" ? el("span", { class: "tab-badge", id: "tab-incidents-n", hidden: true }) : null,
      ),
    ),
  );
  updateTabs();
  if (engine) renderIncidents();
}

function updateTabs() {
  const active = tabFor(sheets.top());
  for (const [id] of TABS) {
    const b = $(`tab-${id}`);
    if (!b) continue;
    if (id === active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

/** Close every sheet but the home one (the map tab). */
function closeSheets() {
  for (const id of SHEETS) if (id !== "delayed") $(id).hidden = true;
}

function tabClick(id) {
  // Tapping the open tab again goes back to the map; from one of Más's
  // screens (settings, about…) it goes back to the Más menu.
  if (id !== "map" && sheets.top() === id) return closeSheets();
  switch (id) {
    case "map":
      closeSheets();
      popup?.remove();
      stationPop?.remove();
      sheets.setSnap("delayed", "peek");
      break;
    case "near":
      if (locator?.active) {
        openSheet("near");
        renderNear(true);
      } else startLocation();
      break;
    case "incidents":
      showIncidents(defaultNoticeFilter());
      break;
    case "favs":
      openSheet("favs");
      renderFavourites();
      break;
    case "more":
      openSheet("more");
      renderMore();
      break;
  }
}

/** "Más": language, settings (Pro in the app) and About. */
function renderMore() {
  const row = (ic, label, value, onclick, id) =>
    el(
      "li",
      {},
      el(
        "button",
        { type: "button", class: "menu-row", id, onclick },
        icon(ic),
        el("span", { class: "menu-label" }, label),
        value ? el("span", { class: "menu-value" }, value) : null,
        icon("chevronRight", 18),
      ),
    );
  $("more-body").replaceChildren(
    el(
      "ul",
      { class: "menu-list" },
      row("globe", t(lang, "moreLanguage"), t(lang, "moreLanguageValue"), () => $("lang").click(), "more-lang"),
      row("settings", t(lang, CONFIG.platform === "android" ? "moreSettingsPro" : "moreSettings"), "", () => {
        openSheet("settings");
        renderSettings();
      }, "more-settings"),
      row("info", t(lang, "moreAbout"), "", () => {
        openSheet("about");
        renderAbout();
      }, "more-about"),
    ),
  );
}

/** The home sheet's "Delays now": trains 15+, 5–14 min late and on time. */
function renderHomeSummary(st, pos) {
  if (!isPhone()) return;
  const c = [0, 0, 0, 0];
  for (let i = 0; i + 5 < pos.length; i += 6) if (!(pos[i + 5] & FLAG.scheduled)) c[pos[i + 2]] += 1;
  const bucket = (cls, key, n) =>
    el(
      "button",
      { type: "button", class: `bucket bucket-${cls}`, onclick: () => sheets.setSnap("delayed", "half") },
      el("span", { class: "bucket-label" }, t(lang, key)),
      el("span", { class: "bucket-n" }, formatCount(lang, n)),
    );
  $("delayed-summary").replaceChildren(
    el(
      "div",
      { class: "summary-head" },
      el("h2", {}, t(lang, "delayedNow")),
      el("span", { class: "muted" }, t(lang, "delayedOf", { n: formatCount(lang, st.delayed), total: formatCount(lang, st.trains) })),
    ),
    el("div", { class: "buckets" }, bucket("major", "bucketMajor", c[2]), bucket("minor", "bucketMinor", c[1]), bucket("ontime", "bucketOnTime", c[0])),
  );
}

/** Phone top bar and map buttons: icons and labels (once per language). */
function phoneChrome() {
  $("search-icon").replaceChildren(icon("search", 20));
  $("net-chip").replaceChildren(el("span", { id: "net-chip-l" }, netName()), icon("chevronDown", 16));
  $("net-chip").setAttribute("aria-label", t(lang, "netChipLabel", { name: netName() }));
  const dot = (c, label) => el("span", {}, el("i", { style: `background:${c}` }), label);
  $("legend-chip").replaceChildren(dot("#16a34a", "<5"), dot("#ea8a0c", "5–14"), dot("#dc2626", "15+"));
  $("legend-chip").setAttribute("aria-label", t(lang, "legendChipLabel"));
  $("legend-chip").setAttribute("role", "img");
  $("fab-layers").replaceChildren(icon("layers", 22));
  $("fab-layers").setAttribute("aria-label", t(lang, "layers"));
  $("fab-locate").replaceChildren(icon("locate", 22));
  $("fab-locate").setAttribute("aria-label", t(lang, "fabLocate"));
}

/** The network the map shows: the Cercanías núcleo under its centre, else Spain. */
function currentNetwork() {
  if (!map || !ref || map.getZoom() < 7.5) return null;
  const c = map.getCenter();
  return (ref.regionsIn([c.lng, c.lat, c.lng, c.lat]) || []).find((r) => r.code !== "ld" && r.live !== false) || null;
}
const netName = () => currentNetwork()?.name || t(lang, "netSpain");

function updateNetChip() {
  const l = $("net-chip-l");
  if (!l) return;
  const name = netName();
  if (l.textContent !== name) {
    l.textContent = name;
    $("net-chip").setAttribute("aria-label", t(lang, "netChipLabel", { name }));
  }
}

/** "498 trenes · mediana +2 min" with a dot: green live, orange stale, red failing. */
function renderLiveChip(st, now) {
  if (!isPhone()) return;
  const last = feeds?.lastUpdate() || 0;
  const age = last ? (now - last) / 1000 : Infinity;
  const state = feeds?.failing() ? "bad" : age > 120 ? "stale" : "ok";
  const text =
    st.median_delay === null
      ? t(lang, "trains", { n: formatCount(lang, st.trains) })
      : t(lang, "liveChip", { trains: t(lang, "trains", { n: formatCount(lang, st.trains) }), delay: formatDelay(lang, st.median_delay) });
  $("live-text").textContent = text;
  $("live-chip").dataset.state = state;
  $("live-chip").title = state === "bad" ? t(lang, "feedError") : last ? t(lang, "updated", { age: formatAgo(lang, age) }) : t(lang, "loading");
}

/** Interim (until the network sheet): the native "Ir a…" list. */
function openNetworks() {
  const sel = $("jump");
  sel.classList.toggle("jump-open");
  if (sel.classList.contains("jump-open")) sel.focus();
}

/** Stations whose name matches a search (phone), accents ignored. */
let stationIndex = null;
function searchStations(q, limit = 5) {
  const norm = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nq = norm(q);
  if (nq.length < 2 || !engine) return [];
  stationIndex ??= JSON.parse(engine.stationsGeoJson()).features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    key: norm(f.properties.name),
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  const starts = stationIndex.filter((x) => x.key.startsWith(nq));
  const inside = stationIndex.filter((x) => !x.key.startsWith(nq) && x.key.includes(nq));
  return [...starts, ...inside].slice(0, limit);
}

/** A light tick when a sheet snaps (Android app only; phase e). */
function haptic() {}

function renderAbout() {
  $("about-body").replaceChildren(
    ...aboutPanel(lang, {
      playUrl: CONFIG.playUrl,
      coffeeUrl: CONFIG.coffeeUrl,
      platform: CONFIG.platform,
      feedMode: feeds?.mode() || "fallback",
      version: CONFIG.appVersion,
      onSettings: () => {
        openSheet("settings");
        renderSettings();
      },
    }),
  );
}

/** One-time "get the app" banner from the 3rd visit (only with a listing). */
function setupAppBanner() {
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  const visit = countVisit(storage);
  if (!showAppBanner(storage, visit, CONFIG)) return;
  $("app-banner-link").href = CONFIG.playUrl;
  $("app-banner").hidden = false;
  $("app-banner-close").addEventListener("click", () => {
    dismissAppBanner(storage);
    $("app-banner").hidden = true;
  });
}

/** The Delays list's filter (Pro): "" = all trains, else a saved commute
 * as "fromId>toId". Remembered on this device. */
const DELAYED_FILTER_KEY = "delayed-filter";

function renderDelayedList() {
  // Pro with saved commutes: "All" or one commute's trains only.
  const choices = CONFIG.pro ? commutes.list : [];
  let filter = store.get(DELAYED_FILTER_KEY) || "";
  let only = choices.find((c) => `${c.from.id}>${c.to.id}` === filter) || null;
  if (!only) filter = "";
  const bar = $("delayed-filter");
  bar.hidden = !choices.length;
  if (choices.length) {
    const pick = (v) => () => {
      store.set(DELAYED_FILTER_KEY, v);
      renderDelayedList();
    };
    const chip = (label, v) =>
      el("button", { class: v === filter ? "pill small pill-strong" : "pill small", type: "button", "aria-pressed": String(v === filter), onclick: pick(v) }, label);
    bar.replaceChildren(
      chip(t(lang, "delayedAll"), ""),
      ...choices.map((c) => chip(`${c.from.name} → ${c.to.name}`, `${c.from.id}>${c.to.id}`)),
    );
  }
  const list = JSON.parse(only ? engine.delayedBetweenJson(Date.now(), 50, only.from.id, only.to.id) : engine.delayedJson(Date.now(), 50));
  const ul = $("delayed-list");
  if (!list.length) {
    ul.replaceChildren(el("li", { class: "muted" }, only ? t(lang, "noDelaysCommute", { from: only.from.name, to: only.to.name }) : t(lang, "noDelays")));
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
  if (!engine || !map || replay) return; // the replay draws the trains meanwhile
  const now = Date.now();
  const interval = map.getZoom() >= 10 ? 250 : 1000;
  if (!force && now - lastRender < interval) return;
  lastRender = now;
  if (selected) updateRoute();
  const pos = engine.positions(now);
  map.getSource("trains")?.setData(trainsGeoJson(pos, highlight, hiddenByFilter));
  const st = JSON.parse(engine.statsJson(now));
  renderHomeSummary(st, pos);
  renderLiveChip(st, now);
  $("stats").textContent =
    statsText(lang, st) + (st.scheduled ? ` ${t(lang, "scheduledCount", { n: st.scheduled })}` : "");
  const last = feeds?.lastUpdate() || 0;
  $("status").textContent = feeds?.failing()
    ? t(lang, "feedError")
    : last
      ? t(lang, "updated", { age: formatAgo(lang, (now - last) / 1000) })
      : t(lang, "loading");
  if ((popup || selected) && map.getSource("selected")) showPopup();
  if (force && detailKind === "station" && stationView && !$("detail").hidden) showStation(stationView, { refresh: true });
  if (!$("delayed").hidden && force) renderDelayedList();
  renderNear(force);
  if (force) {
    renderFavourites();
    renderCommute();
  }
  trackTrips(now);
  checkAlertsLive(now);
}

/**
 * Replay (TrainRadar Pro): the map shows where every train was at a past
 * moment, from the recorder's minute-by-minute files; play, pause, speed,
 * pick a day and time. Live drawing stops until "Back to live".
 */
let replay = null; // { data, t (ms), playing, speed, since, last, busy }
const REPLAY_SPEEDS = [1, 10, 60, 300];

const replaySource = () => CONFIG.replayBase || replayRoot(CONFIG.liveBase);

async function startReplay() {
  if (!CONFIG.pro || !replaySource()) return;
  for (const id of SHEETS) $(id).hidden = true;
  popup?.remove();
  stationPop?.remove();
  const data = new ReplayData(replaySource());
  replay = { data, t: Date.now() - 3_600_000, playing: false, speed: 60, since: null, last: 0, busy: false, trains: [] };
  document.body.classList.add("replaying");
  $("replay-bar").hidden = false;
  renderReplayBar();
  drawReplay();
  const first = await data.first();
  if (replay?.data === data && first?.hour) {
    replay.since = Date.parse(`${first.hour}:00:00Z`);
    if (replay.t < replay.since) {
      // Recording began part-way through that hour: start at its first frame.
      const doc = await data.hour(first.hour);
      if (replay?.data !== data) return;
      replay.since = doc?.frames?.[0] ? doc.frames[0][0] * 1000 : replay.since;
      replay.t = replay.since;
    }
    renderReplayBar();
    drawReplay();
  }
}

function stopReplay() {
  replay = null;
  replayPop?.remove();
  document.body.classList.remove("replaying");
  $("replay-bar").hidden = true;
  render(true);
}

let replayPop = null;
async function drawReplay() {
  if (!replay) return;
  if (replay.busy) {
    replay.again = true; // draw the latest time once this one is done
    return;
  }
  replay.busy = true;
  const r = replay;
  const trains = await r.data.at(r.t).catch(() => []);
  r.busy = false;
  if (replay !== r) return;
  if (r.again) {
    r.again = false;
    drawReplay();
    return;
  }
  r.trains = trains;
  map.getSource("trains")?.setData(replayGeoJson(trains));
  const { date, time } = msToMadrid(r.t);
  const day = date.split("-").reverse().slice(0, 2).join("/");
  $("stats").textContent = t(lang, "replayStats", { date: day, time, n: trains.length, late: trains.filter((x) => x.delay >= 300).length });
  const since = r.since ? msToMadrid(r.since) : null;
  $("status").textContent = trains.length
    ? since
      ? t(lang, "replaySince", { date: `${since.date.split("-").reverse().join("/")} ${since.time}` })
      : ""
    : `${t(lang, "replayNoData")}${since ? ` ${t(lang, "replaySince", { date: `${since.date.split("-").reverse().join("/")} ${since.time}` })}` : ""}`;
  const slider = $("replay-slider");
  if (slider && document.activeElement !== slider) {
    const [h, m] = time.split(":").map(Number);
    slider.value = String(h * 60 + m);
  }
  const dIn = $("replay-date");
  if (dIn && document.activeElement !== dIn) dIn.value = date;
  const tIn = $("replay-time");
  if (tIn && document.activeElement !== tIn) tIn.value = time;
}

function setReplayTime(ms) {
  if (!replay) return;
  const max = Date.now() - 60_000;
  replay.t = Math.max(replay.since || 0, Math.min(ms, max));
  const stopped = replay.playing && replay.t >= max;
  if (stopped) replay.playing = false;
  replayPop?.remove();
  drawReplay();
  // Rebuilding the bar would drop the slider out from under a dragging
  // finger: drawReplay updates its controls instead.
  if (stopped) renderReplayBar();
}

function renderReplayBar() {
  if (!replay) return;
  const { date, time } = msToMadrid(replay.t);
  const today = msToMadrid(Date.now()).date;
  const min = replay.since ? msToMadrid(replay.since).date : CONFIG.historySince;
  const [h, m] = time.split(":").map(Number);
  $("replay-bar").replaceChildren(
    el(
      "div",
      { class: "row" },
      el("strong", { class: "grow" }, `⏪ ${t(lang, "replayTitle")}`),
      el("button", { class: "pill small", type: "button", id: "replay-live", onclick: stopReplay }, t(lang, "replayLive")),
    ),
    el(
      "div",
      { class: "row" },
      el("input", { type: "date", id: "replay-date", value: date, min, max: today, "aria-label": t(lang, "replayDate"), onchange: (e) => e.target.value && setReplayTime(madridToMs(e.target.value, $("replay-time").value || time)) }),
      el("input", { type: "time", id: "replay-time", value: time, "aria-label": t(lang, "replayTime"), onchange: (e) => e.target.value && setReplayTime(madridToMs($("replay-date").value || date, e.target.value)) }),
      el(
        "button",
        {
          class: "pill small pill-strong",
          type: "button",
          id: "replay-play",
          "aria-label": t(lang, replay.playing ? "replayPause" : "replayPlay"),
          onclick: () => {
            replay.playing = !replay.playing;
            replay.last = performance.now();
            renderReplayBar();
          },
        },
        replay.playing ? "⏸" : "▶",
      ),
      ...REPLAY_SPEEDS.map((x) =>
        el(
          "button",
          {
            class: "pill small",
            type: "button",
            "aria-pressed": String(replay.speed === x),
            onclick: () => {
              replay.speed = x;
              renderReplayBar();
            },
          },
          `×${x}`,
        ),
      ),
    ),
    el(
      "div",
      { class: "row" },
      el("input", {
        type: "range",
        id: "replay-slider",
        min: "0",
        max: "1439",
        step: "1",
        value: String(h * 60 + m),
        "aria-label": t(lang, "replayTime"),
        oninput: (e) => {
          const v = Number(e.target.value);
          setReplayTime(madridToMs($("replay-date").value || date, `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`));
        },
      }),
    ),
  );
}

/** Advance a playing replay (called every frame). */
function tickReplay() {
  if (!replay) return;
  const now = performance.now();
  if (replay.playing) {
    const dt = replay.last ? now - replay.last : 0;
    replay.last = now;
    if (dt > 0) {
      const before = replay.t;
      replay.t = Math.min(replay.t + dt * replay.speed, Date.now() - 60_000);
      if (replay.t === before) {
        replay.playing = false;
        renderReplayBar();
      }
    }
    // Redraw a few times a second, not every frame.
    if (now - (replay.drawn || 0) > 200) {
      replay.drawn = now;
      drawReplay();
    }
  }
}

/** A tapped train in the replay: what it was and how late, at that moment. */
function showReplayTrain(i) {
  const tr = replay?.trains?.[i];
  if (!tr) return;
  const title = [tr.route, tr.number.replace(/^0+/, "")].filter(Boolean).join(" ");
  const delay = tr.delay === null ? "—" : formatDelay(lang, tr.delay);
  replayPop?.remove();
  replayPop = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 12, focusAfterOpen: false })
    .setLngLat([tr.lon, tr.lat])
    .setDOMContent(
      el(
        "div",
        { class: "popup" },
        el("div", { class: "popup-title" }, title),
        tr.dest ? el("div", { class: "small" }, `→ ${tr.dest}`) : null,
        el("div", {}, el("strong", {}, delay), ` ${t(lang, "replayTrainAt", { time: msToMadrid(replay.t).time })}`),
      ),
    )
    .addTo(map);
}

function loop() {
  tickReplay();
  if (document.visibilityState === "visible") render();
  requestAnimationFrame(loop);
}

function loadVisibleRegions() {
  if (!ref?.manifest || map.getZoom() < CONFIG.regionZoom) return;
  const b = map.getBounds();
  for (const r of ref.regionsIn([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])) {
    ref
      .loadRegion(r.code)
      .then(refreshLines)
      .catch((e) => console.warn("region", r.code, e));
  }
}

async function main() {
  applyLang();
  sheets.apply(); // phone: the home sheet peeks from the start
  ({ map, attr } = createMap("map", CONFIG, t(lang, "attribution")));
  const mapReady = new Promise((r) => map.on("load", r));

  await init();
  engine = new Engine();
  ref = new RefData(engine, CONFIG.dataBase);
  ref.onGeometry = () => {
    refreshLines();
    refreshTrack();
  };
  try {
    await ref.start();
  } catch (e) {
    console.error(e);
    $("status").textContent = t(lang, "loadError");
    setTimeout(() => location.reload(), 30_000);
    return;
  }
  feeds = new Feeds(engine, CONFIG.rtBase, {
    live: CONFIG.liveBase,
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
  if (window.innerWidth < 720) map.once("idle", foldCredits);
  if (store.get("basemap") === "satellite") {
    setBasemap(map, "satellite");
    document.querySelector('input[name="basemap"][value="satellite"]').checked = true;
  }
  setUserLayers();
  map.getSource("stations").setData(JSON.parse(engine.stationsGeoJson()));
  map.on("moveend", loadVisibleRegions);
  map.on("moveend", updateNetChip);
  map.on("click", (e) => {
    const pad = 10; // generous tap target on phones
    if (replay) {
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: ["trains"] },
      )[0];
      if (hit) showReplayTrain(hit.properties.i);
      else replayPop?.remove();
      return;
    }
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
      const st = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: ["stations", "stations-ld"].filter((l) => map.getLayer(l)) },
      );
      if (st.length) return showStation(st[0]);
      stationPop?.remove();
      if (isPhone()) $("detail").hidden = true;
      return clearSelection();
    }
    const info = JSON.parse(engine.trainJson(hits[0].properties.i, Date.now()));
    selectTrain(info);
  });
  renderIncidents();
  fillJump();
  refreshLines();
  // After the first view: the other núcleos' timetables, so distant
  // Cercanías trains show their delay colour and direction too.
  setTimeout(() => ref.loadAllInBackground(() => {
    refreshLines();
    render(true);
  }), 3000);
  map.on("mouseenter", "incidents", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "incidents", () => (map.getCanvas().style.cursor = ""));
  for (const l of ["stations", "stations-ld"]) {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  }
  refreshTrack();
  map.on("mouseenter", "trains", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "trains", () => (map.getCanvas().style.cursor = ""));
  render(true);
  requestAnimationFrame(loop);
  // For tests and debugging (the app's emulator test shares a file with these).
  window.__trainradar = { engine, map, ref, feeds, exportFile, exportBlob, tripCard };
  // Links: the web's ?train= / ?station=, and the app's trainradar://… Wait
  // for the first trains so a train link finds its train.
  const whenTrains = () =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const check = () => (engine.positions(Date.now()).length || Date.now() - t0 > 20_000 ? resolve() : setTimeout(check, 500));
      check();
    });
  const first = parseLink(location.href);
  if (first) whenTrains().then(() => openLink(first));
  // Commute mode (Pro): open on the next trains of the saved commute.
  else
    whenTrains().then(() => {
      if (CONFIG.pro && activeCommute(commutes) && (isPhone() ? !sheets.top() : SHEETS.every((x) => $(x).hidden))) {
        openSheet("commute");
        renderCommute();
      }
    });
  onAppLink((url) => whenTrains().then(() => openLink(parseLink(url))));
}

$("about-btn").addEventListener("click", () => {
  if ($("about").hidden) {
    openSheet("about");
    renderAbout();
  } else $("about").hidden = true;
});
$("about-close").addEventListener("click", () => ($("about").hidden = true));
$("fav-btn").addEventListener("click", () => {
  if ($("favs").hidden) {
    openSheet("favs");
    renderFavourites();
  } else $("favs").hidden = true;
});
$("favs-close").addEventListener("click", () => ($("favs").hidden = true));
$("settings-close").addEventListener("click", () => ($("settings").hidden = true));
startBilling();
prefs
  .get(STORAGE_KEY)
  .then((v) => {
    favs = parseFavourites(v);
    renderFavourites();
  })
  .catch(() => {});
prefs
  .get(COMMUTE_KEY)
  .then((v) => {
    commutes = parseCommutes(v);
  })
  .catch(() => {});
prefs
  .get(ALERT_CONFIG_KEY)
  .then((v) => {
    alertsOn = !!JSON.parse(v || "{}").enabled;
  })
  .catch(() => {});
prefs
  .get(TRIPS_KEY)
  .then((v) => {
    trips = parseTrips(v);
    // Once Pro is known: arrivals missed while the app was closed.
    setTimeout(() => fillArrivals(), 5000);
  })
  .catch(() => {});
onResume(() => fillArrivals());
$("history-close").addEventListener("click", () => ($("history").hidden = true));
$("commute-close").addEventListener("click", () => ($("commute").hidden = true));
$("trips-close").addEventListener("click", () => {
  $("trips").hidden = true;
  claimFor = null;
});
onBackButton(goBack);
styleStatusBar();
setupAppBanner();
$("lang").addEventListener("click", () => {
  lang = lang === "es" ? "en" : "es";
  store.set("lang", lang);
  applyLang();
  sheets.apply();
  if (alertsOn) writeAlertConfig();
});
$("delayed-btn").addEventListener("click", () => {
  const panel = $("delayed");
  if (panel.hidden) {
    openSheet("delayed");
    renderDelayedList();
  } else panel.hidden = true;
});
$("delayed-close").addEventListener("click", () => ($("delayed").hidden = true));
$("more-close").addEventListener("click", () => ($("more").hidden = true));
$("net-chip").addEventListener("click", () => openNetworks());
$("fab-layers").addEventListener("click", () => {
  const d = $("layers");
  d.open = !d.open;
});
$("fab-locate").addEventListener("click", () => {
  if (!locator?.active) return startLocation();
  if (userFix) flyToVisible(userFix.lon, userFix.lat, 13);
  else {
    openSheet("near");
    renderNear(true);
  }
});
matchMedia("(max-width: 719px)").addEventListener?.("change", () => applyLang());
$("jump").addEventListener("change", (e) => {
  const v = e.target.value;
  e.target.value = "";
  e.target.classList.remove("jump-open");
  if (v === "es") return map.flyTo({ center: CONFIG.center, zoom: CONFIG.zoom });
  const r = ref?.region(v);
  if (r) map.fitBounds([[r.bbox[1], r.bbox[0]], [r.bbox[3], r.bbox[2]]], { padding: 40, maxZoom: 11 });
});
function applyLayerVisibility() {
  if (!map?.getLayer("trains")) return;
  const on = new Set();
  for (const [key, ids] of Object.entries(LAYER_IDS)) if (show[key]) for (const id of ids) on.add(id);
  for (const ids of Object.values(LAYER_IDS)) {
    for (const id of ids) {
      const visible = on.has(id);
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }
}
for (const key of Object.keys(KINDS)) {
  $(`f-k-${key}`).addEventListener("change", (e) => {
    showKind[key] = e.target.checked;
    renderIncidents();
  });
}
for (const key of ["commuter", "av", "ld", "md", "scheduled", "lines", "tav", "tld", "tmd", "stations", "stopped"]) {
  $(`f-${key}`).addEventListener("change", (e) => {
    show[key] = e.target.checked;
    applyLayerVisibility();
    render(true);
  });
}
for (const r of document.querySelectorAll('input[name="basemap"]')) {
  r.addEventListener("change", (e) => {
    if (!e.target.checked || !map?.getLayer("track-av")) return;
    setBasemap(map, e.target.value);
    store.set("basemap", e.target.value);
  });
}
$("search-q").addEventListener("input", renderSearch);
$("search-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("search-results").querySelector("button")?.click();
  if (e.key === "Escape") {
    e.target.value = "";
    renderSearch();
  }
});
$("loc-btn").addEventListener("click", () => (locator?.active ? stopLocation() : startLocation()));
$("near-close").addEventListener("click", () => ($("near").hidden = true));
$("inc-btn").addEventListener("click", () => ($("incidents").hidden ? showIncidents(defaultNoticeFilter()) : ($("incidents").hidden = true)));
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
// Not in the app: its files are already on the phone.
if ("serviceWorker" in navigator && !isNative() && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker", e));
}
