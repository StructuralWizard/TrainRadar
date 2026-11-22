//! Ireland (Iarnród Éireann, docs/europe/ie.md): the NTA's GTFS-Realtime
//! trip updates, fetched once by our backend and served next to Spain's and
//! the UK's as `ie/rt/trip_updates.pb`. Plain GTFS-Realtime, decoded like
//! Renfe's; the trip ids are the NTA's GTFS ones, which the timetable keeps.

use crate::source::{DecodeError, FeedData, FeedKind, FeedSpec, SourceAdapter};

#[derive(Debug)]
pub struct Ireland;

/// The NTA allows one call a minute per key; our backend republishes it.
const POLL_SECS: u32 = 30;

static FEEDS: [FeedSpec; 2] = [
    FeedSpec {
        key: "tu_ie",
        kind: FeedKind::TripUpdates,
        path: "trip_updates.pb",
        min_interval_secs: POLL_SECS,
        commuter: None,
    },
    // Irish Rail's alerts, refreshed by the backend every five minutes.
    FeedSpec {
        key: "alerts",
        kind: FeedKind::Alerts,
        path: "alerts.pb",
        min_interval_secs: 120,
        commuter: None,
    },
];

impl SourceAdapter for Ireland {
    fn id(&self) -> &'static str {
        "ireland"
    }

    fn feeds(&self) -> &'static [FeedSpec] {
        &FEEDS
    }

    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        crate::renfe::Renfe.decode(kind, bytes)
    }
}
