// Run with: node --test web/js/format.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  delayClass,
  formatAgo,
  formatClock,
  formatDelay,
  formatDistance,
  formatDuration,
} from "./format.js";

test("delays", () => {
  assert.equal(formatDelay("es", 420), "+7 min");
  assert.equal(formatDelay("en", 20), "On time");
  assert.equal(formatDelay("es", -125), "2 min antes");
  assert.equal(formatDelay("en", null), "—");
});

test("delay classes match the map bands", () => {
  assert.deepEqual([0, 299, 300, 899, 900, null].map(delayClass), [0, 0, 1, 1, 2, 3]);
});

test("durations and ages", () => {
  assert.equal(formatDuration("es", 42), "42 s");
  assert.equal(formatDuration("es", 185), "3 min");
  assert.equal(formatDuration("es", 3900), "1 h 5 min");
  assert.equal(formatDuration("es", 7200), "2 h");
  assert.equal(formatAgo("es", 40), "hace 40 s");
  assert.equal(formatAgo("en", 600), "10 min ago");
});

test("distances", () => {
  assert.equal(formatDistance("es", 846), "850 m");
  assert.equal(formatDistance("es", 4210), "4,2 km");
  assert.equal(formatDistance("en", 4210), "4.2 km");
  assert.equal(formatDistance("es", 123456), "123 km");
});

test("clock is Madrid time", () => {
  // 2026-11-01 17:42 UTC = 18:42 CET.
  assert.equal(formatClock(Date.UTC(2026, 10, 1, 17, 42) / 1000), "18:42");
  // 2026-07-01 17:42 UTC = 19:42 CEST.
  assert.equal(formatClock(Date.UTC(2026, 6, 1, 17, 42) / 1000), "19:42");
});
