// France (docs/europe/fr.md): SNCF's open GTFS-Realtime, trip updates and
// alerts, through transport.data.gouv.fr's proxy. No key and no
// filtering: the feeds hold SNCF's trains only (TGV INOUI, OUIGO,
// Intercités, TER). SNCF refreshes them every two minutes; we call each
// once a minute, alternating, so every user reads our copy instead.
// Licence: ODbL (transport.data.gouv.fr's special conditions).

export const FR = {
  code: "fr",
  prefix: "fr/rt/",
  base: "https://proxy.transport.data.gouv.fr/resource/",
  cycleMs: 30_000,
  // Every 30 s: alerts on even cycles, trip updates on odd ones.
  feeds: [
    { name: "trip_updates.pb", path: "sncf-gtfs-rt-trip-updates", every: 1 },
    { name: "alerts.pb", path: "sncf-gtfs-rt-service-alerts", every: 2 },
  ],
  source: "SNCF Voyageurs, GTFS-Realtime via transport.data.gouv.fr, ODbL 1.0",
  enabled: (env) => env.FR_ENABLED === "true",
  missing: () => null,
  headers: () => ({ accept: "application/x-protobuf", "cache-control": "no-cache" }),
  // Everything in SNCF's feeds is SNCF's: keep it all.
  keep: () => null,
};
