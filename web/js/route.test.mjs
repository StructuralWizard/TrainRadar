import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES } from "./places.js";
import { endStations, mergeRoutes } from "./route.js";

const ST = [
  { id: "18002", name: "Nuevos Ministerios", lat: 40.446, lon: -3.692, services: 2 },
  { id: "60000", name: "Madrid-Puerta de Atocha", lat: 40.4065, lon: -3.6895, services: 3 },
  { id: "17000", name: "Madrid-Chamartín", lat: 40.472, lon: -3.682, services: 3 },
  { id: "51003", name: "Sevilla-Santa Justa", lat: 37.3917, lon: -5.975, services: 1 },
];
const madrid = { kind: "city", item: CITIES.find((c) => c.code === "madrid") };

test("ends: a station, or a city's stations with long-distance first", () => {
  assert.deepEqual(endStations({ kind: "station", item: ST[3] }, ST).map((s) => s.id), ["51003"]);
  assert.deepEqual(endStations(madrid, ST).map((s) => s.id), ["60000", "17000", "18002"]);
  assert.equal(endStations(madrid, ST, 1).length, 1);
  assert.deepEqual(endStations(null, ST), []);
});

test("merge: one row per train, its shortest ride, by departure, gone ones dropped", () => {
  const row = (trip, dep, arr) => ({ trip_id: trip, number: trip, route: "AVE", expected_dep: dep, expected_arr: arr, dep, arr, delay: 0, canceled: false, live: true });
  const pairs = [
    { from: ST[2], to: ST[3], rows: [row("a", 1000, 9000), row("b", 3000, 11000)] },
    { from: ST[1], to: ST[3], rows: [row("a", 1600, 9000), row("c", 2000, 9500), row("old", 100, 5000)] },
  ];
  const out = mergeRoutes(pairs, 1000);
  assert.deepEqual(out.map((r) => r.trip_id), ["a", "c", "b"]);
  assert.equal(out[0].from.id, "60000", "boards at Atocha: the shorter ride");
  assert.equal(mergeRoutes(pairs, 1000, 2).length, 2);
});
