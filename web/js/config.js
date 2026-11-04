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
  // The public site, for shared links (…?train=03020).
  siteUrl: "https://trainradar.pages.dev/",
  // "web" or "android" (tools/build-web.sh --target android, phase C4).
  platform: "web",
  // TrainRadar Pro unlocked (Android, phase C5). Always false until then.
  pro: false,
  // Google Play listing of the Android app; "" hides every app link until
  // the listing is live.
  playUrl: "",
  // "Invítame a un café" page (web only, never in the Android app); "" hides it.
  coffeeUrl: "",
};
