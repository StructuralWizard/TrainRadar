import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCountry, pickCountry } from "./country.js";

test("country: the address, then the saved choice, then the browser", () => {
  assert.equal(pickCountry({ search: "?country=uk", saved: "es" }), "uk");
  assert.equal(pickCountry({ search: "?country=fr", saved: "uk" }), "uk");
  assert.equal(pickCountry({ saved: null, languages: ["en-GB", "en"] }), "uk");
  assert.equal(pickCountry({ saved: null, languages: ["es-ES"] }), "es");
  assert.equal(pickCountry({}), "es");
});

test("country: the UK points CONFIG at data/uk/ and uk/rt/, London time, no history or replay", () => {
  const base = () => ({ dataBase: "data/", liveBase: "https://live.example/rt/", rtBase: "/rt/", apiBase: "/", center: [-3.7, 40.2], zoom: 5.2 });
  const es = applyCountry(base(), "es");
  assert.equal(es.dataBase, "data/");
  assert.equal(es.timeZone, "Europe/Madrid");
  const uk = applyCountry(base(), "uk");
  assert.equal(uk.country, "uk");
  assert.equal(uk.dataBase, "data/uk/");
  assert.equal(uk.liveBase, "https://live.example/uk/rt/");
  assert.equal(uk.rtBase, "https://live.example/uk/rt/");
  assert.equal(uk.apiBase, "");
  assert.equal(uk.replay, false);
  assert.equal(uk.timeZone, "Europe/London");
  // Without a live bucket (local dev): the pass-through path, under uk/.
  const dev = applyCountry({ ...base(), liveBase: "" }, "uk");
  assert.equal(dev.rtBase, "/uk/rt/");
});
