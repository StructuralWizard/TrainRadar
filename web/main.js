// TrainRadar web app. Everything runs here in the browser: the engine
// (WebAssembly) decodes Renfe's feeds, matches trains to the timetable and
// works out delays, positions and spacing.
import init, { Engine } from "./pkg/engine.js";
import { CONFIG } from "./js/config.js";
import { COUNTRY_INFO, COUNTRY_KEY, applyCountry, areaKey, areaName, areasOf, pickCountry, viewKey, withPlaces } from "./js/country.js";
import { RefData } from "./js/data.js";
import { Feeds } from "./js/feeds.js";
import { formatAgo, formatCount, formatDelay, formatDistance, formatMedian, trainLabel } from "./js/format.js";
import { Sheets, isPhone } from "./js/sheet.js";
import { COMMUNITIES, PROVINCES, cityBox, fold, parseRoute, placeByCode, searchPlaces } from "./js/places.js";
import { icon } from "./js/icons.js";
import { keepLongDistance } from "./js/board.js";
import { NOTICE_KINDS, noticeLabel, noticeText } from "./js/notice.js";
import { REPORT_COUNTRIES, REPORT_KINDS, UNDO_MS, monthlyToken, nonceText, placeCheck, reportResolved, sha256b64, trainReports } from "./js/reports.js";
import { PLACE_ICON, cabTrain, cabVideos, journeyResults, layersSheet, lineBadge, networksSheet, pickField, placeKind, stationSheet, trainDayList, trainSheet, whenField } from "./js/sheetui.js";
import { loadRides, ridesGeoJson, videoForTrain, videosAt } from "./js/cabrides.js";
import { endStations } from "./js/route.js";
import { Planner } from "./js/planner.js";
import { Locator, circlePolygon } from "./js/location.js";
import { LANGS, pickLang, t } from "./js/i18n.js";
import { ARROW_ZOOM, FLAG, SERVICE_COLORS, OVERVIEW_ZOOM, addCountries, addLayers, addOverview, overviewNetwork, scheduledNow, createMap, emptyGeoJson, maplibregl, pointGeoJson, setBasemap, setMapLanguage, trainsGeoJson, TRACK_OPACITY } from "./js/map.js";
import { formatClock, setTimeZone } from "./js/format.js";
import { countVisit, dismissAppBanner, showAppBanner } from "./js/visits.js";
import { ReplayData, madridToMs, msToMadrid, replayGeoJson, replayRoot } from "./js/replay.js";
import { FREE_DAYS, HistoryApi, HistoryCache, RANGES, dailySeries, rangeBefore, renfeOfficialUrl } from "./js/history.js";
import { FREE_LIMIT, STORAGE_KEY, favKey, favouritesInOrder, isFavourite, moveFavourite, neighbourFavourite, parseFavourites, toggleFavourite } from "./js/favourites.js";
import { decodeView, encodeView } from "./js/lastview.js";
import { appNative, canShare, copyText, exportBlob, exportFile, haptic as nativeHaptic, isNative, onAppLink, onBackButton, onResume, parseLink, prefs, share, shortcutLink, styleStatusBar } from "./js/native.js";
import { backupName, makeBackup, mergeFavourites, mergeTrips, parseBackup } from "./js/backup.js";
import { Billing, ENTITLEMENT_KEY } from "./js/billing.js";
import { decide, parseCache } from "./js/entitlement.js";
import { tripCard } from "./js/card.js";
import { ALERT_CONFIG_KEY, ALERT_STATE_KEY, MAJOR, MINOR, decideAlerts, liveState } from "./js/alerts.js";
import {
  MAX_COMMUTES,
  activeCommute,
  emptyCommutes,
  journeyStatus,
  journeyToSave,
  parseCommutes,
  removeActive,
  removeJourney,
  saveJourney,
  selectCommute,
  serializeCommutes,
  setDestination,
  setOrigin,
  swapActive,
  updateJourney,
} from "./js/commutes.js";
import { CLAIMS_URL, TRIPS_KEY, activeTrip, claimText, completeFromRun, monthlyStats, needsArrival, parseTrips, runForTrip, serializeTrips, startTrip, tripsCsv, updateTrip } from "./js/trips.js";
import {
  delayedItem,
  favCommutes,
  favouritesPanel,
  settingsPanel,
  tripsPanel,
  historyPanel,
  commutePanel,
  savedJourneyBox,
  claimBox,
  el,
  incidentsPanel,
  ukIncidentsPanel,
  upcomingSection,
  noticesHistoryPanel,
  legend,
  serviceLegend,
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

// Which country (plan 3): Spain or the UK, one at a time; CONFIG then
// points at that country's data and feeds, times show in its time zone.
// The app's first start opens on the phone's own country (its SIM's, else its
// network's or its language's region); asked only when nothing is saved.
const firstStart = !store.get(COUNTRY_KEY) && !new URLSearchParams(location.search).get("country");
const country = pickCountry({
  search: location.search,
  saved: store.get(COUNTRY_KEY),
  device: firstStart && CONFIG.platform !== "web" ? await appNative.deviceCountry() : "",
  languages: navigator.languages || [],
  zone: (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  })(),
  allowed: CONFIG.countries,
  hidden: CONFIG.hiddenCountries || [],
});
const TESTER_KEY = "testCountries";
/** Countries still being built (CONFIG.hiddenCountries): a device that has
 * opened one from its ?country= link is a tester's, and gets all of them in
 * "Ir a…" and the network picker, marked as in testing. */
const HIDDEN = CONFIG.hiddenCountries || [];
if (HIDDEN.includes(country)) store.set(TESTER_KEY, "1");
const TESTER = store.get(TESTER_KEY) === "1" && HIDDEN.length > 0;
/** The countries to choose from: those offered, the one shown, and for a
 * tester the hidden ones (A–Z after the others). UK_APP=false builds an app
 * with Spain only. */
const COUNTRY_LIST = [
  ...new Set([
    ...CONFIG.countries,
    country,
    ...(TESTER ? HIDDEN : []),
  ]),
];
const MULTI_COUNTRY = COUNTRY_LIST.length > 1;
// The Android app's widgets and background alerts follow Spain (Renfe), in
// either country: they read Spain's servers, favourites and commutes.
const NATIVE_BASES = { apiBase: CONFIG.apiBase, liveBase: CONFIG.liveBase };
applyCountry(CONFIG, country);
setTimeZone(CONFIG.timeZone);
const UK = country === "uk";
// Spain is where the delay history, the replay, Renfe's links, the núcleos
// and the Android widgets and alerts are (docs/plan-europe.md A7).
const ES = country === "es";
/** No live feeds for this country yet (applyCountry): trains go by timetable. */
const TIMETABLE_ONLY = !CONFIG.liveBase && !CONFIG.rtBase;
/** Each country's name, its "all of it" label, its credits and how its
 * timetable-only trains are counted. */
const COUNTRY_TEXT = {
  es: { name: "countryEs", all: "allSpain", credit: "attribution", scheduled: "scheduledCount" },
  uk: { name: "countryUk", all: "allUk", credit: "attributionUk", scheduled: "scheduledCountOther" }, // NI Railways and, in London, the Underground, DLR and Trams
  ie: { name: "countryIe", all: "allIe", credit: "attributionIe", scheduled: "scheduledCountOther" },
  fr: { name: "countryFr", all: "allFr", credit: "attributionFr", scheduled: "scheduledCountOther" },
  lu: { name: "countryLu", all: "allLu", credit: "attributionLu", scheduled: "scheduledCountOther" },
  fi: { name: "countryFi", all: "allFi", credit: "attributionFi", scheduled: "scheduledCountOther" },
  no: { name: "countryNo", all: "allNo", credit: "attributionNo", scheduled: "scheduledCountOther" },
  nl: { name: "countryNl", all: "allNl", credit: "attributionNl", scheduled: "scheduledCountOther" },
  sk: { name: "countrySk", all: "allSk", credit: "attributionSk", scheduled: "scheduledCountOther" },
  ee: { name: "countryEe", all: "allEe", credit: "attributionEe", scheduled: "scheduledCountOther" },
  ch: { name: "countryCh", all: "allCh", credit: "attributionCh", scheduled: "scheduledCountOther" },
  se: { name: "countrySe", all: "allSe", credit: "attributionSe", scheduled: "scheduledCountOther" },
  pl: { name: "countryPl", all: "allPl", credit: "attributionPl", scheduled: "scheduledCountOther" },
  at: { name: "countryAt", all: "allAt", credit: "attributionAt", scheduled: "scheduledCountOther" },
  cz: { name: "countryCz", all: "allCz", credit: "attributionCz", scheduled: "scheduledCountOther" },
  it: { name: "countryIt", all: "allIt", credit: "attributionIt", scheduled: "scheduledCountOther" },
  dk: { name: "countryDk", all: "allDk", credit: "attributionDk", scheduled: "scheduledCountOther" },
  hu: { name: "countryHu", all: "allHu", credit: "attributionHu", scheduled: "scheduledCountOther" },
  de: { name: "countryDe", all: "allDe", credit: "attributionDe", scheduled: "scheduledCountOther" },
  be: { name: "countryBe", all: "allBe", credit: "attributionBe", scheduled: "scheduledCountOther" },
  au: { name: "countryAu", all: "allAu", credit: "attributionAu", scheduled: "scheduledCountOther" },
  nz: { name: "countryNz", all: "allNz", credit: "attributionNz", scheduled: "scheduledCountOther" },
  sg: { name: "countrySg", all: "allSg", credit: "attributionSg", scheduled: "scheduledCountOther", scheduledAll: "scheduledAllSg" },
  pt: { name: "countryPt", all: "allPt", credit: "attributionPt", scheduled: "scheduledCountOther" },
  jp: { name: "countryJp", all: "allJp", credit: "attributionJp", scheduled: "scheduledCountOther" },
  tw: { name: "countryTw", all: "allTw", credit: "attributionTw", scheduled: "scheduledCountOther" },
};
/** A country's name; one still being built says so. */
const countryName = (c) => {
  const name = t(lang, COUNTRY_TEXT[c]?.name || "countryEs");
  return HIDDEN.includes(c) ? `${name} (${t(lang, "countryTesting")})` : name;
};
/** COUNTRY_LIST in the order shown: the offered ones, then the rest A–Z. */
const countryChoices = () => {
  // The country shown first, then every other one A–Z in the app's language.
  const rank = (c) => (c === country ? 0 : 1);
  return [...COUNTRY_LIST].sort((a, b) => rank(a) - rank(b) || countryName(a).localeCompare(countryName(b), lang));
};
/** Whose notices each country shows (the UK has its own panel). */
const NOTICES_BY = { es: "Renfe", ie: "Irish Rail", fr: "SNCF", no: "Entur", fi: "Fintraffic", nl: "NS", ch: "SBB", be: "SNCB", au: "Transport for NSW", nz: "Metlink and Auckland Transport", sg: "LTA", pl: "PKP PLK", jp: "Toei" };

// Each country keeps its own favourites and commutes (station ids differ);
// Spain's keep the original keys, which the Android widgets and alerts read.
const FAV_KEY = ES ? STORAGE_KEY : `favourites-${country}`;
// Open where the app was left (map and the train or station open), unless
// a link asks for something else.
const lastView = parseLink(location.href) ? null : decodeView(store.get(viewKey(country)), { country });
/** The area last chosen in this country (a núcleo, a region, a state). */
const savedArea = store.get(areaKey(country));
let lastStation = null; // the station last shown (popup or sheet), for the saved view

/** The train or station open now, for the saved view. */
function openDetail() {
  if (selected && (detailKind === "train" || popup)) return { type: "train", number: selected.number };
  if ((detailKind === "station" && stationView) || (stationPop?.isOpen() && lastStation)) {
    return { type: "station", id: (stationView || lastStation).properties.id };
  }
  return null;
}

function saveView() {
  if (!map || replay) return;
  const c = map.getCenter();
  store.set(viewKey(country), encodeView({ country, center: [c.lng, c.lat], zoom: map.getZoom(), detail: openDetail() }));
}

/** Reopen the train or station left open (if the train still runs). */
function restoreDetail(d) {
  if (d.type === "train") {
    const info = liveTrain(d.number);
    if (info) selectTrain(info);
    return !!info;
  }
  const st = stationList().find((s) => s.id === d.id);
  if (st) showStation({ properties: { id: st.id, name: st.name }, geometry: { coordinates: [st.lon, st.lat] } });
  return !!st;
}
const attribution = () => t(lang, COUNTRY_TEXT[country].credit);

/** The website's world view: data/world.json (each country's stations,
 * lines, trains by half hour and coarse network, from the deploy) and the
 * live counts backend-eu writes every ten minutes (world/live.json): two
 * small files instead of every country's feeds. */
let world = null;
let worldLive = { at: 0, doc: null };
const WORLD_LIVE_MS = 10 * 60_000;
const worldLiveUrl = () => {
  const base = NATIVE_BASES.liveBase || "/rt/";
  return base.replace(/rt\/?$/, "world/live.json");
};
async function refreshOverview() {
  const src = map?.getSource("overview");
  if (!src) return;
  if (!world) {
    try {
      // The app: the site's copy (today's), else the one it was built with.
      const urls = [...(CONFIG.remoteDataBase ? [`${CONFIG.remoteDataBase}world.json`] : []), "data/world.json"];
      for (const u of urls) {
        const r = await fetch(u, { cache: "no-cache", signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (r?.ok) {
          world = await r.json();
          break;
        }
      }
      world ||= { countries: {} };
    } catch {
      world = { countries: {} };
    }
    map.getSource("overview-net")?.setData(overviewNetwork(world));
  }
  if (Date.now() - worldLive.at > WORLD_LIVE_MS) {
    worldLive.at = Date.now();
    try {
      const r = await fetch(worldLiveUrl(), { cache: "no-cache", signal: AbortSignal.timeout(8000) });
      worldLive.doc = r.ok ? await r.json() : worldLive.doc;
    } catch {
      /* the timetable figures stand in */
    }
  }
  const here = engine ? JSON.parse(engine.statsJson(Date.now()) || "null") : null;
  const features = COUNTRY_LIST.map((c) => {
    const s = world.countries?.[c];
    const live = worldLive.doc?.countries?.[c]?.live;
    // Running now: the trains on the map here; elsewhere the live count, or
    // the timetable's for this half hour.
    const n = c === country && here ? (here.trains || 0) + (here.scheduled || 0) : Number.isFinite(live) && live > 0 ? live : scheduledNow(s, COUNTRY_INFO[c].zone);
    const lines = [countryName(c)];
    if (Number.isFinite(n)) lines.push(t(lang, Number.isFinite(live) && live > 0 && c !== country ? "overviewLive" : "overviewRunning", { n: formatCount(lang, n) }));
    if (s) lines.push(t(lang, "overviewNetwork", { lines: formatCount(lang, s.lines), stations: formatCount(lang, s.stations) }));
    return { type: "Feature", properties: { code: c, label: lines.join("\n") }, geometry: { type: "Point", coordinates: COUNTRY_INFO[c].center } };
  });
  src.setData({ type: "FeatureCollection", features });
}

/** Zoom out to every country (the website's overview). */
function showOverview() {
  map.flyTo({ center: [60, 25], zoom: 1.4 });
}

let countryPop = null;
/** "Ir a Francia" where another country was tapped. */
function offerCountry(code, lngLat) {
  countryPop?.remove();
  const go = el("button", { class: "btn btn-primary country-go", type: "button", "data-country": code, onclick: () => switchCountry(code) }, t(lang, "goToCountry", { country: countryName(code) }));
  countryPop = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 6, focusAfterOpen: false }).setLngLat(lngLat).setDOMContent(go).addTo(map);
}

