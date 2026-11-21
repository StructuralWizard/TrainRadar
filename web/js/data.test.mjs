import { test } from "node:test";
import assert from "node:assert/strict";
import { RefData, newerData } from "./data.js";

// A fake site: manifests and files by URL; every fetch is recorded.
function site(files) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (!(url in files)) return new Response("no", { status: 404 });
    const v = files[url];
    if (v instanceof Error) throw v;
    return new Response(typeof v === "string" ? v : JSON.stringify(v), { status: 200 });
  };
  return calls;
}
const manifest = (start, gen, tag) => ({
  window_start: start,
  generated_at: gen,
  stations: { file: `stations.${tag}.bin` },
  regions: [
    { code: "ld", file: `tt-ld.${tag}.bin`, live: true, bbox: [0, 0, 0, 0] },
    { code: "10", file: `tt-10.${tag}.bin`, live: true, bbox: [40, -4, 41, -3] },
  ],
});
const files = (base, m) => ({
  [`${base}manifest.json`]: m,
  [`${base}${m.stations.file}`]: "S",
  ...Object.fromEntries(m.regions.map((r) => [`${base}${r.file}`, r.code])),
});
function fakeEngine() {
  const e = { stations: [], timetables: [] };
  e.loadStations = (b) => e.stations.push(new TextDecoder().decode(b));
  e.loadTimetable = (b) => e.timetables.push(new TextDecoder().decode(b));
  return e;
}

test("data: newer = later window, or same window rebuilt later", () => {
  assert.ok(newerData({ window_start: "2026-11-20" }, { window_start: "2026-11-10" }));
  assert.ok(!newerData({ window_start: "2026-11-10" }, { window_start: "2026-11-20" }));
  assert.ok(newerData({ window_start: "2026-11-20", generated_at: 2 }, { window_start: "2026-11-20", generated_at: 1 }));
  assert.ok(!newerData(null, { window_start: "2026-11-20" }));
  assert.ok(newerData({ window_start: "2026-11-20" }, null));
});

test("data: a page left open reloads the timetables it has once the site has new ones", async () => {
  const old = manifest("2026-11-10", 1, "a");
  site(files("data/", old));
  const e = fakeEngine();
  const ref = new RefData(e, "data/");
  await ref.start();
  await ref.loadRegion("10");
  assert.deepEqual(e.timetables, ["ld", "10"]);
  // Nothing new yet.
  assert.equal(await ref.refresh(), false);
  // The daily rebuild: a new window, new hashed files.
  const neu = manifest("2026-11-20", 2, "b");
  site(files("data/", neu));
  assert.equal(await ref.refresh(), true);
  assert.equal(ref.manifest.window_start, "2026-11-20");
  assert.deepEqual(e.stations, ["S", "S"]);
  assert.equal(e.timetables.length, 4, "both loaded timetables reloaded");
  assert.ok(ref.loaded.has("ld") && ref.loaded.has("10"));
  // Offline: nothing changes, no error.
  globalThis.fetch = async () => {
    throw new TypeError("offline");
  };
  assert.equal(await ref.refresh(), false);
  // Not checked again before it's due.
  ref.checkedAt = Date.now();
  assert.equal(await ref.refreshIfDue(), false);
});

test("data: the app starts on the site's data when newer than its own copy, offline on its own", async () => {
  const bundled = manifest("2026-11-10", 1, "a");
  const remote = manifest("2026-11-20", 2, "b");
  const R = "https://site.example/data/";
  const calls = site({ ...files("data/", bundled), ...files(R, remote) });
  const e = fakeEngine();
  const ref = new RefData(e, "data/", R);
  await ref.start();
  assert.equal(ref.manifest.window_start, "2026-11-20");
  assert.ok(calls.includes(`${R}tt-ld.b.bin`), "timetable from the site");
  assert.ok(!calls.includes("data/tt-ld.a.bin"));
  // Offline start: the copy in the app.
  site({ ...files("data/", bundled), [`${R}manifest.json`]: new TypeError("offline") });
  const ref2 = new RefData(fakeEngine(), "data/", R);
  await ref2.start();
  assert.equal(ref2.manifest.window_start, "2026-11-10");
  assert.equal(ref2.base, "data/");
  // Back online later: refresh() goes to the site.
  site({ ...files("data/", bundled), ...files(R, remote) });
  assert.equal(await ref2.refresh(), true);
  assert.equal(ref2.base, R);
});
