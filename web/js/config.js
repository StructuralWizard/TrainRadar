// Deployment settings. tools/build-web.sh rewrites RT_BASE for production
// (the Cloudflare Worker URL); locally the dev server answers /rt/.
export const CONFIG = {
  // Base URL of the CORS pass-through for Renfe's GTFS-RT feeds.
  rtBase: "/rt/",
  // Reference data built by refdata-build.
  dataBase: "data/",
  // Free vector tiles, no API key (https://openfreemap.org).
  style: "https://tiles.openfreemap.org/styles/positron",
  // Initial view: mainland Spain.
  center: [-3.7, 40.2],
  zoom: 5.2,
  // Load a Cercanías núcleo's timetable once this zoomed in over it.
  regionZoom: 8,
};
