import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplayData, delayClass, hourId, hourUrl, madridToMs, msToMadrid, replayGeoJson, replayRoot, trainsAt } from "./replay.js";

test("replay: Madrid time to and from the moment, across clock changes", () => {
  assert.equal(new Date(madridToMs("2026-11-08", "14:32")).toISOString(), "2026-11-08T13:32:00.000Z", "winter: UTC+1");
  assert.equal(new Date(madridToMs("2026-07-01", "09:00")).toISOString(), "2026-07-01T07:00:00.000Z", "summer: UTC+2");
  assert.deepEqual(msToMadrid(Date.parse("2026-11-08T23:30:00Z")), { date: "2026-11-09", time: "00:30" });
  assert.deepEqual(msToMadrid(madridToMs("2026-03-29", "03:30")), { date: "2026-03-29", time: "03:30" }, "the morning the clocks go forward");
});

const T = Date.parse("2026-11-08T14:00:00Z") / 1000;
const doc = {
  v: 1,
  hour: "2026-11-08T14",
  trains: [["1004D100C3", "C3", "100", "Aranjuez"], ["03001", "AVE", "03001", "Barcelona-Sants"]],
  frames: [
    [T, [[0, -370000, 4030000, 180, 120, 8], [1, -120000, 4110000, -1, null, 16]]],
    [T + 60, [[0, -370000, 4031000, 180, 400, 8]]],
    [T + 3540, [[0, -370000, 4040000, 180, 1000, 8]]],
  ],
};

test("replay: urls, hours and delay colours", () => {
  assert.equal(replayRoot("https://live.example/rt/"), "https://live.example/");
  assert.equal(hourUrl("https://live.example/", "2026-11-08T14"), "https://live.example/replay/2026-11-08/14.json.gz");
  assert.equal(hourId(T * 1000 + 59 * 60_000), "2026-11-08T14");
  assert.deepEqual([0, 299, 300, 899, 900, null].map(delayClass), [0, 0, 1, 1, 2, 3]);
});

test("replay: trains move smoothly between minutes, stay briefly, then go", () => {
  assert.deepEqual(trainsAt(doc, T - 1), [], "before the first frame");
  const half = trainsAt(doc, T + 30);
  assert.equal(half.length, 2);
  assert.ok(Math.abs(half[0].lat - 40.305) < 1e-9, "halfway between the two minutes");
  assert.equal(half[0].delay, 120, "the delay of the minute before");
  assert.equal(half[1].bearing, null);
  // The AVE is missing from the next frame: it stays where it was seen.
  assert.equal(half[1].lat, 41.1);
  // A gap of over 3 min isn't interpolated, and after 2 min there's nothing.
  assert.equal(trainsAt(doc, T + 100)[0].lat, 40.31);
  assert.deepEqual(trainsAt(doc, T + 200), []);
  // Into the next hour's first frame, matched by train key.
  const next = { t: T + 3600, byKey: new Map([["1004D100C3", [5, -370000, 4041000, 180, 1000, 8]]]) };
  assert.ok(Math.abs(trainsAt(doc, T + 3570, next)[0].lat - 40.405) < 1e-9);
});

test("replay: hour files are fetched once, gzipped or not; the map gets the live look", async () => {
  const gz = new Uint8Array(await new Response(new Blob([JSON.stringify(doc)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const urls = [];
  const data = new ReplayData("https://live.example/", async (url) => {
    urls.push(url);
    if (url.endsWith("first.json")) return new Response(JSON.stringify({ hour: "2026-11-08T14" }));
    if (url.endsWith("/14.json.gz")) return new Response(gz);
    return new Response("", { status: 404 });
  });
  assert.deepEqual(await data.first(), { hour: "2026-11-08T14" });
  assert.equal((await data.at(T * 1000 + 30_000)).length, 2);
  assert.equal((await data.at(T * 1000 + 45_000)).length, 2);
  assert.equal(urls.filter((u) => u.endsWith("/14.json.gz")).length, 1, "cached");
  assert.deepEqual(await data.at((T + 7200) * 1000), [], "no file: no trains");
  const g = replayGeoJson(trainsAt(doc, T + 30));
  assert.equal(g.features[0].properties.c, 0);
  assert.equal(g.features[0].properties.t, "cer");
  assert.equal(g.features[1].properties.t, "av");
  assert.equal(g.features[1].properties.c, 3);
});
