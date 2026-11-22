// The country shown, one at a time (plan 3; docs/plan-europe.md A1): Spain
// (Renfe), the United Kingdom (Network Rail) or Ireland (Iarnród Éireann).
// Chosen on the network chip, remembered on the device; the page reloads
// with the other country's data, feeds and settings.

/** What the app needs to know about each country.
 * - `zone`: the time zone its times are shown in;
 * - `center`, `zoom`: the first view;
 * - `live`: its live feeds exist (else every train goes by timetable). */
export const COUNTRY_INFO = {
  es: { zone: "Europe/Madrid", center: [-3.7, 40.2], zoom: 5.2, live: true },
  uk: { zone: "Europe/London", center: [-2.6, 54.2], zoom: 5.0, live: true },
  ie: { zone: "Europe/Dublin", center: [-7.9, 53.4], zoom: 6.4, live: true },
};

export const COUNTRIES = Object.keys(COUNTRY_INFO);
export const COUNTRY_KEY = "country";

/** Which country to show: `?country=uk` in the address, else the one saved,
 * else the UK for a British English browser, else Spain. `allowed` are the
 * countries offered; `hidden` ones (still being built) open only from the
 * address, and are then remembered like any other. */
export function pickCountry({ search = "", saved = null, languages = [], allowed = COUNTRIES, hidden = [] } = {}) {
  const ok = (c) => COUNTRIES.includes(c) && (allowed.includes(c) || hidden.includes(c));
  const asked = new URLSearchParams(search).get("country");
  if (ok(asked)) return asked;
  if (ok(saved)) return saved;
  return languages[0] === "en-GB" && allowed.includes("uk") ? "uk" : "es";
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
