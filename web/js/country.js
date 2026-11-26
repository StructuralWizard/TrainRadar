// The country shown, one at a time (plan 3; docs/plan-europe.md A1): Spain
// (Renfe), the United Kingdom (Network Rail), Ireland (Iarnród Éireann),
// France (SNCF), Luxembourg (CFL), Finland (VR), Norway (Entur) or the
// Netherlands (NS and the others), Slovakia (ZSSK), Estonia (Elron),
// Switzerland (SBB and the others), Sweden, Poland (PKP PLK), Austria, Czechia, Italy (Trenitalia, Trenord), Denmark, Hungary (MÁV, GYSEV), Germany (DELFI, DB), Belgium (SNCB), Australia (New South Wales, Victoria) New Zealand (Wellington, Auckland), Singapore (estimated), Portugal (Lisbon) or Japan (Tokyo, Kōchi).
// Chosen on the network chip, remembered on the device; the page reloads
// with the other country's data, feeds and settings.

import { VIEW_KEY } from "./lastview.js";

/** What the app needs to know about each country.
 * - `zone`: the time zone its times are shown in;
 * - `center`, `zoom`: the first view;
 * - `live`: its live feeds exist (else every train goes by timetable). */
export const COUNTRY_INFO = {
  es: { zone: "Europe/Madrid", center: [-3.7, 40.2], zoom: 5.2, live: true },
  uk: { zone: "Europe/London", center: [-2.6, 54.2], zoom: 5.0, live: true },
  ie: { zone: "Europe/Dublin", center: [-7.9, 53.4], zoom: 6.4, live: true },
  fr: { zone: "Europe/Paris", center: [2.4, 46.6], zoom: 5.3, live: true },
  lu: { zone: "Europe/Luxembourg", center: [6.13, 49.75], zoom: 8.6, live: false },
  fi: { zone: "Europe/Helsinki", center: [25.5, 62.8], zoom: 4.9, live: true },
  no: { zone: "Europe/Oslo", center: [10.4, 62.5], zoom: 4.6, live: true },
  nl: { zone: "Europe/Amsterdam", center: [5.3, 52.2], zoom: 6.9, live: true },
  sk: { zone: "Europe/Bratislava", center: [19.5, 48.7], zoom: 6.4, live: false },
  ee: { zone: "Europe/Tallinn", center: [25.5, 58.7], zoom: 6.3, live: false },
  ch: { zone: "Europe/Zurich", center: [8.2, 46.8], zoom: 6.9, live: true },
  se: { zone: "Europe/Stockholm", center: [15.5, 61.0], zoom: 4.5, live: true },
  pl: { zone: "Europe/Warsaw", center: [19.4, 52.0], zoom: 5.6, live: true },
  at: { zone: "Europe/Vienna", center: [13.3, 47.6], zoom: 6.3, live: false },
  cz: { zone: "Europe/Prague", center: [15.4, 49.8], zoom: 6.4, live: true },
  it: { zone: "Europe/Rome", center: [12.5, 42.3], zoom: 5.2, live: false },
  dk: { zone: "Europe/Copenhagen", center: [10.6, 56.0], zoom: 6.3, live: true },
  hu: { zone: "Europe/Budapest", center: [19.4, 47.2], zoom: 6.4, live: false },
  de: { zone: "Europe/Berlin", center: [10.4, 51.2], zoom: 5.4, live: true },
  be: { zone: "Europe/Brussels", center: [4.6, 50.6], zoom: 7.2, live: true },
  // New South Wales (GPS, delays, alerts) and Victoria; both on the same
  // clock rules (Sydney's and Melbourne's).
  au: { zone: "Australia/Sydney", center: [147.5, -35.6], zoom: 5.6, live: true },
  // Wellington (Metlink) and Auckland (Auckland Transport): GPS, delays
  // and alerts.
  nz: { zone: "Pacific/Auckland", center: [175.2, -39.0], zoom: 5.9, live: true },
  // Singapore: estimated trains (LTA publishes no timetable or positions);
  // live is LTA's disruption alerts only.
  sg: { zone: "Asia/Singapore", center: [103.82, 1.35], zoom: 10.4, live: true },
  // Lisbon (Fertagus, Lisbon Metro) by timetable: Portugal publishes no live
  // data; CP's national timetable once CP allows its reuse.
  pt: { zone: "Europe/Lisbon", center: [-9.1, 38.7], zoom: 9.6, live: false },
  // Tokyo (Toei: GPS, delays, alerts) and Kōchi (Tosaden, by timetable).
  jp: { zone: "Asia/Tokyo", center: [139.75, 35.69], zoom: 10.6, live: true },
};

export const COUNTRIES = Object.keys(COUNTRY_INFO);
export const COUNTRY_KEY = "country";

/** Other time zones in a country (Victoria's, Belfast's) → the country. */
const ZONE_ALIASES = {
  "Australia/Melbourne": "au",
  "Australia/Canberra": "au",
  "Europe/Belfast": "uk",
  "Europe/Busingen": "de",
  "Europe/Vaduz": "ch",
  "Arctic/Longyearbyen": "no",
  "Europe/Monaco": "fr",
  "Pacific/Chatham": "nz",
  "Atlantic/Madeira": "pt",
  "Atlantic/Azores": "pt",
};
/** A language's region (en-GB, de-AT) → our country code. */
const REGION_ALIASES = { gb: "uk" };