/** Show the other country: remembered, then the page reloads with its data. */
function switchCountry(code) {
  if (code === country) return;
  store.set(COUNTRY_KEY, code);
  const u = new URL(location.href);
  u.searchParams.delete("country");
  u.searchParams.delete("train");
  u.searchParams.delete("station");
  location.replace(u.toString());
}

let lang = pickLang(store.get("lang"), navigator.languages || []);
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
const SHEETS = ["delayed", "near", "incidents", "about", "langs", "favs", "settings", "trips", "history", "commute", "more", "detail", "networks", "layers-panel", "route"];
const histApi = new HistoryApi(CONFIG.apiBase);
let historyView = null; // {kind: "train"|"station", ...} shown in the history sheet
let commutes = emptyCommutes(); // commute mode (Pro): saved commutes, one active
let commuteNote = ""; // e.g. "the list is full", shown once in the commute sheet
const COMMUTE_KEY = ES ? "commute" : `commute-${country}`;
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
  // Cab-ride videos: off unless chosen (kept on this device).
  cab: store.get("cab-layer") === "1",
};
// Map layers each "Capas" checkbox shows or hides (trains are filtered in render()).
const LAYER_IDS = {
  lines: ["lines-casing", "lines", "lines-notice"],
  tav: ["track-av-casing", "track-av"],
  tld: ["track-ld-casing", "track-ld"],
  tmd: ["track-md-casing", "track-md"],
  stations: ["stations", "stations-ld", "stations-hit", "stations-ld-hit", "station-labels", "station-labels-big"],
  stopped: ["stopped-ring"],
  cab: ["cab-casing", "cab-line", "cab-stops"],
};
let ridesNone = false; // the country has no cab-ride videos: no layer switch
// Faded while the cab-ride layer shows, so the filmed stretches stand out.
const FADE_UNDER_CAB = ["lines", "lines-casing", "track-av", "track-ld", "track-md", "track-av-casing", "track-ld-casing", "track-md-casing"];
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
  // The page title names the country shown (Spain keeps its own, with Renfe).
  document.title = ES ? t(lang, "title") : t(lang, "titleCountry", { country: countryName(country) });
  const btn = $("lang");
  // The button shows the language in use and opens the list of languages.
  btn.textContent = lang.toUpperCase();
  btn.setAttribute("aria-label", `${t(lang, "changeLanguage")} (${t(lang, "moreLanguageValue")})`);
  btn.title = t(lang, "changeLanguage");
  $("langs-title").textContent = t(lang, "moreLanguage");
  $("langs-close").setAttribute("aria-label", t(lang, "close"));
  if (!$("langs").hidden) renderLangs();
  renderLegend();
  $("delayed-btn").textContent = t(lang, "delayedList");
  $("delayed-title").textContent = t(lang, "delayedTitle");
  $("delayed-close").setAttribute("aria-label", t(lang, "close"));
  $("near-close").setAttribute("aria-label", t(lang, "close"));
  $("near-title").textContent = t(lang, "nearYou");
  $("inc-title").textContent = t(lang, UK ? "ukIncidentsTitle" : ES ? "incidentsTitle" : "noticesTitle");
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
    ["f-cab-l", "cabTitle"],
    ["b-standard-l", "baseStandard"],
    ["b-satellite-l", "baseSatellite"],
  ]) {
    $(id).textContent = t(lang, k);
  }
  $("search-q").placeholder = t(lang, "searchPlaceholderPhone");
  phoneChrome();
  // "Cargando trenes…" from the first frame, until the engine has positions.
  if (!engine) renderLiveChip({ trains: 0, scheduled: 0, median_delay: null }, Date.now());
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
  $("networks-title").textContent = t(lang, "netTitle");
  $("route-title").textContent = t(lang, "routeTitle");
  $("route-from-l").textContent = t(lang, "routeFrom");
  $("route-to-l").textContent = t(lang, "routeTo");
  $("route-from").placeholder = t(lang, "routeFromPh");
  $("route-to").placeholder = t(lang, "routeToPh");
  $("route-swap").setAttribute("aria-label", t(lang, "routeSwap"));
  $("route-swap").title = t(lang, "routeSwap");
  $("networks-close").setAttribute("aria-label", t(lang, "close"));
  $("layers-panel-title").textContent = t(lang, "layers");
  $("layers-panel-close").setAttribute("aria-label", t(lang, "close"));
  if (!$("networks").hidden) renderNetworks();
  if (!$("layers-panel").hidden) renderLayers();
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
    attr.options.customAttribution = attribution();
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
  metaCache.at = 0; // new timetables: line names and colours for the train labels
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
  // The country (plan 3): the other one reloads the page with its data.
  const countries = !MULTI_COUNTRY
    ? null
    : el(
        "optgroup",
        { label: t(lang, "country") },
        countryChoices().map((c) => el("option", { value: `country:${c}` }, countryName(c))),
        el("option", { value: "overview" }, t(lang, "allCountries")),
      );
  if (!ES) {
    const areas = countryAreas();
    sel.replaceChildren(
      el("option", { value: "" }, t(lang, "goTo")),
      el("option", { value: "es" }, t(lang, COUNTRY_TEXT[country].all)),
      areas.length ? el("optgroup", { label: t(lang, "area") }, areas.map((a) => el("option", { value: a.code }, a.name))) : null,
      countries,
    );
    return;
  }
  sel.replaceChildren(
    el("option", { value: "" }, t(lang, "goTo")),
    el("option", { value: "es" }, t(lang, "allSpain")),
    countries,
    nucleos.length
      ? el("optgroup", { label: t(lang, "cercaniasNetworks") }, nucleos.map((r) => el("option", { value: r.code }, r.name)))
      : null,
    el("optgroup", { label: t(lang, "netCommunities") }, byName(COMMUNITIES).map((c) => el("option", { value: `ccaa:${c.code}` }, c.name))),
    el("optgroup", { label: t(lang, "netProvinces") }, byName(PROVINCES).map((p) => el("option", { value: `prov:${p.code}` }, p.name))),
  );
}

const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));

/** Show one bottom sheet and hide the others. */
function openSheet(id) {
  for (const s of SHEETS) $(s).hidden = s !== id;
}

/** Refresh the notices button, map markers and (if open) the panel. */
/** The UK's notices (uk/rt/incidents.json, plan 3): refreshed every 5 minutes. */
let ukIncidents = null;
let upcomingView = { operator: "", all: false }; // "Próximas obras" filter (UK)
async function loadUkIncidents() {
  try {
    const r = await fetch(`${CONFIG.liveBase}incidents.json?t=${Math.floor(Date.now() / 120_000)}`);
    if (r.ok) ukIncidents = await r.json();
  } catch {
    // keep what we have
  }
  renderIncidents();
}

function renderUkIncidents() {
  const n = ukIncidents?.incidents?.length || 0;
  $("inc-btn").textContent = `⚠ ${t(lang, "incidents")}${n ? ` (${n})` : ""}`;
  const badge = $("tab-incidents-n");
  if (badge) {
    badge.hidden = !n;
    badge.textContent = n > 99 ? "99+" : String(n);
    $("tab-incidents").setAttribute("aria-label", n ? `${t(lang, "tabNotices")}: ${t(lang, "noticesCount", { n })}` : t(lang, "tabNotices"));
  }
  if (!$("incidents").hidden) {
    $("inc-body").replaceChildren(
      ...ukIncidentsPanel(lang, ukIncidents, {
        ...upcomingView,
        onOperator: (code) => {
          upcomingView = { operator: code, all: false };
          renderIncidents();
        },
        onAll: () => {
          upcomingView.all = true;
          renderIncidents();
        },
      }),
    );
  }
}

function renderIncidents() {
  if (UK) return renderUkIncidents();
  if (TIMETABLE_ONLY && !ES) {
    // No live feeds yet, so no notices either: say so instead of "loading".
    $("inc-btn").textContent = `⚠ ${t(lang, "incidents")}`;
    if (!$("incidents").hidden) $("inc-body").replaceChildren(el("p", { class: "muted" }, t(lang, "noticesNotYet", { country: countryName(country) })));
    return;
  }
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
  if (noticesHist) return renderNoticesHistory();
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
      operator: NOTICES_BY[country] || "Renfe",
    }),
  );
  if (!incidents.length && !feeds?.modified("alerts")) {
    $("inc-body").prepend(el("p", { class: "muted" }, t(lang, "incidentsLoading")));
  }
  // "Próximas obras" (free): Renfe's notices that haven't started yet.
  const upcoming = engine ? JSON.parse(engine.upcomingIncidentsJson(Date.now())) : [];
  $("inc-body").append(...upcomingSection(lang, upcoming, regionName, (st) => flyToVisible(st.lon, st.lat, 13)));
  const chips = noticeChips();
  if (chips) $("inc-body").prepend(chips);
  // Notices history (Android): past days' notices; without Pro, the offer.
  if (CONFIG.platform === "android" && replaySource()) {
    $("inc-body").prepend(
      el(
        "button",
        { class: "pill small", type: "button", id: "notices-history-btn", onclick: () => (CONFIG.pro ? openNoticesHistory() : (openSheet("settings"), renderSettings())) },
        icon("replay", 16),
        ` ${t(lang, "noticesHistoryBtn")}`,
        CONFIG.pro ? null : el("span", { class: "pro-tag" }, "Pro"),
      ),
    );
  }
}

/**
 * Notices history (TrainRadar Pro): the Renfe notices the recorder saw on a
 * past day (backend/src/notices.js), in the Avisos sheet.
 */
let noticesHist = null; // { day, min, state, doc }

