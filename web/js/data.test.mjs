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

test("data: another origin's files are kept for offline use; the manifest is asked for first", async () => {
  const { fetchBytes, fetchManifest, pruneOffline } = await import("./data.js");
  const store = new Map();
  const cache = {
    match: async (u) => (store.has(u) ? store.get(u).clone() : undefined),
    put: async (u, r) => void store.set(u, r),
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (req) => store.delete(req.url),
  };
  globalThis.caches = { open: async () => cache };
  globalThis.location = { href: "https://localhost/index.html", origin: "https://localhost" };
  try {
    const far = "https://site.example/data/fr/";
    const calls = site({ [`${far}manifest.json`]: manifest("2026-11-25", 1, "a"), [`${far}tt-fr.a.bin`]: "abc", "data/tt.bin": "local" });
    assert.equal((await fetchManifest(far)).window_start, "2026-11-25");
    assert.equal(new TextDecoder().decode(await fetchBytes(`${far}tt-fr.a.bin`)), "abc");
    // A content-hashed file: from the copy, without the network.
    calls.length = 0;
    await fetchBytes(`${far}tt-fr.a.bin`);
    assert.deepEqual(calls, []);
    // The page's own files aren't copied.
    await fetchBytes("data/tt.bin");
    assert.ok(![...store.keys()].some((u) => u.includes("localhost")));
    // Offline: the manifest from the copy.
    globalThis.fetch = async () => {
      throw new TypeError("offline");
    };
    assert.equal((await fetchManifest(far)).window_start, "2026-11-25");
    await assert.rejects(fetchManifest("https://site.example/data/de/"));
    // Files the manifest no longer names go; other countries' stay.
    store.set("https://site.example/data/fr/tt-fr.old.bin", new Response("x"));
    store.set("https://site.example/data/de/tt-de.x.bin", new Response("x"));
    await pruneOffline(far, { stations: { file: "stations.a.bin" }, regions: [{ file: "tt-fr.a.bin" }] });
    assert.ok(!store.has("https://site.example/data/fr/tt-fr.old.bin"));
    assert.ok(store.has(`${far}tt-fr.a.bin`) && store.has(`${far}manifest.json`));
    assert.ok(store.has("https://site.example/data/de/tt-de.x.bin"));
  } finally {
    delete globalThis.caches;
    delete globalThis.location;
  }
});
