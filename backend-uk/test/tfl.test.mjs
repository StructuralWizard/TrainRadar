import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLookup, londonClock, matchPredictions, refreshTfl, resetIndex } from "../src/tfl.js";
import { decode, encodeTripUpdates } from "../src/gtfsrt.js";

// A Victoria line group: Brixton → Walthamstow Central, Monday to Thursday,
// three departures; Stockwell 2 minutes in, Oxford Circus 15.
const INDEX = {
  v: 1,
  generated: "2026-11-30",
  groups: [
    {
      p: "tfl:victoria:940GZZLUBXN:0:1",
      l: "victoria",
      d: [0, 1, 2, 3],
      iv: { 0: [["940GZZLUBXN", 0], ["940GZZLUSKW", 120], ["940GZZLUOXC", 900], ["940GZZLUWWL", 1920]] },
      j: [[8 * 3600, 0], null, [8 * 3600 + 300, 0], [8 * 3600 + 600, 0]],
    },
  ],
};
// Monday 30 November 2026, 08:14:00 in London (GMT in winter).
const NOW = Date.UTC(2026, 10, 30, 8, 14, 0);
const pred = (stop, inSecs, dest = "940GZZLUWWL") => ({
  lineId: "victoria",
  naptanId: stop,
  destinationNaptanId: dest,
  expectedArrival: new Date(NOW + inSecs * 1000).toISOString(),
});

test("London's clock: date, weekday and seconds, summer time too", () => {
  assert.deepEqual(londonClock(NOW), { date: "20261130", weekday: 0, secs: 8 * 3600 + 14 * 60 });
  // 1 July: BST, an hour ahead of UTC.
  assert.equal(londonClock(Date.UTC(2026, 6, 1, 7, 0, 0)).secs, 8 * 3600);
});

test("a prediction matches the nearest timetabled call; the trip gets the median delay", () => {
  const lookup = buildLookup(INDEX);
  // The 08:05 from Brixton is due at Oxford Circus at 08:20; predicted at
  // 08:22 (+120 s). Its Stockwell call is long past: only Oxford Circus.
  const r = matchPredictions(lookup, [pred("940GZZLUOXC", 8 * 60)], NOW);
  assert.equal(r.matched, 1);
  assert.deepEqual(
    r.updates.map((u) => [u.tripId, u.delay, u.startDate]),
    [["tfl:victoria:940GZZLUBXN:0:1:2", 120, "20261130"]],
  );
  // Two predictions for the 08:10 (due Stockwell 08:12, Oxford Circus 08:25):
  // 60 and 180 s late → its median.
  const two = matchPredictions(lookup, [pred("940GZZLUSKW", 0 - 60), pred("940GZZLUOXC", 11 * 60 + 60), pred("940GZZLUOXC", 11 * 60 + 180)], NOW);
  const t3 = two.updates.find((u) => u.tripId.endsWith(":3"));
  assert.ok(t3, JSON.stringify(two.updates));
});

test("no match: another destination, another line, a weekend, or too far off", () => {
  const lookup = buildLookup(INDEX);
  assert.equal(matchPredictions(lookup, [pred("940GZZLUOXC", 8 * 60, "940GZZLUBXN")], NOW).matched, 0);
  assert.equal(matchPredictions(lookup, [{ ...pred("940GZZLUOXC", 8 * 60), lineId: "central" }], NOW).matched, 0);
  const saturday = Date.UTC(2026, 10, 28, 8, 14, 0);
  assert.equal(matchPredictions(lookup, [{ ...pred("940GZZLUOXC", 0), expectedArrival: new Date(saturday + 8 * 60_000).toISOString() }], saturday).matched, 0);
  assert.equal(matchPredictions(lookup, [pred("940GZZLUOXC", 3 * 3600)], NOW).matched, 0);
  assert.equal(matchPredictions(lookup, [{ ...pred("940GZZLUOXC", 60), destinationNaptanId: "" }], NOW).matched, 0);
});

test("the minute's work: the key only in a header, the feed written, status counts", async () => {
  resetIndex();
  const asked = [];
  const put = {};
  const env = {
    UK_TFL_APP_KEY: "k3y",
    SITE_URL: "https://example.test/",
    LIVE: { put: async (k, v) => (put[k] = v) },
  };
  const fetchFn = async (url, opts) => {
    asked.push([url, opts?.headers?.app_key || null]);
    if (url.endsWith("data/uk/tfl-index.json")) return new Response(JSON.stringify(INDEX));
    const mode = url.match(/Mode\/(\w+)\//)[1];
    return new Response(JSON.stringify(mode === "tube" ? [pred("940GZZLUOXC", 8 * 60)] : []));
  };
  const s = await refreshTfl({ env, fetchFn, now: NOW, encode: encodeTripUpdates });
  assert.equal(s.ok, true, s.error);
  assert.deepEqual([s.predictions, s.matched, s.trips], [1, 1, 1]);
  assert.ok(asked.every(([u]) => !u.includes("k3y")), "the key never in a URL");
  assert.deepEqual(asked.filter(([u]) => u.includes("api.tfl.gov.uk")).map(([, k]) => k), ["k3y", "k3y", "k3y"]);
  const feed = decode(put["uk/rt/tfl_updates.pb"]);
  assert.ok(feed[2]?.length === 1, "one trip update");
  // TfL down: reported, nothing thrown, the old feed left as it was.
  const down = await refreshTfl({ env, fetchFn: async (u) => (u.includes("tfl-index") ? new Response(JSON.stringify(INDEX)) : new Response("", { status: 503 })), now: NOW + 60_000, encode: encodeTripUpdates });
  assert.equal(down.ok, false);
  assert.match(down.error, /HTTP 503/);
});
