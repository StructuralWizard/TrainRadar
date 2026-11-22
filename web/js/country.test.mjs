import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCountry, pickCountry } from "./country.js";

test("country: the address, then the saved choice, then the browser", () => {
  assert.equal(pickCountry({ search: "?country=uk", saved: "es" }), "uk");
  assert.equal(pickCountry({ search: "?country=xx", saved: "uk" }), "uk");
  assert.equal(pickCountry({ saved: null, languages: ["en-GB", "en"] }), "uk");
  assert.equal(pickCountry({ saved: null, languages: ["es-ES"] }), "es");
  // A build without the UK (the Android app until 3.0): always Spain.
  const es = ["es"];
  assert.equal(pickCountry({ search: "?country=uk", allowed: es }), "es");
  assert.equal(pickCountry({ saved: "uk", allowed: es }), "es");
  assert.equal(pickCountry({ languages: ["en-GB"], allowed: es }), "es");
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
  // The Android app's copy of the site's data: the UK's too.
  assert.equal(applyCountry({ ...base(), remoteDataBase: "https://site.example/data/" }, "uk").remoteDataBase, "https://site.example/data/uk/");
  assert.equal(applyCountry({ ...base(), remoteDataBase: "https://site.example/data/" }, "es").remoteDataBase, "https://site.example/data/");
});

test("country: Ireland opens only from the address while it's hidden, then stays", () => {
  const allowed = ["es", "uk"];
  assert.equal(pickCountry({ search: "?country=ie", allowed }), "es");
  assert.equal(pickCountry({ search: "?country=ie", allowed, hidden: ["ie"] }), "ie");
  assert.equal(pickCountry({ saved: "ie", allowed, hidden: ["ie"] }), "ie");
  assert.equal(pickCountry({ saved: "ie", allowed }), "es");
  // A hidden country is never picked from the browser's language.
  assert.equal(pickCountry({ languages: ["en-IE"], allowed, hidden: ["ie"] }), "es");
});

test("country: Ireland points CONFIG at data/ie/ and ie/rt/, Dublin time", () => {
  const base = () => ({ dataBase: "data/", liveBase: "https://live.example/rt/", rtBase: "/rt/", apiBase: "/", center: [-3.7, 40.2], zoom: 5.2 });
  const ie = applyCountry(base(), "ie");
  assert.equal(ie.country, "ie");
  assert.equal(ie.dataBase, "data/ie/");
  assert.equal(ie.liveBase, "https://live.example/ie/rt/");
  assert.equal(ie.rtBase, "https://live.example/ie/rt/");
  assert.equal(ie.apiBase, "");
  assert.equal(ie.replay, false);
  assert.equal(ie.timeZone, "Europe/Dublin");
  assert.deepEqual(ie.center, [-7.9, 53.4]);
  assert.equal(applyCountry({ ...base(), remoteDataBase: "https://site.example/data/" }, "ie").remoteDataBase, "https://site.example/data/ie/");
});

test("country: France points CONFIG at data/fr/ and fr/rt/; Luxembourg has no feeds yet", () => {
  const base = () => ({ dataBase: "data/", liveBase: "https://live.example/rt/", rtBase: "/rt/", apiBase: "/", center: [-3.7, 40.2], zoom: 5.2 });
  const fr = applyCountry(base(), "fr");
  assert.equal(fr.dataBase, "data/fr/");
  assert.equal(fr.liveBase, "https://live.example/fr/rt/");
  assert.equal(fr.timeZone, "Europe/Paris");
  const lu = applyCountry(base(), "lu");
  assert.equal(lu.dataBase, "data/lu/");
  assert.equal(lu.liveBase, "");
  assert.equal(lu.rtBase, "");
  assert.equal(lu.timeZone, "Europe/Luxembourg");
  // Hidden while they're built: only from the address.
  const allowed = ["es", "uk"];
  const hidden = ["ie", "fr", "lu"];
  assert.equal(pickCountry({ search: "?country=fr", allowed }), "es");
  assert.equal(pickCountry({ search: "?country=fr", allowed, hidden }), "fr");
  assert.equal(pickCountry({ search: "?country=lu", allowed, hidden }), "lu");
  assert.equal(pickCountry({ languages: ["fr-FR"], allowed, hidden }), "es");
});

test("country: Finland, Norway and the Netherlands (M2): their data, feeds and time zones", () => {
  const base = () => ({ dataBase: "data/", liveBase: "https://live.example/rt/", rtBase: "/rt/", apiBase: "/", center: [-3.7, 40.2], zoom: 5.2 });
  for (const [cc, zone] of [["fi", "Europe/Helsinki"], ["no", "Europe/Oslo"], ["nl", "Europe/Amsterdam"], ["ch", "Europe/Zurich"], ["pl", "Europe/Warsaw"], ["se", "Europe/Stockholm"]]) {
    const c = applyCountry(base(), cc);
    assert.equal(c.dataBase, `data/${cc}/`);
    assert.equal(c.liveBase, `https://live.example/${cc}/rt/`);
    assert.equal(c.timeZone, zone);
  }
});

test("country: Slovakia and Estonia (M4) go by timetable: no feeds", () => {
  const base = () => ({ dataBase: "data/", liveBase: "https://live.example/rt/", rtBase: "/rt/", apiBase: "/", center: [-3.7, 40.2], zoom: 5.2 });
  for (const [cc, zone] of [["sk", "Europe/Bratislava"], ["ee", "Europe/Tallinn"]]) {
    const c = applyCountry(base(), cc);
    assert.equal(c.dataBase, `data/${cc}/`);
    assert.equal(c.liveBase, "");
    assert.equal(c.rtBase, "");
    assert.equal(c.timeZone, zone);
  }
});
