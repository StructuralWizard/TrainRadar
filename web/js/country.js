// The country shown (plan 3: one at a time): España (Renfe) or Reino Unido
// (Network Rail). Chosen on the network chip, remembered on the device; the
// page reloads with the other country's data, feeds and settings.

export const COUNTRIES = ["es", "uk"];
export const COUNTRY_KEY = "country";

/** Which country to show: `?country=uk` in the address, else the one saved,
 * else the UK for a British English browser, else Spain. */
export function pickCountry({ search = "", saved = null, languages = [], allowed = COUNTRIES } = {}) {
  const ok = (c) => COUNTRIES.includes(c) && allowed.includes(c);
  const asked = new URLSearchParams(search).get("country");
  if (ok(asked)) return asked;
  if (ok(saved)) return saved;
  return languages[0] === "en-GB" && ok("uk") ? "uk" : "es";
}

/** Point CONFIG at a country's data and feeds (mutates and returns it). */
export function applyCountry(config, code) {
  config.country = code;
  if (code !== "uk") {
    config.timeZone = "Europe/Madrid";
    return config;
  }
  // data/uk/ next to Spain's data/; the feeds under uk/rt/ next to rt/.
  config.dataBase = `${config.dataBase.replace(/\/?$/, "/")}uk/`;
  if (config.remoteDataBase) config.remoteDataBase = `${config.remoteDataBase.replace(/\/?$/, "/")}uk/`;
  const uk = (base) => (base ? base.replace(/rt\/?$/, "uk/rt/") : base);
  config.liveBase = uk(config.liveBase);
  config.rtBase = config.liveBase || uk(config.rtBase);
  // Not (yet) in the UK: delay history, the replay, Renfe's links.
  config.apiBase = "";
  config.replay = false;
  config.center = [-2.6, 54.2];
  config.zoom = 5.0;
  config.timeZone = "Europe/London";
  return config;
}
