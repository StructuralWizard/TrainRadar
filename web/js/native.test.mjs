import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_LIMIT, isFavourite, parseFavourites, toggleFavourite } from "./favourites.js";
import { isNative, parseLink, prefs } from "./native.js";

test("app links and web links", () => {
  assert.deepEqual(parseLink("trainradar://train/03020"), { type: "train", number: "03020" });
  assert.deepEqual(parseLink("trainradar://station/18000"), { type: "station", id: "18000" });
  assert.deepEqual(parseLink("https://trainradar.pages.dev/?train=19"), { type: "train", number: "19" });
  assert.deepEqual(parseLink("https://trainradar.pages.dev/?station=60000"), { type: "station", id: "60000" });
  assert.deepEqual(parseLink("https://mytrainradar.com/?train=03020"), { type: "train", number: "03020" });
  assert.equal(parseLink("trainradar://train/<script>"), null);
  assert.equal(parseLink("trainradar://other/1"), null);
  assert.equal(parseLink("https://trainradar.pages.dev/"), null);
  assert.equal(parseLink("not a url"), null);
  // Home-screen shortcuts carry the country; Germany's station ids have colons.
  assert.deepEqual(parseLink("trainradar://station/de/de%3A11000%3A900003201"), { type: "station", id: "de:11000:900003201", country: "de" });
  assert.deepEqual(parseLink("trainradar://train/fr/6611"), { type: "train", number: "6611", country: "fr" });
  assert.deepEqual(parseLink("trainradar://commute/es/1"), { type: "commute", index: 1, country: "es" });
  assert.equal(parseLink("trainradar://station/DEU/1"), null);
  assert.equal(parseLink("trainradar://commute/es/x"), null);
  assert.deepEqual(parseLink("https://mytrainradar.com/?country=de&station=de:1:2"), { type: "station", id: "de:1:2", country: "de" });
  assert.deepEqual(parseLink("https://mytrainradar.com/?commute=0"), { type: "commute", index: 0 });
  assert.equal(parseLink("https://mytrainradar.com/?country=ie"), null);
});

test("favourites: free limit, toggle, no duplicates, bad data dropped", () => {
  const a = { type: "train", number: "03020", label: "AVE 03020" };
  const b = { type: "station", id: "18000", name: "Atocha", lon: -3.69, lat: 40.4 };
  const c = { type: "train", number: "19", label: "C5 19" };
  let r = toggleFavourite([], a);
  assert.ok(r.added);
  r = toggleFavourite(r.list, b);
  assert.equal(r.list.length, FREE_LIMIT);
  const full = toggleFavourite(r.list, c);
  assert.ok(full.full && !full.added);
  assert.equal(full.list.length, 2);
  assert.ok(isFavourite(r.list, { type: "train", number: "3020" }), "leading zeros ignored");
  r = toggleFavourite(r.list, a);
  assert.deepEqual(r.list, [b]);
  assert.ok(toggleFavourite(r.list, c, Infinity).added, "Pro: no limit");

  const parsed = parseFavourites(JSON.stringify([a, a, b, { type: "train", number: "x y" }, { type: "station", id: "1" }, null, 5]));
  assert.deepEqual(parsed, [a, b]);
  assert.deepEqual(parseFavourites("{oops"), []);
  assert.deepEqual(parseFavourites(null), []);
});

test("outside the app: no native bridge, prefs fall back safely", async () => {
  assert.equal(isNative(), false);
  assert.equal(await prefs.get("x"), null, "no localStorage in node: null, no throw");
  await prefs.set("x", "1");
});
