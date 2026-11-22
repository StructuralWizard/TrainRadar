//! France (SNCF, docs/europe/fr.md): SNCF's open GTFS-Realtime trip updates
//! and alerts, fetched once by our backend and served next to the others as
//! `fr/rt/trip_updates.pb` and `fr/rt/alerts.pb`. Plain GTFS-Realtime,
//! decoded like Renfe's; the trip ids are the static file's (the
//! "NewTripId" export), which the timetable keeps.

use crate::source::{DecodeError, FeedData, FeedKind, FeedSpec, SourceAdapter};

#[derive(Debug)]
pub struct France;

static FEEDS: [FeedSpec; 2] = [
    // SNCF refreshes its trip updates every two minutes; our backend
    // republishes them every minute.
    FeedSpec {
        key: "tu_fr",
        kind: FeedKind::TripUpdates,
        path: "trip_updates.pb",
        min_interval_secs: 30,
        commuter: None,
    },
    FeedSpec {
        key: "alerts",
        kind: FeedKind::Alerts,
        path: "alerts.pb",
        min_interval_secs: 120,
        commuter: None,
    },
];

impl SourceAdapter for France {
    fn id(&self) -> &'static str {
        "france"
    }

    fn feeds(&self) -> &'static [FeedSpec] {
        &FEEDS
    }

    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        crate::renfe::Renfe.decode(kind, bytes)
    }
}

/// SNCF's regions: the national one and the TER areas (refdata-build
/// `france::split`).
pub fn is_french_region(region: &str) -> bool {
    region == "fr" || region.starts_with("fr-")
}
