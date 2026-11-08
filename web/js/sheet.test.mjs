import { test } from "node:test";
import assert from "node:assert/strict";
import { PEEK_PX, settle, snapHeights } from "./sheet.js";

const hs = snapHeights(844, 84);

test("sheet: snap heights for a 844 px phone with an 84 px tab bar", () => {
  assert.equal(hs.peek, PEEK_PX);
  assert.equal(hs.half, Math.round(760 * 0.55));
  assert.equal(hs.full, Math.round(844 * 0.92 - 84));
  assert.ok(hs.peek < hs.half && hs.half < hs.full);
});

test("sheet: a slow release settles on the nearest snap", () => {
  const all = ["peek", "half", "full"];
  assert.equal(settle(170, 0, hs, all, true), "peek");
  assert.equal(settle(400, 0, hs, all, true), "half");
  assert.equal(settle(650, 0, hs, all, true), "full");
});

test("sheet: a flick moves one snap in its direction", () => {
  const all = ["peek", "half", "full"];
  assert.equal(settle(430, 1.2, hs, all, true), "full", "up from half");
  assert.equal(settle(410, -1.2, hs, all, true), "peek", "down from half");
});

test("sheet: pulled below the lowest snap closes, unless it can't", () => {
  const all = ["peek", "half", "full"];
  assert.equal(settle(60, 0, hs, all, true), "close");
  assert.equal(settle(150, -1, hs, all, true), "close", "a flick down from peek");
  assert.equal(settle(60, 0, hs, all, false), "peek", "the home sheet stays");
  assert.equal(settle(200, -1, hs, ["half", "full"], true), "close", "half is the lowest");
});