async function openNoticesHistory(day = null) {
  const today = msToMadrid(Date.now()).date;
  if (!noticesHist) {
    noticesHist = { day: today, min: CONFIG.historySince, state: "loading", doc: null };
    fetch(`${replaySource()}notices/first.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => {
        if (noticesHist && f?.day) {
          noticesHist.min = f.day;
          renderNoticesHistory();
        }
      })
      .catch(() => {});
  }
  const h = noticesHist;
  h.day = day || h.day;
  h.state = "loading";
  h.doc = null;
  renderNoticesHistory();
  try {
    const r = await fetch(`${replaySource()}notices/${h.day}.json`, { cache: h.day === today ? "no-cache" : "default" });
    if (noticesHist !== h || h.day !== (day || h.day)) return;
    h.doc = r.ok ? await r.json() : null;
    h.state = r.ok || r.status === 404 ? "ok" : "error";
  } catch {
    if (noticesHist !== h) return;
    h.state = "error";
  }
  renderNoticesHistory();
}

function renderNoticesHistory() {
  const h = noticesHist;
  if (!h || $("incidents").hidden) return;
  $("inc-body").replaceChildren(
    ...noticesHistoryPanel(lang, {
      day: h.day,
      min: h.min,
      max: msToMadrid(Date.now()).date,
      state: h.state,
      doc: h.doc,
      regionName,
      onDay: (d) => openNoticesHistory(d),
      onLive: () => {
        noticesHist = null;
        renderIncidents();
      },
      onStop: (st) => flyToVisible(st.lon, st.lat, 13),
    }),
  );
  $("incidents").scrollTop = 0;
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

/** Notices about my things: favourite stations, the stops (and Cercanías
 * line) of favourite trains on the map, and saved commutes (Pro). */
const MINE = "mine";
function mineNoticeFilter() {
  const ids = new Set();
  const names = new Set();
  const lines = new Set();
  for (const f of favs) {
    if (f.type === "station") {
      ids.add(f.id);
      names.add(fold(f.name));
      continue;
    }
    const info = liveTrain(f.number);
    if (!info) continue;
    if (/^[CR]\d/i.test(info.route || "")) lines.add(info.route);
    const i = engine.findTrain(info.trip_id, info.number);
    const trip = i >= 0 ? JSON.parse(engine.tripJson(i)) : null;
    for (const s of trip?.stops || []) names.add(fold(s.name));
  }
  const commuteTests = CONFIG.pro ? commutes.list.map((c) => commuteNoticeFilter(c).test) : [];
  return {
    label: t(lang, commuteTests.length ? "noticesMine" : "noticesMineFavs"),
    commute: MINE,
    none: t(lang, "noIncidentsMine"),
    test: (i) => i.stops.some((x) => ids.has(x.id) || names.has(fold(x.name))) || i.lines.some((l) => lines.has(l)) || commuteTests.some((f) => f(i)),
  };
}
const hasMine = () => favs.length > 0 || (CONFIG.pro && commutes.list.length > 0);

/** Opened from the ⚠ button: the remembered filter, if any. */
function defaultNoticeFilter() {
  if (!engine) return null;
  const k = store.get(INC_FILTER_KEY);
  if (k === MINE) return hasMine() ? mineNoticeFilter() : null;
  if (!CONFIG.pro) return null;
  const c = commutes.list.find((x) => commuteKey(x) === k);
  return c ? commuteNoticeFilter(c) : null;
}

/** "Todos · Mis favoritos y trayectos · each commute (Pro)". */
function noticeChips() {
  if (!hasMine()) return null;
  const current = incFilter?.commute ?? (incFilter ? null : "");
  const pick = (key, make) => () => {
    store.set(INC_FILTER_KEY, key);
    showIncidents(make ? make() : null);
  };
  const chip = (label, v, make, id) =>
    el("button", { class: v === current ? "pill small pill-strong" : "pill small", type: "button", id, "aria-pressed": String(v === current), onclick: pick(v, make) }, label);
  const commuteChips = CONFIG.pro ? commutes.list.map((c) => chip(`${c.from.name} → ${c.to.name}`, commuteKey(c), () => commuteNoticeFilter(c))) : [];
  return el(
    "p",
    { class: "commute-tabs", id: "inc-commutes" },
    chip(t(lang, "delayedAll"), "", null, "inc-all"),
    chip(t(lang, commuteChips.length ? "noticesMine" : "noticesMineFavs"), MINE, mineNoticeFilter, "inc-mine"),
    ...commuteChips,
  );
}

function showIncidents(filter = null) {
  incFilter = filter;
  noticesHist = null; // the live notices first
  openSheet("incidents");
  renderIncidents();
}

function regionName(code) {
  return ref?.region(code)?.name || "";
}

function selectTrain(info, { fly = false } = {}) {
  $("follow-chip").hidden = true;
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

/** "Seguir": the map keeps the selected train in view until the user drags
 * the map. The number is kept, so the next launch can offer to follow it
 * again (step 9 of docs/design/ui-redesign/PLAN.md). */
const FOLLOW_KEY = `follow-${country}`;
let following = store.get(FOLLOW_KEY) || "";
let followAt = 0;
const sameTrain = (a, b) => String(a || "").replace(/^0+/, "") === String(b || "").replace(/^0+/, "");
function setFollowing(number) {
  following = number || "";
  store.set(FOLLOW_KEY, following);
  followAt = 0;
}
function followTrain(info, force = false) {
  if (!following || !sameTrain(info.number, following) || !map) return;
  if (!force && (map.isMoving() || Date.now() - followAt < 2000)) return;
  followAt = Date.now();
  map.easeTo({ center: [info.lon, info.lat], duration: force ? 600 : 1000, offset: isPhone() ? phoneOffset(true) : [0, 0] });
}

/** "Seguir C10 75172": the train followed when the app was left, if it's
 * still running; a tap opens it and follows it again. */
function showFollowChip() {
  const chip = $("follow-chip");
  const info = following ? liveTrain(following) : null;
  if (!info) return (chip.hidden = true);
  const route = info.route || info.line;
  chip.replaceChildren(
    route ? lineBadge(route, lineColors.get(`${info.region}|${route}`) || lineColors.get(`|${route}`)) : null,
    el("span", {}, t(lang, "followChip", { train: String(info.number).replace(/^0+/, "") })),
  );
  chip.onclick = () => {
    chip.hidden = true;
    selectTrain(info, { fly: true });
  };
  chip.hidden = false;
}

function showPopup(open = false) {
  const now = Date.now();
  const info = selectedInfo(now);
  if (!info) {
    if (selected && open) clearSelection();
    return;
  }
  map.getSource("selected")?.setData(pointGeoJson(info.lon, info.lat));
  followTrain(info);
  // Phone sheet or desktop side panel alike (docs/design/ui-redesign/PLAN.md, step 3).
  return showTrainSheet(info, open, now);
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
      fav: favButton({ type: "train", number: info.number, label: trainTitle(info) }),
      onShare: canShare()
        ? () => share({ title: trainTitle(info), text: t(lang, "shareTrain", { train: trainTitle(info) }), url: `${CONFIG.siteUrl}?train=${encodeURIComponent(info.number)}` })
        : null,
    },
  );
  body.append(...cabTrain(lang, trainVideo(info, now)));
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

/** A cab-ride video of the stretch a train is on, opened about where it is. */
function trainVideo(info, now) {
  const idx = cabIndex();
  if (!idx || !info.next_stop) return null;
  const i = engine.findTrain(info.trip_id, info.number);
  const trip = i < 0 ? null : JSON.parse(engine.tripJson(i));
  return videoForTrain(idx, trip?.stops, info.next_stop, (now ?? Date.now()) / 1000);
}

// Travellers' reports (js/reports.js, docs/plan-crowd-reports.md): the UK
// only. Everyone sees the counts (<cc>/rt/reports.json); the Android app,
// with the user's consent, can send one after the location check on the
// phone. The fix never leaves the phone.
const REPORTS = REPORT_COUNTRIES.includes(country) && !!CONFIG.liveBase;
const REPORTS_SEND = REPORTS && CONFIG.platform === "android" && !!CONFIG.reportsBase;
let reportsDoc = null;
let reportFor = ""; // the train whose report choices are open
let reportBusy = false;
let reportMsg = { key: "", text: "" };
let lastSent = null; // { key, trip, kind, at }: the report "Undo" can take back
const reportsConsent = () => store.get("reports-consent") === "yes";

async function loadReports() {
  try {
    const r = await fetch(`${CONFIG.liveBase}reports.json?t=${Math.floor(Date.now() / 30_000)}`);
    reportsDoc = r.ok ? await r.json() : null;
  } catch {
    // keep what we have
  }
  detailKey = "";
  showPopup();
}

function reportToken() {
  let saved = null;
  try {
    saved = JSON.parse(store.get("reports-token") || "null");
  } catch {
    saved = null;
  }
  const tok = monthlyToken(saved);
  if (tok !== saved) store.set("reports-token", JSON.stringify(tok));
  return tok.token;
}

async function postReport(path, body) {
  const r = await fetch(`${CONFIG.reportsBase}v1/reports${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** One location fix, precise, in the foreground; null if refused or failed. */
function oneFix() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  });
}

/** The consent screen (Google Play's prominent disclosure): its own screen,
 * nothing pre-chosen; resolves true on "Accept". */
function askReportsConsent() {
  return new Promise((resolve) => {
    const done = (yes) => {
      box.remove();
      if (yes) store.set("reports-consent", "yes");
      resolve(yes);
    };
    const box = el(
      "div",
      { class: "consent-screen", role: "dialog", "aria-modal": "true", "aria-labelledby": "consent-title" },
      el(
        "div",
        { class: "consent-body" },
        el("h2", { id: "consent-title" }, t(lang, "reportsTitle")),
        ...["reportsIntro", "reportsWhat", "reportsWhy", "reportsKeep", "reportsRules"].map((k) => el("p", {}, t(lang, k))),
        el("p", {}, el("a", { href: `${CONFIG.siteUrl}legal/privacy.html#${lang === "es" ? "avisos" : "reports"}`, target: "_blank", rel: "noopener" }, t(lang, "reportsPrivacy"))),
        el(
          "div",
          { class: "consent-acts" },
          el("button", { class: "pill", type: "button", id: "consent-no", onclick: () => done(false) }, t(lang, "reportsDecline")),
          el("button", { class: "pill pill-strong", type: "button", id: "consent-yes", onclick: () => done(true) }, t(lang, "reportsAccept")),
        ),
      ),
    );
    document.body.append(box);
    box.querySelector("#consent-title")?.focus?.();
  });
}

function reportAction(info, trip, now) {
  if (!REPORTS) return null;
  const key = `${info.trip_id}|${info.number}`;
  const list = trainReports(reportsDoc, info.trip_id).map((r) => ({ ...r, resolved: reportResolved(r, info) }));
  const canSend = REPORTS_SEND && reportsDoc?.on === true && !info.canceled;
  const redraw = () => {
    detailKey = "";
    showPopup(true);
  };
  const say = (text) => {
    reportMsg = { key, text };
    redraw();
  };
  const token = () => reportToken();
  return {
    list,
    canReport: canSend,
    open: reportFor === key,
    kinds: Object.keys(REPORT_KINDS),
    busy: reportBusy,
    msg: reportMsg.key === key ? reportMsg.text : "",
    onUndo:
      lastSent?.key === key && Date.now() - lastSent.at < UNDO_MS && reportMsg.key === key
        ? async () => {
            const sent = lastSent;
            lastSent = null;
            try {
              await postReport("/undo", { country, trip: sent.trip, kind: sent.kind, token: token() });
              say(t(lang, "reportUndone"));
            } catch (e) {
              say(t(lang, "reportErrSend", { why: e.message }));
            }
          }
        : null,
    onToggle: async () => {
      if (reportFor !== key && !reportsConsent() && !(await askReportsConsent())) return;
      reportFor = reportFor === key ? "" : key;
      reportMsg = { key: "", text: "" };
      redraw();
    },
    onDispute:
      canSend && reportsConsent()
        ? async (kind) => {
            const b = { country, trip: info.trip_id, kind, at: Date.now(), token: token() };
            const integrity = await appNative.integrityToken(await sha256b64(nonceText(b, true)));
            if (!integrity) return say(t(lang, "reportErrSend", { why: "Google Play" }));
            try {
              await postReport("/dispute", { ...b, integrity });
              say(t(lang, "reportDisputed"));
            } catch (e) {
              say(t(lang, "reportErrSend", { why: e.message }));
            }
          }
        : null,
    onPick: async (kind) => {
      if (reportBusy) return;
      reportBusy = true;
      say(t(lang, "reportChecking"));
      try {
        const fix = await oneFix();
        if (!fix) return say(t(lang, "reportErrLocation"));
        const live = selectedInfo(Date.now()) || info;
        const place = placeCheck(kind, fix, live, trip, Date.now() / 1000);
        // The fix is dropped here: only the check's result goes on.
        if (place.error) return say(t(lang, place.error === "accuracy" ? "reportErrAccuracy" : "reportErrWhere"));
        const b = { country, trip: info.trip_id, train: info.number, kind, where: place.where, station: place.station, band: place.band, acc: place.acc, at: Date.now(), token: token() };
        const integrity = await appNative.integrityToken(await sha256b64(nonceText(b)));
        if (!integrity) return say(t(lang, "reportErrSend", { why: "Google Play" }));
        await postReport("", { ...b, integrity });
        reportFor = "";
        lastSent = { key, trip: b.trip, kind, at: Date.now() };
        // The Undo button goes after a minute.
        setTimeout(() => lastSent?.key === key && (detailKey = "", showPopup(true)), UNDO_MS + 500);
        say(t(lang, "reportSent"));
      } catch (e) {
        say(e.message === "repeat" ? t(lang, "reportErrRepeat") : t(lang, "reportErrSend", { why: e.message }));
      } finally {
        reportBusy = false;
        redraw();
      }
    },
  };
}

/** "Compartir aviso" (js/notice.js): the train whose choices are open. */
let noticeFor = "";

function noticeAction(info, trip, now) {
  const key = `${info.trip_id}|${info.number}`;
  const redraw = () => {
    detailKey = "";
    showPopup(true);
  };
  return {
    open: noticeFor === key,
    kinds: NOTICE_KINDS,
    label: (k) => noticeLabel(lang, k),
    onToggle: () => {
      noticeFor = noticeFor === key ? "" : key;
      redraw();
    },
    onPick: async (kind) => {
      noticeFor = "";
      redraw();
      const text = noticeText(lang, kind, info, { title: trainTitle(info), stops: trip?.stops || [], nowSecs: (now ?? Date.now()) / 1000 });
      const url = `${CONFIG.siteUrl}?train=${encodeURIComponent(info.number)}`;
      if (canShare()) await share({ title: t(lang, "noticeShare"), text, url });
      else if (await copyText(`${text}\n${url}`)) toast(t(lang, "noticeCopied"));
    },
  };
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
    follow: {
      on: sameTrain(info.number, following),
      onToggle: () => {
        setFollowing(sameTrain(info.number, following) ? "" : info.number);
        followTrain(info, true);
        detailKey = "";
        showPopup(true);
      },
    },
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
    notice: noticeAction(info, trip, now),
    report: reportAction(info, trip, now),
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
    },
  });
  body.append(...cabTrain(lang, trainVideo(info, now)));
  const was = detailKind;
  if (open) {
    detailKind = "train"; // before the pager, which asks what is shown
    stationView = null;
  }
  $("detail-body").replaceChildren(...[favPager(), body].filter(Boolean));
  if (open) {
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
  // Alerts follow Spain's trains (the background check reads Renfe's feed).
  if (info.timetable_only || !ES) return null;
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

/*
 * Plan ahead (docs/plan-future.md): a timetable-only engine with the
 * plan-ahead files, started the first time a date is chosen.
 */
let planner = null;
function getPlanner() {
  if (!planner) {
    const base = `${(CONFIG.remoteDataBase || CONFIG.dataBase).replace(/\/?$/, "/")}plan/`;
    planner = new Planner(() => {
      const e = new Engine();
      e.setCountry(country);
      return e;
    }, base);
  }
  return planner;
}
let stationWhen = null; // a station's board from a chosen date and time (ms), or now
let stationWhenId = null; // …for this station
let stationPlan = { key: "" }; // its timetable rows for that date

/** The date field for a sheet: now, or a date up to the plan's last day. */
function whenFor(id, value, onChange) {
  return whenField(lang, { id, value, tz: CONFIG.timeZone, until: planner?.until || null, onChange });
}

/*
 * A train on a date (plan future): its stops and times by the timetable.
 * Which regions: those without a small area (long distance, OUIGO, the UK)
 * and the Cercanías on the map now.
 */
let trainDay = { number: "", when: 0, runs: null, key: "" };
function openTrainDay(number, when = Date.now() + 86_400_000) {
  trainDay = { number: String(number), when, runs: null, key: "" };
  renderTrainDay(true);
}
function renderTrainDay(open = false) {
  const { number, when } = trainDay;
  const key = `${number}|${when}`;
  if (trainDay.key !== key) {
    trainDay.key = key;
    trainDay.runs = null;
    const c = map?.getCenter();
    getPlanner()
      .ready(c ? [[c.lng, c.lat]] : [], 0.5)
      .then((e) => {
        if (trainDay.key !== key) return;
        trainDay.runs = JSON.parse(e.trainOnDateJson(number, when));
        renderTrainDay();
      })
      .catch((e) => {
        console.warn("plan", e);
        if (trainDay.key === key) (trainDay.runs = []), renderTrainDay();
      });
  }
  const sheet = $("detail");
  const body = el(
    "div",
    { class: "popup sheet-trainday", id: "trainday" },
    el(
      "div",
      { class: "ss-head sheet-grip" },
      el("div", { class: "ss-main" }, el("h2", { class: "popup-title" }, t(lang, "trainDayTitle", { n: number })), el("p", { class: "ts-meta" }, t(lang, "plannedNote"))),
      el("button", { type: "button", class: "icon-btn", id: "trainday-close", "aria-label": t(lang, "close"), onclick: () => (sheet.hidden = true) }, icon("close", 20)),
    ),
    whenFor("trainday-when", when, (ms) => {
      trainDay.when = ms || Date.now();
      renderTrainDay();
    }),
    ...trainDayList(lang, {
      number,
      runs: trainDay.runs || [],
      loading: !trainDay.runs,
      onStation: (st) => {
        const s = stationList().find((x) => x.id === st.id);
        if (!s) return;
        stationWhen = st.dep * 1000 - 5 * 60_000;
        stationWhenId = s.id;
        showStation({ properties: { id: s.id, name: s.name }, geometry: { coordinates: [s.lon, s.lat] } });
      },
    }),
  );
  $("detail-body").replaceChildren(body);
  if (!open) return;
  detailKind = "trainday";
  if (sheet.hidden) openSheet("detail");
  sheets.setSnap("detail", "half");
  sheet.scrollTop = 0;
}

/** Popup with a station's next departures and approaching trains. */
/** The country's cab-ride videos (docs/plan-cab-rides.md), loaded the first
 * time a station or train is shown; then whatever is open is redrawn. */
let rides = null;
let ridesAsked = false;
let cabDrawn = false;
/** The "Videos from the cab" layer's lines and stations, drawn once the
 * videos and the stations are in (cabrides.js ridesGeoJson). */
function refreshCab() {
  if (!show.cab || cabDrawn || !map?.getSource("cab") || !engine) return;
  const idx = cabIndex();
  if (!idx) return; // cabIndex calls back here once loaded
  const stations = JSON.parse(engine.stationsGeoJson()).features.map((f) => ({
    name: f.properties.name,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  map.getSource("cab").setData(ridesGeoJson(idx, stations));
  cabDrawn = true;
}
let cabAllFor = ""; // the station whose every video is listed
function cabIndex() {
  if (!ridesAsked) {
    ridesAsked = true;
    loadRides([CONFIG.remoteDataBase, CONFIG.dataBase].filter(Boolean)).then((idx) => {
      rides = idx;
      ridesNone = !idx || !idx.videos.length;
      if (!$("layers-panel").hidden) renderLayers();
      if (!idx) return;
      refreshCab();
      if (stationPop?.isOpen() && lastStation) showStation(lastStation, { refresh: true });
      if (detailKind === "station" && stationView) showStation(stationView, { refresh: true });
    });
  }
  return rides;
}
/** The cab-ride rows for a station, with "N more". */
function stationVideos(f) {
  const { id, name } = f.properties;
  return cabVideos(lang, videosAt(cabIndex(), name), {
    showAll: cabAllFor === id,
    onMore: () => {
      cabAllFor = id;
      showStation(f, { refresh: true });
    },
  });
}

function showStation(f, { refresh = false } = {}) {
  const { id, name } = f.properties;
  lastStation = f;
  const [lon, lat] = f.geometry.coordinates;
  const now = Date.now();
  // Its núcleo's timetable may not be loaded yet: load, then refresh.
  const d = 0.05;
  const regions = ref?.regionsIn([lon - d, lat - d, lon + d, lat + d]) || [];
  for (const r of regions) {
    if (!ref.loaded.has(r.code)) ref.loadRegion(r.code).then(() => (stationPop?.isOpen() || (detailKind === "station" && stationView === f)) && showStation(f, { refresh: true }));
  }
  return showStationSheet(f, regions, refresh);
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
      onOtherDay: () => {
        stationPop?.remove();
        stationWhen = Date.now() + 86_400_000;
        stationWhenId = id;
        showStation(f);
      },
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
  body.append(...stationVideos(f));
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
  if (stationWhenId !== id) stationWhen = null; // another station: now again
  if (!refresh) {
    stationTab = "dep";
    selected = null;
    highlight = null;
    map.getSource("route")?.setData(emptyGeoJson());
    map.getSource("selected")?.setData(emptyGeoJson());
  }
  const redrawPlan = () => showStation(f, { refresh: true });
  // A chosen date: that day's timetable from the plan-ahead engine.
  const when = stationWhen;
  if (when && stationPlan.key !== `${id}|${when}`) {
    const key = `${id}|${when}`;
    stationPlan = { key, loading: true, board: [], arrivals: [] };
    getPlanner()
      .ready([[lon, lat]])
      .then((e) => {
        if (stationPlan.key !== key) return;
        stationPlan = {
          key,
          board: keepLongDistance(JSON.parse(e.stationBoardJson(id, when, 3 * 3600, 300)).filter((r) => !r.terminates), 30),
          arrivals: keepLongDistance(JSON.parse(e.stationArrivalsJson(id, when, 3 * 3600, 300)), 30),
        };
        redrawPlan();
      })
      .catch((e) => {
        console.warn("plan", e);
        if (stationPlan.key === key) (stationPlan = { key, board: [], arrivals: [] }), redrawPlan();
      });
  }
  // The next trains, plus the long-distance ones of the next 3 hours (js/board.js).
  const board = when ? stationPlan.board : keepLongDistance(JSON.parse(engine.stationBoardJson(id, now, 3 * 3600, 200)), 12);
  const approaching = when ? [] : keepLongDistance(JSON.parse(engine.approachingJson(id, now, 90 * 60)), 10);
  const nucleo = regions.find((r) => r.code !== "ld");
  const routes = [...new Set(board.map((r) => r.route).filter(Boolean))].slice(0, 6);
  const sub = [];
  if (nucleo) sub.push(t(lang, "cercanias", { region: nucleo.name }));
  if (userFix) sub.push(t(lang, "awayDistance", { d: formatDistance(lang, distanceM(userFix, { lat, lon })) }));
  const redraw = () => showStation(f, { refresh: true });
  const region = nucleo?.code || "";
  const body = stationSheet(lang, { id, name }, {
    sub: sub.join(" · "),
    reported: (row) => {
      const list = trainReports(reportsDoc, row.trip_id);
      if (!list.length) return null;
      const i = engine.findTrain(row.trip_id, row.number);
      const info = i < 0 ? null : JSON.parse(engine.trainJson(i, now));
      return list.find((r) => !reportResolved(r, info)) || null;
    },
    routes,
    board,
    approaching,
    planned: !!when,
    loading: !!(when && stationPlan.loading),
    arrivals: when ? stationPlan.arrivals : null,
    when: whenFor("station-when", when, (ms) => {
      stationWhen = ms;
      stationWhenId = id;
      redrawPlan();
    }),
    tab: stationTab,
    onTab: (tab) => {
      stationTab = tab;
      redraw();
    },
    lineColor: (route) => lineColors.get(`${region}|${route}`) || lineColors.get(`|${route}`),
    onDeparture: (r) => {
      if (when) return openTrainDay(r.number, when);
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
    onRoute: () => openRoute({ kind: "station", item: { id, name, lon, lat } }, null),
  });
  body.append(...stationVideos(f));
  const scroll = sheet.scrollTop;
  if (!refresh) {
    detailKind = "station";
    stationView = f;
  }
  $("detail-body").replaceChildren(...[favPager(), body].filter(Boolean));
  if (refresh) {
    sheet.scrollTop = scroll;
    return;
  }
  detailKind = "station";
  stationView = f;
  if (sheet.hidden) openSheet("detail");
  sheets.setSnap("detail", "full"); // a station opens full screen on a phone (its departures need the room)
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
    syncShortcuts();
    renderFavourites();
  }
  $("pro-chip").hidden = !next.pro;
  renderSettings();
  renderMore();
}

/** What the Android list widgets need (WidgetStore.appConfig): the live
 * API and the language. Written at start and when the language changes. */
function writeWidgetConfig() {
  if (CONFIG.platform !== "android") return Promise.resolve();
  return prefs
    .set("widget-config", JSON.stringify({ lang, apiBase: NATIVE_BASES.apiBase }))
    .then(() => appNative.refreshWidget())
    .catch(() => {});
}

/** What the background check needs (read natively from Preferences). */
function writeAlertConfig() {
  const cfg = { enabled: alertsOn, lang, liveBase: NATIVE_BASES.liveBase, minor: MINOR, major: MAJOR };
  return prefs.set(ALERT_CONFIG_KEY, JSON.stringify(cfg)).catch(() => {});
}

async function setAlerts(on) {
  if (on && !(await appNative.requestNotifications().catch(() => false))) {
    settingsMsg = moreMsg = t(lang, "alertsDenied");
    return renderSettings(), renderMore();
  }
  alertsOn = on;
  await writeAlertConfig();
  await appNative.setAlerts(on, lang).catch((e) => console.warn("alerts", e));
  settingsMsg = moreMsg = "";
  renderSettings();
  renderMore();
}

/** While the app is open: the same alerts, live from the engine (every minute). */
async function checkAlertsLive(now) {
  if (!alertsOn || !CONFIG.pro || !ES || now - lastAlertCheck < 60_000) return;
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
      reports: REPORTS_SEND
        ? {
            on: reportsConsent(),
            onToggle: async () => {
              if (reportsConsent()) store.set("reports-consent", "no");
              else await askReportsConsent();
              renderSettings();
            },
            onForget: async () => {
              try {
                await postReport("/forget", { country, token: reportToken() });
                settingsMsg = t(lang, "reportsForgotten");
              } catch (e) {
                settingsMsg = t(lang, "reportErrSend", { why: e.message });
              }
              renderSettings();
            },
          }
        : null,
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
  // The Delays list's filter offers each commute: keep it current (it is
  // hidden while the commute screen is open, and shown again unchanged).
  if (engine) renderDelayedList();
  redraw();
  if (open) {
    openSheet("commute");
    renderCommute();
  }
}

/** Commute mode (Pro): next trains between the two saved stations. */
function renderCommute() {
  if ($("commute").hidden || !engine) return;
  if ($("commute-add").dataset.lang !== lang) renderCommuteAdd();
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
  const j = CONFIG.pro ? c?.journey : null;
  const saved = j
    ? savedJourneyBox(lang, {
        journey: j,
        status: journeyStatus(j, journeyRuns(j)),
        today: isoToday(),
        native: appNative.available(),
        // Background alerts follow Spain's commutes (AlertsWorker).
        alerts: ES,
        onTrain: (l) => {
          const info = liveTrain(l.number);
          if (info) {
            $("commute").hidden = true;
            selectTrain(info, { fly: true });
          }
        },
        onAlternatives: () => openRoute({ kind: "station", item: stationList().find((x) => x.id === from.id) || from }, { kind: "station", item: stationList().find((x) => x.id === to.id) || to }),
        onUpdate: (patch) => saveCommutes(updateJourney(commutes, patch), renderCommute),
        onForget: () => saveCommutes(removeJourney(commutes), renderCommute),
      })
    : null;
  $("commute-body").replaceChildren(
    ...commutePanel(lang, {
      saved,
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
    .set(FAV_KEY, JSON.stringify(list))
    .then(() => appNative.refreshWidget())
    .catch((e) => console.warn("favourites", e));
  renderFavourites();
  syncShortcuts();
}

/** A short message at the bottom of the screen, gone after a few seconds. */
function toast(text) {
  document.querySelector(".toast")?.remove();
  const box = el("div", { class: "toast", role: "status" }, text);
  document.body.append(box);
  setTimeout(() => box.remove(), 3500);
}

/** "Add to the home screen" for a favourite station, train or commute
 * (Android): with Pro, asks the launcher for an icon that opens it; without,
 * the Pro offer. Null on the web. */
function shortcutButton({ kind, id, label }) {
  if (CONFIG.platform !== "android" || !appNative.available()) return null;
  const text = t(lang, "shortcutAdd");
  if (!CONFIG.pro) {
    return el("button", { class: "pill small shortcut-btn", type: "button", title: text, "aria-label": `${text} (Pro)`, onclick: () => (openSheet("settings"), renderSettings()) }, icon("home", 14), el("span", { class: "pro-tag" }, "Pro"));
  }
  return el(
    "button",
    {
      class: "pill small shortcut-btn",
      type: "button",
      title: text,
      "aria-label": `${text}: ${label}`,
      "data-kind": kind,
      onclick: async () => {
        const ok = await appNative.pinShortcut({ id: `${kind}-${country}-${id}`, label: label.slice(0, 24), url: shortcutLink(kind, country, id), kind }).catch(() => false);
        if (!ok) toast(t(lang, "shortcutNo"));
      },
    },
    icon("home", 14),
  );
}

/** The app icon's long-press menu (Pro): this country's first favourites in
 * Favoritos' order (stations, the first commute, trains), four at most. */
function syncShortcuts() {
  if (CONFIG.platform !== "android" || !appNative.available()) return;
  if (!CONFIG.pro) return void appNative.setShortcuts([]).catch(() => {});
  const ordered = favouritesInOrder(favs);
  const items = [
    ...ordered.filter((f) => f.type === "station").map((f) => ({ kind: "station", id: f.id, label: f.name })),
    ...(commutes.list.length ? [{ kind: "commute", id: "0", label: `${commutes.list[0].from.name} → ${commutes.list[0].to.name}` }] : []),
    ...ordered.filter((f) => f.type === "train").map((f) => ({ kind: "train", id: f.number, label: f.label || f.number })),
  ]
    .slice(0, 4)
    .map((x) => ({ id: `${x.kind}-${country}-${x.id}`, label: x.label.slice(0, 24), url: shortcutLink(x.kind, country, x.id), kind: x.kind }));
  appNative.setShortcuts(items).catch(() => {});
}

/** The live train for a favourite (by number), as popup info, or null. */
function liveTrain(number) {
  if (!engine) return null;
  const n = String(number).replace(/^0+/, "");
  const hit = JSON.parse(engine.searchJson(number, 8)).find((h) => h.number.replace(/^0+/, "") === n);
  return hit ? JSON.parse(engine.trainJson(hit.i, Date.now())) : null;
}

function openStation(st) {
  const f = { properties: { id: st.id, name: st.name }, geometry: { coordinates: [st.lon, st.lat] } };
  // The station's sheet (or side panel) at once, the map moving behind it
  // (as for a train).
  {
    showStation(f);
    flyToVisible(st.lon, st.lat, 13, { forPopup: true });
    return;
  }
  flyToVisible(st.lon, st.lat, 13, { forPopup: true });
  map.once("moveend", () => showStation(f));
}

/** The favourite shown in the detail sheet (train or station), or null. */
function currentFavourite() {
  if (detailKind === "train" && selected) {
    const f = { type: "train", number: selected.number };
    return isFavourite(favs, f) ? favs.find((x) => favKey(x) === favKey(f)) : null;
  }
  if (detailKind === "station" && stationView) {
    const f = { type: "station", id: stationView.properties.id };
    return isFavourite(favs, f) ? favs.find((x) => favKey(x) === favKey(f)) : null;
  }
  return null;
}

/** Open a favourite (from Favoritos, or swiping between them). A train that
 * isn't running now is skipped when swiping (`skipFrom` + `dir`). */
function openFavourite(f, { dir = 0 } = {}) {
  if (f.type === "station") return openStation(f), true;
  const info = liveTrain(f.number);
  if (info) return selectTrain(info, { fly: true }), true;
  if (!dir) return false;
  const next = neighbourFavourite(favs, f, dir);
  return next ? openFavourite(next, { dir }) : false;
}

/** Swipe or ‹ ›: the next or previous favourite. */
function stepFavourite(dir) {
  const cur = currentFavourite();
  const next = cur && neighbourFavourite(favs, cur, dir);
  if (!next) return false;
  popupToTop = true;
  return openFavourite(next, { dir });
}

/** "‹ Favorito 2 de 5 ›" at the top of the detail sheet, for a favourite. */
function favPager() {
  const cur = currentFavourite();
  if (!cur || favs.length < 2) return null;
  const ordered = favouritesInOrder(favs);
  const i = ordered.findIndex((x) => favKey(x) === favKey(cur));
  return el(
    "div",
    { class: "fav-pager", id: "fav-pager" },
    el("button", { type: "button", id: "fav-prev", "aria-label": t(lang, "favPrev"), disabled: i <= 0 ? "" : null, onclick: () => stepFavourite(-1) }, "‹"),
    el("span", { class: "small muted" }, t(lang, "favPager", { i: i + 1, n: ordered.length })),
    el("button", { type: "button", id: "fav-next", "aria-label": t(lang, "favNext"), disabled: i >= ordered.length - 1 ? "" : null, onclick: () => stepFavourite(1) }, "›"),
  );
}

function renderFavourites() {
  if ($("favs").hidden) return;
  if ($("favs-add").dataset.lang !== lang) renderFavAdd();
  // Usual commutes (Android), between the stations and the trains.
  const middle =
    CONFIG.platform !== "android"
      ? []
      : favCommutes(lang, {
          list: commutes.list,
          active: commutes.active,
          pro: CONFIG.pro,
          onOpen: (i) => {
            saveCommutes(selectCommute(commutes, i));
            openSheet("commute");
            renderCommute();
          },
          onAdd: () => (openSheet("commute"), renderCommute()),
          onPro: () => (openSheet("settings"), renderSettings()),
          shortcut: (c, i) => shortcutButton({ kind: "commute", id: String(i), label: `${c.from.name} → ${c.to.name}` }),
        });
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
      onMove: (f, to) => saveFavourites(moveFavourite(favs, f, to)),
      limit: favLimit(),
      middle,
      shortcut: (f) =>
        f.type === "station" ? shortcutButton({ kind: "station", id: f.id, label: f.name }) : shortcutButton({ kind: "train", id: f.number, label: f.label || f.number }),
    }),
  );
}

/** Open what a link asks for (app link or the web's ?train= / ?station=);
 * one for another country (a home-screen shortcut) reloads in that country
 * with the same request. */
function openLink(link) {
  if (!link) return;
  if (link.country && link.country !== country && COUNTRY_LIST.includes(link.country)) {
    store.set(COUNTRY_KEY, link.country);
    const u = new URL(location.href);
    for (const k of ["train", "station", "commute"]) u.searchParams.delete(k);
    u.searchParams.set("country", link.country);
    if (link.type === "train") u.searchParams.set("train", link.number);
    else if (link.type === "station") u.searchParams.set("station", link.id);
    else u.searchParams.set("commute", String(link.index));
    return location.replace(u.toString());
  }
  if (!engine) return;
  if (link.type === "commute") {
    if (!CONFIG.pro || !commutes.list[link.index]) return;
    saveCommutes(selectCommute(commutes, link.index));
    openSheet("commute");
    return renderCommute();
  }
  if (link.type === "train") {
    const info = liveTrain(link.number);
    if (info) return selectTrain(info, { fly: true });
    // The first trains can be on the map before the linked one's data:
    // give it a few seconds before falling back to the search.
    const tries = link.tries || 0;
    if (tries < 10) return void setTimeout(() => openLink({ ...link, tries: tries + 1 }), 1000);
    $("search-q").value = link.number; // not running now: show what search finds
    return renderSearch();
  }
  const st = JSON.parse(engine.stationsGeoJson()).features.find((x) => x.properties.id === link.id);
  if (st) openStation({ id: st.properties.id, name: st.properties.name, lon: st.geometry.coordinates[0], lat: st.geometry.coordinates[1] });
}

/** Android back button: close the top-most thing; false when nothing was open. */
function goBack() {
  // The moviola hides the sheets: Back acts on it, not on a hidden sheet.
  if (replay) {
    if (replayPop?.isOpen()) replayPop.remove();
    else stopReplay();
    return true;
  }
  if (sheets.back()) return true;
  const sheet = SHEETS.map($).find((x) => !x.hidden);
  if (sheet) return (sheet.hidden = true), true;
  if (popup) return popup.remove(), true;
  if (stationPop?.isOpen()) return stationPop.remove(), true;
  if (!$("search-results").hidden) return ($("search-results").hidden = true), true;
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
  // Places: cities, stations, provinces, communities (typos forgiven).
  const done = () => {
    ul.hidden = true;
    $("search-q").value = "";
    $("search-q").blur();
  };
  const places = /^\d+$/.test(q) ? [] : searchPlaces(q, stationList(), 6);
  const placeRows = places.map((h) =>
    el(
      "li",
      {},
      el(
        "button",
        {
          class: `link search-place search-${h.kind}`,
          "data-kind": h.kind,
          onclick: () => {
            done();
            if (h.kind === "station") openStation(h.item);
            else goToNetwork(`${{ city: "city", province: "prov", community: "ccaa" }[h.kind]}:${h.item.code}`);
          },
        },
        icon(PLACE_ICON[h.kind], 16),
        el("strong", {}, h.item.name),
        el("span", { class: "muted" }, ` · ${placeKind(lang, h.kind)}`),
      ),
    ),
  );
  // Origin → destination: "Madrid a Sevilla" straight away; else a way in.
  const end = (text) => searchPlaces(text, stationList(), 1, ["city", "station"])[0] || null;
  const pair = parseRoute(q);
  const ends = pair && { from: end(pair.from), to: end(pair.to) };
  const routeRows = [];
  if (ends?.from && ends?.to) {
    routeRows.push(
      el(
        "li",
        {},
        el(
          "button",
          { class: "link search-route", id: "search-route-go", onclick: () => (done(), openRoute(ends.from, ends.to)) },
          icon("arrowRight", 16),
          el("strong", {}, t(lang, "routeGo", { from: ends.from.item.name, to: ends.to.item.name })),
          el("span", { class: "muted" }, ` · ${t(lang, "routeGoSub")}`),
        ),
      ),
    );
  }
  const first = places.find((h) => h.kind === "city" || h.kind === "station") || null;
  const routeOpen =
    q.length >= 2 && !/^\d+$/.test(q)
      ? el(
          "li",
          {},
          el("button", { class: "link search-route muted", id: "search-route", onclick: () => (done(), openRoute(ends?.from || first, ends?.to || null)) }, icon("arrowRight", 16), t(lang, "routeOpen")),
        )
      : null;
  const stationRows = [...placeRows, ...(routeOpen ? [routeOpen] : [])];
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
  // Any train number (or a UK headcode): its timetable on another day.
  const dayN = /^\d{2,6}$/.test(q) ? q.replace(/^0+/, "") : /^\d[A-Za-z]\d\d$/.test(q) ? q.toUpperCase() : "";
  const dayRow = dayN
    ? el(
        "li",
        {},
        el(
          "button",
          {
            class: "link muted search-route",
            id: "search-trainday",
            onclick: () => {
              ul.hidden = true;
              $("search-q").value = "";
              openTrainDay(dayN);
            },
          },
          icon("clock", 16),
          t(lang, "trainDayOpen", { n: dayN }),
        ),
      )
    : null;
  if (!hits.length && !placeRows.length && !routeRows.length)
    return ul.replaceChildren(...(offRow ? [offRow] : [el("li", { class: "muted" }, t(lang, "searchNone"))]), ...(dayRow ? [dayRow] : []), ...(routeOpen ? [routeOpen] : []));
  ul.replaceChildren(
    ...routeRows,
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
    ...(dayRow ? [dayRow] : []),
    ...stationRows,
  );
}

/*
 * Phone layout (≤ 719 px, and the Android app): bottom sheets with snap
 * points (js/sheet.js) and an app tab bar instead of the floating buttons.
 * The home sheet is the Delays list, peeking with a summary.
 */
const HOME_HIDDEN_KEY = "home-hidden"; // "Retrasos ahora" pulled down out of the way
const sheets = new Sheets({
  home: "delayed",
  tabbar: $("tabbar"),
  scrim: $("scrim"),
  restore: $("delayed-show"),
  homeHidden: store.get(HOME_HIDDEN_KEY) === "1",
  onHomeHidden: (hidden) => store.set(HOME_HIDDEN_KEY, hidden ? "1" : ""),
  onChange: () => updateTabs(),
  onSnap: () => haptic(),
});
for (const id of SHEETS) {
  const tall = id === "networks" || id === "layers-panel" || id === "route";
  sheets.add($(id), id === "delayed" ? { initial: "peek", closable: false } : tall ? { initial: "full", snaps: ["half", "full"] } : { initial: "half" });
}
// Phone: swipe the detail sheet sideways for the next or previous favourite.
// Touch events: a pointer would be cancelled as soon as the sheet scrolls.
{
  let sw = null;
  const d = $("detail");
  d.addEventListener(
    "touchstart",
    (e) => {
      const p = e.touches[0];
      sw = e.touches.length === 1 && !e.target.closest("input, select, textarea, canvas, .fav-handle") ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
    },
    { passive: true },
  );
  d.addEventListener(
    "touchend",
    (e) => {
      const p = e.changedTouches[0];
      if (!sw || !p) return;
      const dx = p.clientX - sw.x;
      const dy = p.clientY - sw.y;
      const quick = Date.now() - sw.t < 800;
      sw = null;
      if (quick && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && stepFavourite(dx < 0 ? 1 : -1)) haptic();
    },
    { passive: true },
  );
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
  if (["more", "about", "langs", "settings", "trips", "history", "commute"].includes(sheet)) return "more";
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

/** Left-handed mode (phone): map buttons, credits and close buttons on
 * the other side, within reach of the left thumb. Remembered. */
const LEFTY_KEY = "lefty";
const lefty = () => document.body.classList.contains("lefty");
function setLefty(on) {
  document.body.classList.toggle("lefty", on);
  store.set(LEFTY_KEY, on ? "1" : "");
  renderMore();
}
document.body.classList.toggle("lefty", store.get(LEFTY_KEY) === "1");

/** "Más": language, settings, the Pro tools (app) and About. */
let moreWidgetInfo = false;
let moreMsg = ""; // e.g. notifications refused
function renderMore() {
  if ($("more").hidden) return;
  const row = (ic, label, value, onclick, id, attrs = {}) =>
    el(
      "li",
      {},
      el(
        "button",
        { type: "button", class: "menu-row", id, onclick, ...attrs },
        icon(ic),
        el("span", { class: "menu-label" }, label),
        value ? el("span", { class: "menu-value" }, value) : null,
        icon("chevronRight", 18),
      ),
    );
  const toSettings = () => {
    openSheet("settings");
    renderSettings();
  };
  // Pro tools (Android app): each opens its screen; without Pro, the Pro offer.
  const pro = CONFIG.pro;
  const proTag = pro ? "" : "Pro";
  const proRows =
    CONFIG.platform !== "android"
      ? []
      : [
          el("h3", { class: "group-h" }, "TrainRadar Pro"),
          el(
            "ul",
            { class: "menu-list", id: "more-pro" },
            row("suitcase", t(lang, "tripsTitle"), proTag, pro ? () => (openSheet("trips"), fillArrivals(), renderTrips()) : toSettings, "trips-btn"),
            replaySource() || !pro ? row("replay", t(lang, "replayTitle"), proTag, pro ? () => startReplay() : toSettings, "replay-btn") : null,
            row("pin", t(lang, "commuteTitle"), proTag, pro ? () => (openSheet("commute"), renderCommute()) : toSettings, "commute-btn"),
            appNative.available() || !pro
              ? row("bell", t(lang, "moreAlerts"), pro ? t(lang, alertsOn ? "moreOn" : "moreOff") : proTag, pro ? () => setAlerts(!alertsOn) : toSettings, "alerts-btn", { "aria-pressed": String(!!(pro && alertsOn)) })
              : null,
            row("chart", t(lang, "moreWidget"), proTag, pro ? () => ((moreWidgetInfo = !moreWidgetInfo), renderMore()) : toSettings, "widget-btn", { "aria-expanded": String(moreWidgetInfo) }),
          ),
          moreMsg ? el("p", { class: "small warn", id: "more-msg" }, moreMsg) : null,
          pro && moreWidgetInfo ? el("p", { class: "small muted", id: "widget-help" }, t(lang, "moreWidgetHow")) : null,
          pro && alertsOn ? el("p", { class: "small muted" }, t(lang, "alertsNote")) : null,
          !ES && appNative.available() ? el("p", { class: "small muted", id: "native-spain-only" }, t(lang, "nativeSpainOnly")) : null,
        ];
  const general = el(
      "ul",
      { class: "menu-list" },
      row("globe", t(lang, "moreLanguage"), t(lang, "moreLanguageValue"), openLangs, "more-lang"),
      row("settings", t(lang, CONFIG.platform === "android" ? "moreSettingsPro" : "moreSettings"), "", toSettings, "more-settings"),
      row("swap", t(lang, "moreLefty"), t(lang, lefty() ? "moreLeftyOn" : "moreLeftyOff"), () => setLefty(!lefty()), "more-lefty", { "aria-pressed": String(lefty()) }),
      row("info", t(lang, "moreAbout"), "", () => {
        openSheet("about");
        renderAbout();
      }, "more-about"),
      // A link, so the phone opens it in the browser (GitHub).
      el(
        "li",
        {},
        el(
          "a",
          { class: "menu-row", id: "more-feedback", href: CONFIG.issuesUrl, target: "_blank", rel: "noopener" },
          icon("message"),
          el("span", { class: "menu-label" }, t(lang, "moreFeedback"), el("small", { class: "menu-sub" }, t(lang, "moreFeedbackSub"))),
          icon("arrowUpRight", 18),
        ),
      ),
    );
  // With Pro its tools come first: they're what this tab is mostly for.
  const pros = proRows.filter(Boolean);
  $("more-body").replaceChildren(...(pro ? [...pros, el("h3", { class: "group-h" }, t(lang, "moreGeneral")), general] : [general, ...pros]));
}

/** The home sheet's "Delays now": trains 15+, 5–14 min late and on time.
 * Built once (and per language); afterwards only the numbers change, so a
 * tap never lands on a box being replaced. */
let summaryLang = "";
function renderHomeSummary(st, pos) {
  const c = [0, 0, 0, 0];
  for (let i = 0; i + 5 < pos.length; i += 6) if (!(pos[i + 5] & FLAG.scheduled)) c[pos[i + 2]] += 1;
  if (summaryLang !== lang) {
    summaryLang = lang;
    const bucket = (cls, key) =>
      el(
        "button",
        { type: "button", class: `bucket bucket-${cls}`, onclick: () => sheets.setSnap("delayed", "half") },
        el("span", { class: "bucket-label" }, t(lang, key)),
        el("span", { class: "bucket-n", id: `bucket-${cls}-n` }),
      );
    $("delayed-summary").replaceChildren(
      el(
        "div",
        { class: "summary-head" },
        el("h2", {}, t(lang, "delayedNow")),
        el("span", { class: "muted", id: "summary-of" }),
        el("button", { type: "button", class: "icon-btn summary-hide", id: "delayed-hide", "aria-label": t(lang, "delayedHide"), title: t(lang, "delayedHide"), onclick: () => sheets.hideHome(true) }, icon("chevronDown", 18)),
      ),
      el("div", { class: "buckets" }, bucket("major", "bucketMajor"), bucket("minor", "bucketMinor"), bucket("ontime", "bucketOnTime")),
      // Trains by timetable (Northern Ireland's, OUIGO's): counted here, not
      // in the map's chips.
      el("p", { class: "muted small summary-sched", id: "summary-sched" }),
    );
  }
  const set = (id, text) => {
    const e = $(id);
    if (e.textContent !== text) e.textContent = text;
  };
  set("summary-of", t(lang, "delayedOf", { n: formatCount(lang, st.delayed), total: formatCount(lang, st.trains) }));
  set("summary-sched", st.scheduled ? t(lang, COUNTRY_TEXT[country].scheduled, { n: formatCount(lang, st.scheduled) }).replace(/^\+\s*/, "") : "");
  const show = $("delayed-show");
  if (show.dataset.lang !== lang) {
    show.dataset.lang = lang;
    show.replaceChildren(icon("chevronUp", 16), el("span", {}, t(lang, "delayedNow")), el("span", { class: "delayed-show-n", id: "delayed-show-n" }));
    show.setAttribute("aria-label", t(lang, "delayedShow"));
  }
  set("delayed-show-n", formatCount(lang, st.delayed));
  set("bucket-major-n", formatCount(lang, c[2]));
  set("bucket-minor-n", formatCount(lang, c[1]));
  set("bucket-ontime-n", formatCount(lang, c[0]));
}

/** Phone top bar and map buttons: icons and labels (once per language). */
function phoneChrome() {
  // Close buttons: an SVG cross instead of the ✕ character (labelled).
  for (const b of document.querySelectorAll('.sheet-head button[id$="-close"], #app-banner-close, #country-note-close')) b.replaceChildren(icon("close", 18));
  $("route-swap").replaceChildren(icon("swap", 20));
  $("search-icon").replaceChildren(icon("search", 20));
  $("net-chip").replaceChildren(el("span", { id: "net-chip-l" }, netName()), icon("chevronDown", 16));
  $("net-chip").setAttribute("aria-label", t(lang, "netChipLabel", { name: netName() }));
  const dot = (c, label) => el("span", {}, el("i", { style: `background:${c}` }), label);
  $("legend-chip").replaceChildren(dot("#16a34a", "<5"), dot("#ea8a0c", "5–14"), dot("#dc2626", "15+"));
  $("legend-chip").setAttribute("aria-label", t(lang, "legendChipLabel"));
  $("legend-chip").setAttribute("role", "img");
  $("pro-chip").setAttribute("aria-label", t(lang, "proChipLabel"));
  $("fab-layers").replaceChildren(icon("layers", 22));
  $("fab-layers").setAttribute("aria-label", t(lang, "layers"));
  $("fab-locate").replaceChildren(icon("locate", 22));
  $("fab-locate").setAttribute("aria-label", t(lang, "fabLocate"));
}

/** The network the map shows: the Cercanías núcleo under its centre, else Spain. */
let netPinned = null; // the network just picked, until the user moves the map
function currentNetwork() {
  if (netPinned) return netPinned === "es" ? null : placeByCode(netPinned) || ref?.region(netPinned) || placeArea(netPinned) || null;
  // The UK and Ireland are one network each here (Great Britain's box also
  // covers Northern Ireland).
  if (!ES || !map || !ref || map.getZoom() < 7.5) return null;
  const c = map.getCenter();
  return (ref.regionsIn([c.lng, c.lat, c.lng, c.lat]) || []).find((r) => r.code !== "ld" && r.live !== false) || null;
}
const netName = () => {
  const n = currentNetwork();
  if (n) return n.code && ref?.region(n.code) ? areaName(n.name) : n.name;
  return ES ? t(lang, "netSpain") : countryName(country);
};
/** This country's areas (country.js), for the drop-downs: its timetable's,
 * and where that has fewer than two, the regions of areas.json that have
 * stations (the UK's regions, Sweden's counties…). */
let placesDoc = null;
const placesReady = ES
  ? Promise.resolve(null)
  : fetch("areas.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (placesDoc = d))
      .catch(() => null);
const countryAreas = () => withPlaces(areasOf(ref?.manifest, country, lang), placesDoc, country, lang, ref ? stationList() : []);
/** An area of areas.json by its code ("adm:uk:greater-london"). */
const placeArea = (code) => (String(code).startsWith("adm:") ? countryAreas().find((a) => a.code === code) || null : null);

function updateNetChip() {
  const l = $("net-chip-l");
  if (!l) return;
  const name = netName();
  if (l.textContent !== name) {
    l.textContent = name;
    $("net-chip").setAttribute("aria-label", t(lang, "netChipLabel", { name }));
  }
}

/** Desktop (≥ 900 px): the map key as a small card at the map's bottom
 * left, folded or open as the user left it (on a phone it's in Capas). */
const LEGEND_KEY = "legend-open";
function renderLegend() {
  const open = store.get(LEGEND_KEY) !== "0";
  const toggle = () => {
    store.set(LEGEND_KEY, open ? "0" : "1");
    renderLegend();
  };
  $("legend").replaceChildren(
    el(
      "button",
      { type: "button", class: "legend-toggle", id: "legend-toggle", "aria-expanded": String(open), onclick: toggle },
      el("span", {}, t(lang, "legendTitle")),
      icon(open ? "chevronDown" : "chevronUp", 16),
    ),
    open
      ? el(
          "div",
          { class: "legend-body" },
          el("div", { class: "legend-row" }, ...legend(lang)),
          el("div", { class: "legend-row" }, ...serviceLegend(lang, true, ES)),
          // The cab-ride layer, while it shows.
          show.cab && !ridesNone ? el("div", { class: "legend-row" }, el("i", { class: "cab-key", "aria-hidden": "true" }), t(lang, "cabTitle")) : null,
        )
      : null,
  );
}

/** Two chips: "498 trenes" with a dot (green live, orange stale, red
 * failing; pulsing while the first trains load) and "Mediana +2 min". */
function renderLiveChip(st, now) {
  const median = $("median-chip");
  const loading = !engine || (st.trains + st.scheduled === 0 && !(feeds?.lastUpdate() || 0) && !TIMETABLE_ONLY);
  if (loading) {
    $("live-text").textContent = t(lang, "loadingTrains");
    $("live-chip").dataset.state = "loading";
    median.hidden = true;
    return;
  }
  if (TIMETABLE_ONLY) {
    // A grey dot: by timetable, no live data to be stale or failing.
    $("live-text").textContent = t(lang, "trains", { n: formatCount(lang, st.trains + st.scheduled) });
    $("live-chip").dataset.state = "timetable";
    $("live-chip").title = t(lang, "timetableOnly");
    median.hidden = true;
    return;
  }
  const last = feeds?.lastUpdate() || 0;
  const age = last ? (now - last) / 1000 : Infinity;
  const state = feeds?.failing() ? "bad" : age > 120 ? "stale" : "ok";
  // Trains by timetable (Northern Ireland's, OUIGO's) are counted in the
  // delays sheet, not here: the chip stays one short line.
  $("live-text").textContent = t(lang, "trains", { n: formatCount(lang, st.trains) });
  $("live-chip").dataset.state = state;
  $("live-chip").title = state === "bad" ? t(lang, ES ? "feedError" : "feedErrorOther") : last ? t(lang, "updated", { age: formatAgo(lang, age) }) : t(lang, "loading");
  median.textContent = formatMedian(lang, st.median_delay);
  median.hidden = !median.textContent;
}

/** Phone: the network picker ("Ir a…" on the desktop). */
let netQuery = "";
function openNetworks() {
  netQuery = "";
  openSheet("networks");
  renderNetworks();
}

/** Go to a network (núcleo code, "es" for all of Spain, or a place code:
 * "prov:28", "ccaa:md", "city:madrid"), as "Ir a…" does. */
function goToNetwork(code) {
  netPinned = code;
  // Remembered per country: the next visit (and the area picker) starts there.
  store.set(areaKey(country), code === "es" ? "" : code);
  updateNetChip();
  if (code === "es") return map.flyTo({ center: CONFIG.center, zoom: CONFIG.zoom });
  const place = placeByCode(code);
  const bbox = place ? place.bbox || cityBox(place) : ref?.region(code)?.bbox || placeArea(code)?.bbox;
  if (bbox) fitBox(bbox, place && !place.bbox ? 13 : 11);
}

/** Show a box [s, w, n, e] clear of the phone's top bar and sheet. */
function fitBox(bbox, maxZoom = 11) {
  const pad = isPhone() ? { top: 130, bottom: ($("tabbar").offsetHeight || 0) + 180, left: 24, right: 24 } : 40;
  map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: pad, maxZoom });
}

/** Median delay (s) of the Cercanías trains in each núcleo, now. */
function networkMedians() {
  const rows = engine ? JSON.parse(engine.replayFrameJson(Date.now())) : [];
  const nucleos = (ref?.manifest?.regions || []).filter((r) => r.code !== "ld" && r.live !== false && r.bbox);
  const by = new Map(nucleos.map((r) => [r.code, []]));
  for (const [, , , , lon, lat, , delay, flags] of rows) {
    if (delay === null || !(flags & FLAG.commuter) || flags & FLAG.scheduled) continue;
    const r = nucleos.find((x) => lat >= x.bbox[0] && lat <= x.bbox[2] && lon >= x.bbox[1] && lon <= x.bbox[3]);
    if (r) by.get(r.code).push(delay);
  }
  const med = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  return { nucleos, medians: new Map([...by].map(([k, v]) => [k, med(v)])), trains: rows.length };
}

function renderNetworks(keepInput = false) {
  const { nucleos, medians, trains } = networkMedians();
  const pick = (code) => {
    $("networks").hidden = true;
    goToNetwork(code);
  };
  let near = null;
  if (userFix) {
    const d = 0.05;
    const r = (ref?.regionsIn([userFix.lon - d, userFix.lat - d, userFix.lon + d, userFix.lat + d]) || []).find((x) => x.code !== "ld" && x.live !== false);
    near = r ? { name: r.name, onPick: () => pick(r.code) } : {};
  } else if (Locator.supported()) {
    near = { onLocate: () => startLocation() };
  }
  const parts = networksSheet(lang, {
    query: netQuery,
    near,
    spain: { trains, onPick: () => pick("es"), label: ES ? null : t(lang, COUNTRY_TEXT[country].all) },
    countries: !MULTI_COUNTRY
      ? null
      : [
          ...countryChoices().map((c) => ({ code: c, name: countryName(c), current: c === country, onPick: () => switchCountry(c) })),
          // The website: every country at once (zoomed out).
          { code: "overview", name: t(lang, "allCountries"), current: false, onPick: () => (($("networks").hidden = true), showOverview()) },
        ],
    // The area drop-down: the country's areas (Spain: núcleos, then its
    // communities and provinces).
    areas: countryAreas(),
    areaGroups: !ES
      ? []
      : [
          { label: t(lang, "netCommunities"), items: byName(COMMUNITIES).map((c) => ({ code: `ccaa:${c.code}`, name: c.name })) },
          { label: t(lang, "netProvinces"), items: byName(PROVINCES).map((p) => ({ code: `prov:${p.code}`, name: p.name })) },
        ],
    area: netPinned && netPinned !== "es" ? netPinned : currentNetwork()?.code || null,
    allLabel: ES ? t(lang, "allSpain") : t(lang, COUNTRY_TEXT[country].all),
    // Spain lists its Cercanías networks; elsewhere, the country's areas.
    groupLabel: ES ? null : t(lang, "netAreas"),
    searchLabel: ES ? null : t(lang, "netSearchArea"),
    // Spain's núcleos (with their medians), communities and provinces; other
    // countries' areas.
    networks: !ES
      ? countryAreas().map((a) => ({ code: a.code, name: a.name, median: undefined }))
      : [...nucleos].sort((a, b) => a.name.localeCompare(b.name, "es")).map((r) => ({ code: r.code, name: r.name, median: medians.get(r.code) })),
    communities: !ES ? [] : byName(COMMUNITIES).map((c) => ({ code: `ccaa:${c.code}`, name: c.name, alt: c.alt })),
    provinces: !ES ? [] : byName(PROVINCES).map((p) => ({ code: `prov:${p.code}`, name: p.name, alt: p.alt })),
    onPick: pick,
    onQuery: (q) => {
      netQuery = q;
      renderNetworks(true);
    },
  }).filter(Boolean);
  const body = $("networks-body");
  if (keepInput && body.firstChild) body.replaceChildren(body.firstChild, ...parts.slice(1));
  else body.replaceChildren(...parts);
}

/** Phone: "Capas" as a sheet of switches, each driving its desktop checkbox. */
function openLayers() {
  openSheet("layers-panel");
  renderLayers();
}

function renderLayers() {
  const sw = (id, labelKey, hint) => {
    const box = $(id);
    return {
      id,
      label: t(lang, labelKey),
      hint: hint ? t(lang, hint) : "",
      on: box.checked,
      onChange: (on) => {
        box.checked = on;
        box.dispatchEvent(new Event("change"));
      },
    };
  };
  const base = document.querySelector('input[name="basemap"]:checked')?.value || "standard";
  cabIndex(); // to know whether the country has cab-ride videos (the switch)
  const key = el(
    "div",
    { class: "map-key", id: "map-key" },
    el("h3", { class: "group-h" }, t(lang, "legendTitle")),
    el("p", { class: "legend-row" }, el("span", { class: "legend-head" }, `${t(lang, "legendDelay")}:`), ...legend(lang)),
    el("p", { class: "legend-row" }, ...serviceLegend(lang, false, ES)),
    // Spain's station key (long-distance and Cercanías interchanges).
    ES ? el("p", { class: "small muted" }, t(lang, "legendStations")) : null,
    // The cab-ride layer, while it shows.
    show.cab && !ridesNone ? el("p", { class: "legend-row" }, el("i", { class: "cab-key", "aria-hidden": "true" }), t(lang, "cabTitle")) : null,
  );
  $("layers-panel-body").replaceChildren(
    key,
    ...layersSheet(lang, {
      base,
      onBase: (v) => {
        const r = document.querySelector(`input[name="basemap"][value="${v}"]`);
        r.checked = true;
        r.dispatchEvent(new Event("change"));
        renderLayers();
      },
      groups: [
        {
          title: t(lang, "groupTrains"),
          // Spain's own names (Cercanías, AVE, OUIGO); elsewhere, the kinds of service.
          items: ES
            ? [sw("f-commuter", "showCommuter"), sw("f-av", "showAv"), sw("f-ld", "showLd"), sw("f-md", "showMd"), sw("f-scheduled", "showScheduled", "scheduledHint")]
            : [sw("f-commuter", "kindSuburban"), sw("f-av", "kindHighSpeed"), sw("f-ld", "kindLongDistance"), sw("f-md", "kindRegional"), sw("f-scheduled", "kindTimetable", "scheduledHint")],
        },
        {
          title: t(lang, "groupMap"),
          items: [
            sw("f-lines", ES ? "showLines" : "showLinesOther"),
            sw("f-tav", "showTrackAv"),
            sw("f-tld", "showTrackLd"),
            sw("f-tmd", "showTrackMd"),
            sw("f-stations", "showStations"),
            // Countries with cab-ride videos (all but a few): the filmed stretches.
            ridesNone ? null : sw("f-cab", "cabTitle", "cabLayerHint"),
          ].filter(Boolean),
        },
        {
          title: t(lang, "groupIncidents"),
          items: [
            sw("f-k-disruption", "kind_disruption"),
            sw("f-k-works", "kind_works"),
            sw("f-k-accessibility", "kind_accessibility"),
            sw("f-k-strike", "kind_strike"),
            sw("f-k-other", "kind_other"),
            // Stopped trains come from Renfe's GPS: Spain only.
            ES ? sw("f-stopped", "showStopped") : null,
          ].filter(Boolean),
        },
      ],
    }).flat(),
  );
}

/*
 * Origin → destination: how to get there in the next hours between two
 * stations or cities (any of a city's main stations), direct or with up to
 * two changes, from the timetables with live delays (engine.journeysJson).
 */
const ROUTE_HORIZON = 6 * 3600;
const route = { from: null, to: null }; // {kind: "station" | "city", item}
let routeWhen = null; // Cómo llegar from a chosen date and time (ms), or now
let routeCache = { key: "", at: 0, journeys: [] }; // the last search

function openRoute(from = route.from, to = route.to) {
  route.from = from;
  route.to = to;
  openSheet("route");
  $("route-from").value = from?.item.name || "";
  $("route-to").value = to?.item.name || "";
  $("route-sugg").hidden = true;
  renderRoute();
  // Ask for the missing end (not on a phone with both set: no keyboard).
  if (!from) $("route-from").focus();
  else if (!to) $("route-to").focus();
}

function renderRoute() {
  if ($("route").hidden || !engine) return;
  const { from, to } = route;
  const body = $("route-body");
  if (!from || !to) return body.replaceChildren(el("p", { class: "small muted", id: "route-help" }, t(lang, "routeHelp")));
  const a = endStations(from, stationList());
  const b = endStations(to, stationList());
  // Their Cercanías timetables may not be loaded yet: load, then redraw.
  const d = 0.05;
  for (const st of [...a, ...b]) {
    for (const r of ref?.regionsIn([st.lon - d, st.lat - d, st.lon + d, st.lat + d]) || []) {
      if (!ref.loaded.has(r.code)) ref.loadRegion(r.code).then(renderRoute).catch(() => {});
    }
  }
  // Direct trains and journeys with up to 2 changes (engine journeys.rs).
  // A search can take a good part of a second on a phone (Great Britain):
  // again only when the ends or the loaded timetables change, or each
  // minute for the live delays, not on every feed refresh.
  const ids = [a.map((x) => x.id).join(","), b.map((x) => x.id).join(",")];
  const when = routeWhen;
  const field = whenFor("route-when", when, (ms) => {
    routeWhen = ms;
    renderRoute();
  });
  if (when) {
    // A chosen date: the plan-ahead engine (timetable only).
    const key = [...ids, when].join("|");
    if (routeCache.key !== key) {
      routeCache = { key, at: Date.now(), journeys: null };
      getPlanner()
        .ready([...a, ...b].map((x) => [x.lon, x.lat]))
        .then((e) => {
          if (routeCache.key !== key) return;
          routeCache.journeys = JSON.parse(e.journeysJson(ids[0], ids[1], when, 2, 10, ROUTE_HORIZON));
          renderRoute();
        })
        .catch((e) => {
          console.warn("plan", e);
          if (routeCache.key === key) (routeCache.journeys = []), renderRoute();
        });
    }
    if (!routeCache.journeys) return body.replaceChildren(field, el("p", { class: "small muted", id: "route-loading" }, t(lang, "planLoading")));
  } else {
    const key = [...ids, ref?.loaded.size || 0].join("|");
    if (routeCache.key !== key || Date.now() - routeCache.at > 60_000) {
      routeCache = { key, at: Date.now(), journeys: JSON.parse(engine.journeysJson(ids[0], ids[1], Date.now(), 2, 10, ROUTE_HORIZON)) };
    }
  }
  const journeys = routeCache.journeys;
  // Redrawn on every live refresh: keep the journey the user opened open.
  const openKey = body.querySelector("details.journey[open]")?.dataset.key;
  body.replaceChildren(
    ...[field, when ? el("p", { class: "small muted", id: "route-planned" }, t(lang, "plannedNote")) : null].filter(Boolean),
    ...journeyResults(lang, {
      from,
      to,
      journeys,
      onTrain: (r) => {
        const info = liveTrain(r.number);
        if (info) selectTrain(info, { fly: true });
      },
      onSave: (j) => saveRouteJourney(j),
      openKey,
    }),
  );
}

/** Today's day of the week in the country (1 Monday … 7 Sunday), or `ms`'s. */
function isoToday(ms = Date.now()) {
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.timeZone, weekday: "short" }).format(new Date(ms));
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
}

/** "Guardar" on a journey (Pro): onto the commute between its stations. */
function saveRouteJourney(j) {
  if (!CONFIG.pro) {
    settingsMsg = moreMsg = t(lang, "jSavePro");
    return openSheet("settings"), renderSettings();
  }
  const rides = j.steps.filter((x) => x.kind === "ride");
  const stationOf = (id) => stationList().find((x) => x.id === id);
  const from = stationOf(rides[0].from);
  const to = stationOf(rides[rides.length - 1].to);
  // A journey found for a later date: its days default from that day.
  const saved = journeyToSave(j, formatClock, isoToday(j.dep * 1000));
  if (!from || !to || !saved) return;
  const r = saveJourney(commutes, { from: { id: from.id, name: from.name, lon: from.lon, lat: from.lat }, to: { id: to.id, name: to.name, lon: to.lon, lat: to.lat } }, saved);
  commuteNote = r.full ? t(lang, "jFull", { n: MAX_COMMUTES }) : t(lang, "jSavedOk", { from: from.name, to: to.name });
  if (r.added) saveCommutes(r.state, () => {}, true);
  else (openSheet("commute"), renderCommute());
  // Its alerts come from the background check: on with the first journey.
  if (r.added && ES && appNative.available() && !alertsOn) setAlerts(true).catch(() => {});
}

/** Today's live state of each train of a saved journey: from its first
 * station's board (before it leaves), else the train on the map. */
function journeyRuns(journey) {
  const same = (a, b) => String(a).replace(/^0+/, "") === String(b).replace(/^0+/, "");
  return journey.legs.map((l) => {
    const board = JSON.parse(engine.stationBoardJson(l.from, Date.now(), 12 * 3600, 200));
    const row = board.find((r) => same(r.number, l.number) && formatClock(r.sched) === l.dep);
    if (row) return { delay: row.delay ?? null, canceled: !!row.canceled };
    const info = liveTrain(l.number);
    return info ? { delay: info.delay ?? null, canceled: false, platform: info.platform || null } : null;
  });
}

/** Suggestions under the field being typed in. */
function routeSuggest(field) {
  const input = $(`route-${field}`);
  const ul = $("route-sugg");
  route[field] = null;
  renderRoute();
  const hits = searchPlaces(input.value, stationList(), 8, ["city", "station"]);
  ul.hidden = !hits.length;
  ul.dataset.field = field;
  ul.replaceChildren(
    ...hits.map((h) =>
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", class: "route-sugg-row", "data-kind": h.kind, onclick: () => routePick(field, h) },
          icon(PLACE_ICON[h.kind], 16),
          el("strong", {}, h.item.name),
          el("span", { class: "muted" }, ` · ${placeKind(lang, h.kind)}`),
        ),
      ),
    ),
  );
}

