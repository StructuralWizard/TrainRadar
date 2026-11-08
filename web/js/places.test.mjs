import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, COMMUNITIES, PROVINCES, cityStations, editDistance, fold, matchScore, parseRoute, placeByCode, searchPlaces } from "./places.js";

const ST = [
  { id: "60000", name: "Madrid-Puerta de Atocha", lat: 40.4065, lon: -3.6895 },
  { id: "17000", name: "Madrid-Chamartín-Clara Campoamor", lat: 40.472, lon: -3.682 },
  { id: "18002", name: "Nuevos Ministerios", lat: 40.446, lon: -3.692 },
  { id: "10000", name: "Getafe Centro", lat: 40.309, lon: -3.73 },
  { id: "51003", name: "Sevilla-Santa Justa", lat: 37.3917, lon: -5.975 },
  { id: "65000", name: "València Estació del Nord", lat: 39.466, lon: -0.377 },
  { id: "60911", name: "Alacant Terminal", lat: 38.344, lon: -0.495 },
  { id: "71801", name: "Barcelona-Sants", lat: 41.3793, lon: 2.1404 },
];

test("fold ignores accents, case and punctuation", () => {
  assert.equal(fold("València-Nord"), "valencia nord");
  assert.equal(fold("  L'Hospitalet "), "l hospitalet");
});

test("edit distance counts swaps as one", () => {
  assert.equal(editDistance("sevilla", "sevila"), 1);
  assert.equal(editDistance("atocha", "aotcha"), 1);
  assert.equal(editDistance("abc", "xyz", 1), 2, "stops past the limit");
});

test("match score: exact, prefix, any word order, inside, typos", () => {
  assert.equal(matchScore("Sevilla", "Sevilla"), 100);
  assert.equal(matchScore("madrid", "Madrid-Puerta de Atocha"), 90);
  assert.equal(matchScore("atocha madrid", "Madrid-Puerta de Atocha"), 80);
  assert.equal(matchScore("chamar", "Madrid-Chamartín-Clara Campoamor"), 80);
  assert.equal(matchScore("ministerio", "Nuevos Ministerios"), 80);
  assert.equal(matchScore("ntos", "Getafe Centro"), -1);
  assert.equal(matchScore("sevila", "Sevilla-Santa Justa"), 50, "one typo");
  assert.equal(matchScore("chamartn", "Madrid-Chamartín"), 50);
  assert.equal(matchScore("barclona sans", "Barcelona-Sants"), 40);
  assert.equal(matchScore("bilbao", "Sevilla-Santa Justa"), -1);
  assert.equal(matchScore("de", "Madrid-Puerta de Atocha"), 70, "only short words: substring");
});

test("search: cities first, then their stations; co-official names", () => {
  const r = searchPlaces("madrid", ST);
  assert.equal(r[0].kind, "city");
  assert.equal(r[0].item.name, "Madrid");
  assert.ok(r.some((x) => x.kind === "station" && x.item.id === "60000"));
  assert.ok(r.some((x) => x.kind === "province" && x.item.name === "Madrid"));
  assert.ok(r.some((x) => x.kind === "community" && x.item.name === "Comunidad de Madrid"));
  assert.equal(searchPlaces("alacant", ST)[0].item.name, "Alicante");
  assert.equal(searchPlaces("donostia", ST)[0].item.name, "San Sebastián");
  assert.equal(searchPlaces("sevlla", ST)[0].item.name, "Sevilla", "typo");
  assert.deepEqual(searchPlaces("m", ST), [], "too short");
  assert.ok(searchPlaces("madrid", ST, 8, ["station"]).every((x) => x.kind === "station"));
});

test("a city's stations: by distance and by name", () => {
  const madrid = CITIES.find((c) => c.code === "madrid");
  const ids = cityStations(madrid, ST).map((s) => s.id);
  assert.deepEqual(ids.slice(0, 3).sort(), ["17000", "18002", "60000"]);
  assert.ok(!ids.includes("51003"));
  const getafe = CITIES.find((c) => c.code === "getafe");
  assert.deepEqual(cityStations(getafe, ST).map((s) => s.id), ["10000"]);
  const valencia = CITIES.find((c) => c.code === "valencia");
  assert.deepEqual(cityStations(valencia, ST).map((s) => s.id), ["65000"]);
});

test("route queries", () => {
  assert.deepEqual(parseRoute("Madrid a Sevilla"), { from: "Madrid", to: "Sevilla" });
  assert.deepEqual(parseRoute("de Bilbao a León"), { from: "Bilbao", to: "León" });
  assert.deepEqual(parseRoute("desde Sants hasta Girona"), { from: "Sants", to: "Girona" });
  assert.deepEqual(parseRoute("Madrid - Sevilla"), { from: "Madrid", to: "Sevilla" });
  assert.deepEqual(parseRoute("Sants → Girona"), { from: "Sants", to: "Girona" });
  assert.deepEqual(parseRoute("from Madrid to Seville"), { from: "Madrid", to: "Seville" });
  assert.equal(parseRoute("Madrid-Chamartín"), null, "a hyphen inside a name");
  assert.equal(parseRoute("Sevilla"), null);
  assert.equal(parseRoute("03020"), null);
});

test("places data: codes, boxes, communities", () => {
  assert.equal(PROVINCES.length, 52);
  assert.equal(COMMUNITIES.length, 19);
  const cc = new Set(COMMUNITIES.map((c) => c.code));
  for (const p of PROVINCES) {
    assert.ok(cc.has(p.community), p.name);
    const [s, w, n, e] = p.bbox;
    assert.ok(s < n && w < e && s > 27 && n < 44 && w > -19 && e < 5, p.name);
  }
  assert.equal(new Set(CITIES.map((c) => c.code)).size, CITIES.length);
  assert.equal(placeByCode("prov:28").name, "Madrid");
  assert.equal(placeByCode("ccaa:ct").name, "Cataluña");
  assert.equal(placeByCode("city:vigo").name, "Vigo");
  assert.equal(placeByCode("x:1"), null);
});
