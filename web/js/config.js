// Deployment settings. tools/build-web.sh rewrites the URLs for production;
// locally the dev server answers /rt/ (including a status.json like the
// central poller's).
export const CONFIG = {
  // Central poller's bucket (rt/status.json + rt/<feed>.pb, CDN-cached).
  // "" = not available: use the pass-through only.
  liveBase: "/rt/",
  // CORS pass-through for Renfe's GTFS-RT feeds: the fallback when the live
  // bucket fails 3 times in a row (and the only source without one).
  rtBase: "/rt/",
  // Public delay-history API origin (backend/src/api.js), with a trailing
  // slash; "" hides the history teaser. Locally the dev server answers.
  apiBase: "/",
  // Reference data built by refdata-build.
  dataBase: "data/",
  // Free vector tiles, no API key (https://openfreemap.org).
  style: "https://tiles.openfreemap.org/styles/positron",
  // Initial view: mainland Spain.
  center: [-3.7, 40.2],
  zoom: 5.2,
  // Load a Cercanías núcleo's timetable once this zoomed in over it.
  regionZoom: 8,
  // App version shown in About (set by tools/build-web.sh from APP_VERSION).
  appVersion: "dev",
  // First day of TrainRadar's delay history (the recorder started then):
  // the history screen says so, so a short history isn't taken for a fault.
  historySince: "2026-11-04",
  // The public site, for shared links (…?train=03020).
  siteUrl: "https://trainradar.pages.dev/",
  // "web" or "android" (tools/build-web.sh --target android, phase C4).
  platform: "web",
  // TrainRadar Pro unlocked: set at run time from Google Play (Android app,
  // phase C5, js/entitlement.js). Always false on the web.
  pro: false,
  // Google Play products (Play Console ids). More (yearly, lifetime: phase
  // C8) can be added here without changing the screens.
  products: [
    { id: "pro_monthly", kind: "subscription", pro: true },
    { id: "tip_small", kind: "tip" },
    { id: "tip_medium", kind: "tip" },
    { id: "tip_large", kind: "tip" },
  ],
  // Google Play listing of the Android app; "" hides every app link until
  // the listing is live.
  playUrl: "",
  // "Invítame a un café" page (web only, never in the Android app); "" hides it.
  coffeeUrl: "",
};