function routePick(field, hit) {
  route[field] = { kind: hit.kind, item: hit.item };
  $(`route-${field}`).value = hit.item.name;
  $("route-sugg").hidden = true;
  const other = field === "from" ? "to" : "from";
  if (!route[other]) $(`route-${other}`).focus();
  else $(`route-${field}`).blur();
  renderRoute();
}

/*
 * "Añadir" on the Favourites and commute screens: search instead of
 * finding the thing on the map first. Their fields keep their own state,
 * so the lists below can redraw while you type.
 */
const stationHits = (q, n = 6) =>
  searchPlaces(q, stationList(), n, ["station"]).map((h) => ({
    key: `s:${h.item.id}`,
    icon: "pin",
    name: h.item.name,
    sub: t(lang, "searchStation"),
    value: { id: h.item.id, name: h.item.name, lon: h.item.lon, lat: h.item.lat },
  }));

function adderButton(open, labelKey, id, onclick) {
  return el("button", { class: "pill small adder-btn", type: "button", id, "aria-expanded": String(open), onclick }, icon(open ? "close" : "plus", 16), t(lang, open ? "addCancel" : labelKey));
}

let favAdding = false;
let favAddMsg = "";
function renderFavAdd() {
  const box = $("favs-add");
  box.dataset.lang = lang;
  const toggle = adderButton(favAdding, "favAddBtn", "fav-add", () => {
    favAdding = !favAdding;
    favAddMsg = "";
    renderFavAdd();
    if (favAdding) $("fav-q").focus();
  });
  if (!favAdding) return box.replaceChildren(toggle, favAddMsg ? el("p", { class: "small", id: "fav-add-msg" }, favAddMsg) : "");
  const field = pickField(lang, {
    id: "fav-q",
    label: t(lang, "favAddLabel"),
    placeholder: t(lang, "favAddPh"),
    search: (q) => [
      ...(engine ? JSON.parse(engine.searchJson(q, 4)) : []).map((h) => ({
        key: `t:${h.number}`,
        icon: "arrowRight",
        name: trainTitle(h),
        sub: h.destination ? `→ ${h.destination}` : "",
        value: { type: "train", number: h.number, label: trainTitle(h) },
      })),
      ...stationHits(q).map((h) => ({ ...h, value: { type: "station", ...h.value } })),
    ],
    onPick: (v) => {
      if (!v) return;
      const name = v.name || v.label;
      if (isFavourite(favs, v)) favAddMsg = t(lang, "favAddDup", { name });
      else {
        const r = toggleFavourite(favs, v, favLimit());
        if (r.full) favAddMsg = t(lang, "favFull", { n: favLimit() });
        else {
          favAddMsg = t(lang, "favAddDone", { name });
          saveFavourites(r.list);
        }
      }
      favAdding = false;
      renderFavAdd();
    },
  });
  box.replaceChildren(toggle, field);
}

