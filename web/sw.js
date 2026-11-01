// Service worker: lets TrainRadar open from the home screen and start
// offline with the last reference data. Live feeds, map tiles and anything
// cross-origin are never cached here. Nothing personal is stored.
const VERSION = "dev"; // replaced with the commit id at deploy
const SHELL = `shell-${VERSION}`;
const DATA = "data-v1";
const SHELL_FILES = [
  "./",
  "index.html",
  "app.css",
  "main.js",
  "js/config.js",
  "js/data.js",
  "js/feeds.js",
  "js/format.js",
  "js/i18n.js",
  "js/location.js",
  "js/map.js",
  "js/ui.js",
  "pkg/engine.js",
  "pkg/engine_bg.wasm",
  "vendor/maplibre/maplibre-gl.mjs",
  "vendor/maplibre/maplibre-gl-worker.mjs",
  "vendor/maplibre/maplibre-gl.css",
  "icon.svg",
  "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Content-hashed reference data never changes: cache first.
  if (/\/data\/.+\.bin(\.gz)?$/.test(url.pathname)) {
    e.respondWith(
      caches.open(DATA).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      }),
    );
    return;
  }
  // Everything else (app files, manifest.json): network first, cache as fallback.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && !url.pathname.startsWith("/rt/")) {
          const copy = r.clone();
          caches.open(url.pathname.includes("/data/") ? DATA : SHELL).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
