import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_LIMIT, isFavourite, parseFavourites, toggleFavourite } from "./favourites.js";
import { enthusiast } from "./features.js";
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

test("free Android edition hides the enthusiast details; web shows them", () => {
  assert.equal(enthusiast({ platform: "web" }), true);
  assert.equal(enthusiast({ platform: "android" }), false);
  assert.equal(enthusiast({ platform: "android", pro: true }), true);
});

test("outside the app: no native bridge, prefs fall back safely", async () => {
  assert.equal(isNative(), false);
  assert.equal(await prefs.get("x"), null, "no localStorage in node: null, no throw");
  await prefs.set("x", "1");
});