let commuteAdding = false;
const commuteDraftAdd = { from: null, to: null };
function renderCommuteAdd() {
  const box = $("commute-add");
  box.dataset.lang = lang;
  const toggle = adderButton(commuteAdding, "commuteAddBtn", "commute-add-btn", () => {
    commuteAdding = !commuteAdding;
    commuteDraftAdd.from = commuteDraftAdd.to = null;
    renderCommuteAdd();
    if (commuteAdding) $("commute-add-from").focus();
  });
  if (!commuteAdding) return box.replaceChildren(toggle);
  const save = el("button", { class: "pill small pill-strong", type: "button", id: "commute-add-save", disabled: true }, t(lang, "commuteAddSave"));
  const ready = () => (save.disabled = !(commuteDraftAdd.from && commuteDraftAdd.to && commuteDraftAdd.from.id !== commuteDraftAdd.to.id));
  const field = (end, labelKey, phKey) =>
    pickField(lang, {
      id: `commute-add-${end}`,
      label: t(lang, labelKey),
      placeholder: t(lang, phKey),
      search: (q) => stationHits(q),
      onPick: (v) => {
        commuteDraftAdd[end] = v;
        ready();
        if (v && end === "from" && !commuteDraftAdd.to) $("commute-add-to").focus();
      },
    });
  save.addEventListener("click", () => {
    const r = setDestination(setOrigin(commutes, commuteDraftAdd.from), commuteDraftAdd.to);
    commuteNote = r.full ? t(lang, "commuteFull", { max: MAX_COMMUTES }) : "";
    commuteAdding = false;
    renderCommuteAdd();
    saveCommutes(r.state, renderCommute);
  });
  box.replaceChildren(toggle, el("div", { class: "adder-form" }, field("from", "routeFrom", "commuteAddFromPh"), field("to", "routeTo", "commuteAddToPh"), save));
}