/** The country of a time zone (the device's, Intl), or null. */
export function countryOfZone(zone) {
  if (!zone) return null;
  if (ZONE_ALIASES[zone]) return ZONE_ALIASES[zone];
  return COUNTRIES.find((c) => COUNTRY_INFO[c].zone === zone) || null;
}

/** Which country to show: `?country=uk` in the address, else the one saved
 * (the last one opened), else the device's: its time zone, then its
 * language's region (en-GB, de-AT); else Spain. Nothing leaves the device.
 * `allowed` are the countries offered; `hidden` ones (still being built)
 * open only from the address, and are then remembered like any other. */
export function pickCountry({ search = "", saved = null, device = "", languages = [], zone = null, allowed = COUNTRIES, hidden = [] } = {}) {
  const ok = (c) => COUNTRIES.includes(c) && (allowed.includes(c) || hidden.includes(c));
  const asked = new URLSearchParams(search).get("country");
  if (ok(asked)) return asked;
  if (ok(saved)) return saved;
  // The Android app's first start: the phone's own country (its SIM, else
  // its network, else its language's region; TrainRadarPlugin.deviceCountry).
  const own = REGION_ALIASES[String(device).toLowerCase()] || String(device).toLowerCase();
  if (own && allowed.includes(own)) return own;
  const byZone = countryOfZone(zone);
  if (byZone && allowed.includes(byZone)) return byZone;
  for (const l of languages) {
    const region = String(l).split("-")[1]?.toLowerCase();
    const c = REGION_ALIASES[region] || region;
    if (c && allowed.includes(c)) return c;
  }
  return "es";
}

/** Where each country's map was left (lastview.js), one per country so
 * coming back to one opens where it was. Spain's keeps the old key. */
export const viewKey = (code) => (code === "es" ? VIEW_KEY : `${VIEW_KEY}-${code}`);
/** The area last chosen in each country (a Cercanías núcleo, a French
 * region, a German state…; areasOf). */
export const areaKey = (code) => `area-${code}`;

/** Regions of a country's manifest that aren't areas: the national
 * timetable (and, for Spain, OUIGO), and the ones covering the whole country
 * (regional trains, commuter trains, cross-border trains). */
const NOT_AREAS = new Set(["ld", "ouigo", "fi-l", "de-x"]);

/**
 * A country's areas, to choose from (the second drop-down): the manifest's
 * regions that are a part of the country, A–Z, each `{ code, name, bbox }`
 * (bbox [s, w, n, e]). Spain: its Cercanías núcleos; France: its TER
 * regions; Germany: its states; Australia: New South Wales and Victoria;
 * New Zealand: Wellington and Auckland; Italy: Lombardy. Others: none.
 */
export function areasOf(manifest, code, lang = "en") {
  const regions = manifest?.regions || [];
  const national = code === "es" ? "ld" : code;
  return regions
    .filter((r) => r.bbox && r.code !== national && !NOT_AREAS.has(r.code) && !r.code.endsWith("-r") && (code !== "es" || r.live !== false))
    .map((r) => ({ code: r.code, name: areaName(r.name || r.code), bbox: r.bbox }))
    .filter((a) => a.name)
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}

/** "Germany (Berlin, Brandenburg)" → "Berlin, Brandenburg"; "TER Bretagne"
 * → "Bretagne"; "Italy (Lombardy, Trenord)" → "Lombardy". */
export function areaName(name) {
  const n = String(name).trim().replace(/^TER /, "");
  const m = /^[A-Z][a-z]+ \((.+)\)$/.exec(n);
  return (m ? m[1] : n).replace(/, Trenord$/, "");
}

/** Point CONFIG at a country's data and feeds (mutates and returns it). */
export function applyCountry(config, code) {
  const info = COUNTRY_INFO[code] || COUNTRY_INFO.es;
  config.country = code;
  config.timeZone = info.zone;
  if (code === "es") return config;
  // data/<code>/ next to Spain's data/; the feeds under <code>/rt/ next to rt/.
  config.dataBase = `${config.dataBase.replace(/\/?$/, "/")}${code}/`;
  if (config.remoteDataBase) config.remoteDataBase = `${config.remoteDataBase.replace(/\/?$/, "/")}${code}/`;
  if (info.live) {
    const sub = (base) => (base ? base.replace(/rt\/?$/, `${code}/rt/`) : base);
    config.liveBase = sub(config.liveBase);
    config.rtBase = config.liveBase || sub(config.rtBase);
  } else {
    // No live feeds yet: nothing to poll, trains go by timetable.
    config.liveBase = "";
    config.rtBase = "";
  }
  // Spain's only (for now): delay history, the replay, Renfe's links.
  config.apiBase = "";
  config.replay = false;
  config.center = info.center;
  config.zoom = info.zoom;
  return config;
}
