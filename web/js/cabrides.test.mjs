// Run with: node --test web/js/cabrides.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, indexRides, norm, ridesGeoJson, stationKey, videoForTrain, videosAt, videoUrl } from "./cabrides.js";

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

test("the map layer: lines between filmed stations the app has, and those stations", () => {
  // A → B → (C, not in the app) → D, and a second video B → A; far away, E.
  const idx = indexRides({
    v: 1,
    alias: {},
    videos: [
      ["v1", "A to D", "ch", "precise", "cab", [["a", "A", 0, 1], ["b", "B", 60, 1], ["c", "C", 120, 1], ["d", "D", 180, 1], ["e", "E", 900, 0]]],
      ["v2", "B to A", "ch", "precise", "cab", [["b", "B", 0, 1], ["a", "A", 60, 1]]],
    ],
  });
  const stations = [
    { name: "A", lon: 0, lat: 0 },
    { name: "B", lon: 0.1, lat: 0 },
    { name: "D", lon: 0.3, lat: 0 },
    { name: "E", lon: 5, lat: 0 }, // over 500 km on: no line to it
    { name: "Z", lon: 1, lat: 1 }, // no video
  ];
  const fc = ridesGeoJson(idx, stations);
  const lines = fc.features.filter((f) => f.geometry.type === "LineString");
  const points = fc.features.filter((f) => f.geometry.type === "Point");
  // A–B (both videos, once), B–D (across C, which the app lacks); not D–E.
  assert.deepEqual(lines.map((f) => [f.geometry.coordinates, f.properties.n]), [
    [[[0, 0], [0.1, 0]], 2],
    [[[0.1, 0], [0.3, 0]], 1],
  ]);
  assert.deepEqual(points.map((f) => [f.geometry.coordinates[0], f.properties.n]).sort(), [[0, 2], [0.1, 2], [0.3, 1], [5, 1]]);
  assert.deepEqual(ridesGeoJson(null, stations).features, []);
});