/** Every station as {id, name, lat, lon, services}, for the searches. */
let stationIndex = null;
function stationList() {
  if (!engine) return [];
  stationIndex ??= JSON.parse(engine.stationsGeoJson()).features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    services: f.properties.services,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  return stationIndex;
}

/** A light tick when a sheet snaps (Android app only). */
function haptic() {
  nativeHaptic();
}

function renderAbout() {
  $("about-body").replaceChildren(
    ...aboutPanel(lang, {
      // Outside Spain: the country's own description and data sources.
      spain: ES,
      countryName: countryName(country),
      credit: attribution(),
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

/** A country's note on what it shows, until closed (on this device), as
 * { text, link: [label, url] } by country (none at present). */
const COUNTRY_NOTES = {};
function setupCountryNote() {
  const note = COUNTRY_NOTES[country];
  const key = `countryNote-${country}`;
  if (!note || store.get(key) === "closed") return false;
  $("country-note-text").replaceChildren(
    t(lang, note.text) + " ",
    el("a", { href: note.link[1], target: "_blank", rel: "noopener" }, t(lang, note.link[0])),
  );
  $("country-note-close").setAttribute("aria-label", t(lang, "close"));
  $("country-note").hidden = false;
  $("country-note-close").addEventListener("click", () => {
    store.set(key, "closed");
    $("country-note").hidden = true;
  });
  return true;
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

/** Each train's Cercanías line colour and "C5 +12" label, for the map
 * zoomed in (rows of replayFrameJson are in the same order as positions).
 * Refreshed every 2 s or when the trains change. */
let metaCache = { at: 0, n: -1, rows: [] };
function trainMeta(pos, now) {
  if (map.getZoom() < ARROW_ZOOM) return () => null;
  const n = pos.length / 6;
  if (n !== metaCache.n || now - metaCache.at > 2000) {
    const rows = JSON.parse(engine.replayFrameJson(now));
    metaCache = {
      at: now,
      n,
      rows: rows.map(([, route, number, , , , , delay, flags]) => {
        const cer = !!(flags & FLAG.commuter);
        return { lb: trainLabel(route, number, delay, cer, t(lang, "onTime")), lc: cer && route ? lineColors.get(`|${route}`) || null : null };
      }),
    };
  }
  return (i) => metaCache.rows[i] || null;
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
  map.getSource("trains")?.setData(trainsGeoJson(pos, highlight, hiddenByFilter, trainMeta(pos, now)));
  const st = JSON.parse(engine.statsJson(now));
  renderHomeSummary(st, pos);
  renderLiveChip(st, now);
  const scheduled = st.scheduled ? t(lang, COUNTRY_TEXT[country].scheduled, { n: st.scheduled }) : "";
  // Every train by timetable (no live data yet): just say how many.
  $("stats").textContent = !st.trains && st.scheduled ? t(lang, COUNTRY_TEXT[country]?.scheduledAll || "scheduledAll", { n: formatCount(lang, st.scheduled) }) : statsText(lang, st) + (scheduled ? ` ${scheduled}` : "");
  const last = feeds?.lastUpdate() || 0;
  $("status").textContent = TIMETABLE_ONLY
    ? t(lang, "timetableOnly")
    : feeds?.failing()
    ? t(lang, ES ? "feedError" : "feedErrorOther")
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
    renderRoute();
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
const REPLAY_STEP = 5 * 60_000; // ⏪ / ⏩: five minutes

const replaySource = () => (CONFIG.replay === false ? "" : CONFIG.replayBase || replayRoot(CONFIG.liveBase));

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
  map.getSource("trains")?.setData(replayGeoJson(trains, (route) => lineColors.get(`|${route}`) || null));
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
      el("strong", { class: "grow" }, t(lang, "replayTitle")),
      el("button", { class: "pill small", type: "button", id: "replay-live", onclick: stopReplay }, t(lang, "replayLive")),
    ),
    el(
      "div",
      { class: "row" },
      el("input", { type: "date", id: "replay-date", value: date, min, max: today, "aria-label": t(lang, "replayDate"), onchange: (e) => e.target.value && setReplayTime(madridToMs(e.target.value, $("replay-time").value || time)) }),
      el("input", { type: "time", id: "replay-time", value: time, "aria-label": t(lang, "replayTime"), onchange: (e) => e.target.value && setReplayTime(madridToMs($("replay-date").value || date, e.target.value)) }),
    ),
    el(
      "div",
      { class: "row" },
      el("button", { class: "pill small", type: "button", id: "replay-back", "aria-label": t(lang, "replayBack"), title: t(lang, "replayBack"), onclick: () => setReplayTime(replay.t - REPLAY_STEP) }, "⏪"),
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
      el("button", { class: "pill small", type: "button", id: "replay-fwd", "aria-label": t(lang, "replayForward"), title: t(lang, "replayForward"), onclick: () => setReplayTime(replay.t + REPLAY_STEP) }, "⏩"),
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
  // Where the app was left, else the country's default view.
  ({ map, attr } = createMap(
    "map",
    { ...CONFIG, ...(lastView ? { center: lastView.center, zoom: lastView.zoom } : {}), minZoom: MULTI_COUNTRY ? 1 : 4 },
    attribution(),
  ));
  map.on("moveend", saveView);
  // A drag by the user stops "Seguir".
  map.on("dragstart", (e) => {
    if (e.originalEvent && following) {
      setFollowing("");
      if (detailKind === "train") (detailKey = ""), showPopup(true);
    }
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveView());
  window.addEventListener("pagehide", saveView);
  // The credits start folded into their ⓘ (MapLibre opens compact credits
  // when the map loads): a tap opens them.
  map.once("load", foldCredits);
  map.once("idle", foldCredits);
  // Open credits close with a tap on the map or on their text (not a link).
  map.on("click", foldCredits);
  map.getContainer().addEventListener("click", (e) => {
    const box = e.target.closest?.(".maplibregl-ctrl-attrib.maplibregl-compact-show");
    if (box && !e.target.closest("a, summary, .maplibregl-ctrl-attrib-button")) foldCredits();
  });
  const mapReady = new Promise((r) => map.on("load", r));

  await init();
  engine = new Engine();
  engine.setCountry(country);
  ref = new RefData(engine, CONFIG.dataBase, CONFIG.remoteDataBase);
  ref.onGeometry = () => {
    refreshLines();
    refreshTrack();
  };
  try {
    await ref.start();
  } catch (e) {
    console.error(e);
    // Offline, a country not opened before has no copy on the device yet.
    $("status").textContent = navigator.onLine === false ? t(lang, "loadOffline", { country: countryName(country) }) : t(lang, "loadError");
    setTimeout(() => location.reload(), 30_000);
    return;
  }
  // A country without live feeds yet has nothing to poll.
  if (!TIMETABLE_ONLY) {
    feeds = new Feeds(engine, CONFIG.rtBase, {
      live: CONFIG.liveBase,
      onUpdate: (key) => {
        if (key === "alerts") renderIncidents();
        render(true);
      },
      onError: (k, e) => console.warn("feed", k, e.message),
    });
    feeds.start();
  } else {
    renderIncidents();
  }
  // New timetables (the site rebuilds them daily; they cover a week): a page
  // or app left open picks them up instead of running out of trains.
  const newData = () =>
    ref.refreshIfDue().then((changed) => {
      if (!changed) return;
      refreshLines();
      refreshTrack();
      render(true);
    });
  setInterval(newData, 10 * 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && newData());
  if (UK) {
    loadUkIncidents();
    setInterval(loadUkIncidents, 5 * 60_000);
  }
  if (REPORTS) {
    loadReports();
    setInterval(() => document.visibilityState === "visible" && loadReports(), 60_000);
  }

  await mapReady;
  setMapLanguage(map, lang);
  addLayers(map);
  if (MULTI_COUNTRY) addCountries(map, country);
  // The overview of every country, zoomed out (the website and the app).
  if (MULTI_COUNTRY) {
    addOverview(map);
    map.on("moveend", () => map.getZoom() < OVERVIEW_ZOOM && refreshOverview());
    // While it's open: the labels follow the half hour and the ten-minute
    // live counts.
    setInterval(() => map.getZoom() < OVERVIEW_ZOOM && refreshOverview(), 60_000);
    if (map.getZoom() < OVERVIEW_ZOOM) refreshOverview();
  }
  map.once("idle", foldCredits);
  if (store.get("basemap") === "satellite") {
    setBasemap(map, "satellite");
    document.querySelector('input[name="basemap"][value="satellite"]').checked = true;
  }
  setUserLayers();
  map.getSource("stations").setData(JSON.parse(engine.stationsGeoJson()));
  // The cab-ride layer, if it was left on (once the train layers, added
  // after their images load, are there too).
  if (show.cab) map.once("idle", applyLayerVisibility);
  map.on("moveend", loadVisibleRegions);
  map.on("moveend", updateNetChip);
  // A pan or zoom by the user: the chip follows the map again.
  for (const ev of ["dragstart", "zoomstart", "rotatestart"]) {
    map.on(ev, (e) => {
      if (e.originalEvent && netPinned) {
        netPinned = null;
        updateNetChip();
      }
    });
  }
  map.on("click", (e) => {
    const pad = 10; // generous tap target on phones
    if (replay) {
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: ["trains", "trains-ring"] },
      )[0];
      if (hit) showReplayTrain(hit.properties.i);
      else replayPop?.remove();
      return;
    }
    // The overview (zoomed out on the website): a click goes to the country.
    if (map.getLayer("countries-all") && map.getZoom() < OVERVIEW_ZOOM) {
      const c = map.queryRenderedFeatures(e.point, { layers: ["countries-all"] })[0]?.properties.code;
      if (c && c !== country && COUNTRY_LIST.includes(c)) return switchCountry(c);
      if (c === country) return map.flyTo({ center: CONFIG.center, zoom: CONFIG.zoom });
    }
    const hits = map.queryRenderedFeatures(
      [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ],
      { layers: ["trains", "trains-ring"] },
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
        { layers: ["stations-hit", "stations-ld-hit"].filter((l) => map.getLayer(l)) },
      );
      if (st.length) return showStation(st[0]);
      stationPop?.remove();
      // Another country's outline: offer to go there (one tap more, so a
      // stray tap near a border doesn't reload the page).
      const other = map.getLayer("countries-other") && map.queryRenderedFeatures(e.point, { layers: ["countries-other"] })[0];
      if (other && COUNTRY_LIST.includes(other.properties.code)) return offerCountry(other.properties.code, e.lngLat);
      countryPop?.remove();
      $("detail").hidden = true;
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
  for (const l of ["stations-hit", "stations-ld-hit"]) {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  }
  refreshTrack();
  for (const l of ["trains", "trains-ring"]) map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
  for (const l of ["trains", "trains-ring"]) map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
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
      // Back to a country whose map wasn't saved: its last area, if any.
      if (!lastView && savedArea && (ref?.region(savedArea) || placeByCode(savedArea))) goToNetwork(savedArea);
      // A region of areas.json (the UK's, Sweden's…): once that file is in.
      else if (!lastView && String(savedArea || "").startsWith("adm:")) placesReady.then(() => placeArea(savedArea) && goToNetwork(savedArea));
      // Phone (step 9 of docs/design/ui-redesign/PLAN.md): open on the map,
      // not on the last train's or station's sheet; a train being followed
      // gets a chip that brings it back. The side panel restores it.
      if (isPhone()) showFollowChip();
      else if (lastView?.detail && restoreDetail(lastView.detail)) return;
      const nothingOpen = !sheets.top();
      if (CONFIG.pro && activeCommute(commutes) && nothingOpen) {
        openSheet("commute");
        renderCommute();
      } else if (CONFIG.platform === "android" && nothingOpen && (favs.length || (CONFIG.pro && commutes.list.length))) {
        // Daily trips first: with favourites, the app opens on them (the map
        // is one tap away). The website keeps opening on the map.
        openSheet("favs");
        renderFavourites();
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
writeWidgetConfig();
prefs
  .get(FAV_KEY)
  .then((v) => {
    favs = parseFavourites(v);
    renderFavourites();
  })
  .catch(() => {});
prefs
  .get(COMMUTE_KEY)
  .then((v) => {
    commutes = parseCommutes(v);
    syncShortcuts();
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
// One banner at a time: a country's note first.
if (!setupCountryNote()) setupAppBanner();
/** The languages, each in its own name, the one in use marked. */
function renderLangs() {
  $("langs-list").replaceChildren(
    ...LANGS.map((code) =>
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", class: "menu-row", id: `lang-${code}`, lang: code, "aria-current": code === lang ? "true" : "false", onclick: () => setLang(code) },
          el("span", { class: "menu-label" }, t(code, "moreLanguageValue")),
          code === lang ? el("span", { class: "menu-value" }, "✓") : null,
        ),
      ),
    ),
  );
}
function openLangs() {
  renderLangs();
  openSheet("langs");
}
function setLang(code) {
  $("langs").hidden = true;
  if (code === lang) return;
  lang = code;
  store.set("lang", lang);
  applyLang();
  sheets.apply();
  if (alertsOn) writeAlertConfig();
  writeWidgetConfig();
}
$("lang").addEventListener("click", () => ($("langs").hidden ? openLangs() : ($("langs").hidden = true)));
$("langs-close").addEventListener("click", () => ($("langs").hidden = true));
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
// The delay key chip opens the full key (in Capas).
$("legend-chip").addEventListener("click", () => openLayers());
$("pro-chip").addEventListener("click", () => (openSheet("settings"), renderSettings()));
$("fab-layers").addEventListener("click", () => ($("layers-panel").hidden ? openLayers() : ($("layers-panel").hidden = true)));
$("networks-close").addEventListener("click", () => ($("networks").hidden = true));
$("route-close").addEventListener("click", () => ($("route").hidden = true));
for (const field of ["from", "to"]) {
  const input = $(`route-${field}`);
  input.addEventListener("input", () => routeSuggest(field));
  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("route-sugg").querySelector("button")?.click();
    if (e.key === "Escape") $("route-sugg").hidden = true;
  });
}
$("route-swap").addEventListener("click", () => {
  [route.from, route.to] = [route.to, route.from];
  [$("route-from").value, $("route-to").value] = [$("route-to").value, $("route-from").value];
  $("route-sugg").hidden = true;
  renderRoute();
});
$("layers-panel-close").addEventListener("click", () => ($("layers-panel").hidden = true));
$("fab-locate").addEventListener("click", () => {
  if (!locator?.active) return startLocation();
  if (userFix) flyToVisible(userFix.lon, userFix.lat, 13);
  else {
    openSheet("near");
    renderNear(true);
  }
});
matchMedia("(max-width: 899px)").addEventListener?.("change", () => applyLang());
$("jump").addEventListener("change", (e) => {
  const v = e.target.value;
  e.target.value = "";
  if (v.startsWith("country:")) return switchCountry(v.slice(8));
  if (v === "overview") return showOverview();
  if (v) goToNetwork(v);
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
  // Cab-ride layer on: the rest of the network faded behind it.
  for (const id of FADE_UNDER_CAB) {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-opacity", show.cab ? 0.3 : id.endsWith("casing") ? 0.9 : id === "lines" ? 0.95 : TRACK_OPACITY);
  }
  if (show.cab) refreshCab();
}
for (const key of Object.keys(KINDS)) {
  $(`f-k-${key}`).addEventListener("change", (e) => {
    showKind[key] = e.target.checked;
    renderIncidents();
  });
}
for (const key of ["commuter", "av", "ld", "md", "scheduled", "lines", "tav", "tld", "tmd", "stations", "stopped", "cab"]) {
  $(`f-${key}`).addEventListener("change", (e) => {
    show[key] = e.target.checked;
    if (key === "cab") {
      store.set("cab-layer", e.target.checked ? "1" : "0");
      if (!$("layers-panel").hidden) renderLayers(); // the key's row
      if ($("legend")) renderLegend();
    }
    applyLayerVisibility();
    render(true);
  });
}
$("f-cab").checked = show.cab;
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
