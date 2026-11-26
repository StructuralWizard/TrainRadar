import { test } from "node:test";
import assert from "node:assert/strict";
import { DETAIL_MAX_AGE_MS, decodeView, encodeView } from "./lastview.js";
import { favouritesInOrder, moveFavourite, neighbourFavourite } from "./favourites.js";

const NOW = Date.parse("2026-11-21T10:00:00Z");

test("last view: map always, the open train or station only when recent", () => {
  const json = encodeView({ country: "es", center: [-3.703791, 40.416775], zoom: 12.345, detail: { type: "train", number: "03112" } }, NOW);
  assert.deepEqual(decodeView(json, { country: "es", now: NOW + 60_000 }), { center: [-3.70379, 40.41678], zoom: 12.35, detail: { type: "train", number: "03112" } });
  assert.equal(decodeView(json, { country: "es", now: NOW + DETAIL_MAX_AGE_MS + 1 }).detail, null);
  assert.equal(decodeView(json, { country: "uk", now: NOW }), null, "the other country's view");
  const st = encodeView({ country: "es", center: [0, 40], zoom: 9, detail: { type: "station", id: "18000" } }, NOW);
  assert.deepEqual(decodeView(st, { country: "es", now: NOW }).detail, { type: "station", id: "18000" });
  // Junk is ignored.
  assert.equal(decodeView("{", { country: "es" }), null);
  assert.equal(decodeView(JSON.stringify({ country: "es", center: [500, 1], zoom: 5 }), { country: "es" }), null);
  const bad = JSON.parse(encodeView({ country: "es", center: [0, 40], zoom: 9 }, NOW));
  bad.detail = { type: "train", number: "<script>" };
  assert.equal(decodeView(JSON.stringify(bad), { country: "es", now: NOW }).detail, null);
});

test("favourites: stations then trains, each sorted on its own; neighbours", () => {
  const t = (n) => ({ type: "train", number: n, label: n });
  const s = (id) => ({ type: "station", id, name: id, lon: 0, lat: 40 });
  const list = [t("1"), s("A"), t("2"), s("B"), t("3")];
  assert.deepEqual(favouritesInOrder(list).map((f) => f.number || f.id), ["A", "B", "1", "2", "3"]);
  // Move train 3 to the top of the trains: stations untouched.
  assert.deepEqual(moveFavourite(list, t("3"), 0).map((f) => f.number || f.id), ["A", "B", "3", "1", "2"]);
  // Move station A down: trains untouched; past the end clamps.
  assert.deepEqual(moveFavourite(list, s("A"), 9).map((f) => f.number || f.id), ["B", "A", "1", "2", "3"]);
  assert.deepEqual(moveFavourite(list, t("9"), 0).map((f) => f.number || f.id), ["A", "B", "1", "2", "3"], "unknown: order only");
  // Swiping: next and previous in Favoritos' order, across the two groups.
  assert.equal(neighbourFavourite(list, s("B"), 1).number, "1");
  assert.equal(neighbourFavourite(list, t("1"), -1).id, "B");
  assert.equal(neighbourFavourite(list, s("A"), -1), null);
  assert.equal(neighbourFavourite(list, t("3"), 1), null);
});
