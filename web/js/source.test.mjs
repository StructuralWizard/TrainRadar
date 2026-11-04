// Run with: node --test web/js/source.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAILS_TO_FALLBACK, FALLBACK_MS, SourceSwitch, changedFeeds, feedUrl } from "./source.js";
import { BANNER_FROM_VISIT, countVisit, dismissAppBanner, showAppBanner } from "./visits.js";

test("falls back to the pass-through after 3 failures, back to live after 10 min", () => {
  const s = new SourceSwitch({ live: "https://live/rt/", fallback: "https://proxy/" });
  assert.equal(s.usingLive(0), true);
  assert.equal(s.liveFailed(1000), false);
  s.liveOk(); // a success resets the count
  assert.equal(s.liveFailed(2000), false);
  assert.equal(s.liveFailed(3000), false);
  assert.equal(s.liveFailed(4000), true, `switches on failure ${FAILS_TO_FALLBACK}`);
  assert.equal(s.usingLive(4000 + FALLBACK_MS - 1), false);
  assert.equal(s.usingLive(4000 + FALLBACK_MS), true, "tries live again");
});

test("no live bucket: pass-through only; no fallback: live only", () => {
  assert.equal(new SourceSwitch({ live: "", fallback: "https://proxy/" }).usingLive(0), false);
  const only = new SourceSwitch({ live: "https://live/rt/", fallback: "" });
  for (let i = 0; i < 5; i++) only.liveFailed(i);
  assert.equal(only.usingLive(10), true);
});

test("downloads only the feeds Renfe changed", () => {
  const status = {
    feeds: {
      "vehicle_positions.pb": { renfeLastModified: "Wed, 04 Nov 2026 07:00:20 GMT" },
      "alerts.pb": { renfeLastModified: "Wed, 07 Oct 2026 10:00:00 GMT" },
      "trip_updates.pb": { renfeLastModified: null },
    },
  };
  const seen = { "alerts.pb": "Wed, 07 Oct 2026 10:00:00 GMT", "vehicle_positions.pb": "Wed, 04 Nov 2026 07:00:00 GMT" };
  assert.deepEqual(changedFeeds(status, seen), [{ path: "vehicle_positions.pb", lastModified: "Wed, 04 Nov 2026 07:00:20 GMT" }]);
  assert.deepEqual(changedFeeds(null, {}), []);
  assert.equal(feedUrl("https://live/rt/", "alerts.pb", "Wed, 07 Oct 2026 10:00:00 GMT"), "https://live/rt/alerts.pb?v=Wed%2C%2007%20Oct%202026%2010%3A00%3A00%20GMT");
});

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test("app banner: from the 3rd visit, only with a Play listing, on the web, until dismissed", () => {
  const st = memory();
  const cfg = { playUrl: "https://play.google.com/store/apps/details?id=x", platform: "web" };
  const seen = [1, 2, 3, 4].map(() => showAppBanner(st, countVisit(st), cfg));
  assert.deepEqual(seen, [false, false, true, true]);
  assert.equal(BANNER_FROM_VISIT, 3);
  dismissAppBanner(st);
  assert.equal(showAppBanner(st, countVisit(st), cfg), false, "dismissed for good");
  assert.equal(showAppBanner(memory(), 5, { ...cfg, playUrl: "" }), false, "no listing yet");
  assert.equal(showAppBanner(memory(), 5, { ...cfg, platform: "android" }), false, "not inside the app");
});

test("visit counter survives broken storage", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(countVisit(broken), 1);
  assert.equal(showAppBanner(broken, 3, { playUrl: "x", platform: "web" }), true);
  dismissAppBanner(broken); // no throw
  assert.equal(countVisit(undefined), 1);
});
