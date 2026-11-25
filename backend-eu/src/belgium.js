// Belgium: SNCB/NMBS's GTFS-Realtime (trip updates and service alerts)
// through the Belgian Mobility Company's API gateway (Azure API Management),
// with the subscription key BE_SNCB_KEY (AGENTS.md) only in the
// Ocp-Apim-Subscription-Key header. Its trip ids are the static GTFS's
// (the same gateway's /nmbssncb/static, the deploy's timetable).
//
// Terms: the national access point marks SNCB's feeds non-commercial and
// SNCB's FAQ forbids redistributing the raw data (docs/europe/west-central.md):
// Belgium stays hidden until SNCB allows commercial use in writing.

const CLIENT = "Metranos-TrainRadar";

export const BE = {
  code: "be",
  prefix: "be/rt/",
  base: "https://api-management-opendata-production.azure-api.net/api/gtfs/feed/nmbssncb/rt/",
  // Trip updates every 30 s (SNCB refreshes them about that often), alerts
  // every 5 minutes in their place.
  cycleMs: 30_000,
  feeds: [
    { name: "trip_updates.pb", path: "trip-update?format=protobuf", every: 1 },
    { name: "alerts.pb", path: "alert?format=protobuf", every: 10 },
  ],
  source: "SNCB/NMBS, GTFS-Realtime via the Belgian Mobility Company's open data gateway",
  // The Worker's BE_ENABLED is set from the GitHub variable BE_LIVE_ENABLED.
  enabled: (env) => env.BE_ENABLED === "true" && !!env.BE_SNCB_KEY,
  missing: (env) => (env.BE_SNCB_KEY ? null : "no subscription key (BE_SNCB_KEY)"),
  headers: (env) => ({
    "Ocp-Apim-Subscription-Key": env.BE_SNCB_KEY,
    "user-agent": CLIENT,
    accept: "application/x-protobuf, application/octet-stream",
  }),
  keep: () => null,
};
