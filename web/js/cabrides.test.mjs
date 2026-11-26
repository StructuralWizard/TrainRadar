// Run with: node --test web/js/cabrides.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, indexRides, norm, stationKey, videoForTrain, videosAt, videoUrl } from "./cabrides.js";

// tools/cabrides/build.py's format: [id, title, channel, quality, view,
// [[station_key, name, t, real], ...]], best first.
const doc = {
  v: 1,
  alias: { "madrid chamartin clara campoamor": "madrid chamartin" },
  videos: [
    ["AAAAAAAAAAA", "Madrid – Zaragoza", "Cab Channel", "precise", "cab", [
      ["madrid puerta de atocha", "Madrid Puerta de Atocha", 30, 1],
      ["guadalajara yebes", "Guadalajara-Yebes", 1200, 1],
      ["zaragoza delicias", "Zaragoza Delicias", 4200, 1],
    ]],
    ["BBBBBBBBBBB", "Chamartín – Atocha", "Other", "estimated", "front", [
      ["madrid chamartin", "Madrid Chamartín", 10, 0],
      ["madrid puerta de atocha", "Madrid Puerta de Atocha", 600, 0],
    ]],
    ["CCCCCCCCCCC", "Solothurn – Biel", "Swiss", "precise", "cab", [
      ["solothurn soleure", "Solothurn / Soleure", 5, 1],
      ["renens", "Renens", 900, 1],
      ["jyvaskyla rautpohja", "Jyväskylä – Rautpohja", 1500, 1],
    ]],
  ],
};
const idx = indexRides(doc);

test("names normalised like the database's keys", () => {
  assert.equal(norm("Zürich HB"), "zurich hb");
  assert.equal(norm("Estación de Málaga-María Zambrano"), "malaga maria zambrano");
  assert.equal(norm("King's Cross & St Pancras"), "kings cross st pancras");
});

test("app station names find the videos' stations", () => {
  // A longer Renfe name, before its spaced dash.
  assert.equal(stationKey(idx, "Madrid-Puerta de Atocha - Almudena Grandes"), "madrid puerta de atocha");
  // Through the aliases.
  assert.equal(stationKey(idx, "Madrid-Chamartín-Clara Campoamor"), "madrid chamartin");
  // A Swiss canton after the name.
  assert.equal(stationKey(idx, "Renens VD"), "renens");
  // Each part of a bilingual name, or of a chapter naming a stretch.
  assert.equal(stationKey(idx, "Solothurn"), "solothurn");
  assert.equal(stationKey(idx, "Rautpohja"), "rautpohja");
  // A suburb is not its city.
  assert.equal(stationKey(idx, "Madrid-Recoletos"), null);
  assert.equal(stationKey(idx, "Nowhere"), null);
});

test("videos at a station, best first, opened at its moment", () => {
  const v = videosAt(idx, "Madrid-Puerta de Atocha - Almudena Grandes");
  assert.deepEqual(v.map((x) => [x.id, x.t, x.real]), [["AAAAAAAAAAA", 30, true], ["BBBBBBBBBBB", 600, false]]);
  assert.equal(v[0].url, "https://www.youtube.com/watch?v=AAAAAAAAAAA&t=30s");
  assert.deepEqual(videosAt(idx, "Nowhere"), []);
  assert.deepEqual(videosAt(null, "Madrid"), []);
});

test("a train between two stops: the video opened where it is", () => {
  const stops = [
    { name: "Madrid-Puerta de Atocha - Almudena Grandes", time: 1000 },
    { name: "Guadalajara-Yebes", time: 2000 },
    { name: "Zaragoza-Delicias", time: 4000 },
  ];
  // Halfway from Atocha to Guadalajara: halfway from 30 s to 1200 s.
  const v = videoForTrain(idx, stops, "Guadalajara-Yebes", 1500);
  assert.equal(v.id, "AAAAAAAAAAA");
  assert.equal(Math.round(v.t), 615);
  // The other direction has no video.
  assert.equal(videoForTrain(idx, [...stops].reverse(), "Madrid-Puerta de Atocha - Almudena Grandes", 3000), null);
  assert.equal(videoForTrain(idx, stops, "Nowhere", 1500), null);
});

test("times and links", () => {
  assert.equal(clock(2470), "41:10");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(videoUrl("a&b", 12.6), "https://www.youtube.com/watch?v=a%26b&t=13s");
});
