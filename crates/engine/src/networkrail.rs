//! Network Rail adapter (plan 3, the UK). The UK ingest Worker
//! (`backend-uk/`) turns TRUST into GTFS-Realtime TripUpdates at
//! `uk/rt/trip_updates.pb`; there are no vehicle positions in UK open data,
//! so trains are placed by their timetable shifted by that delay
//! (`live::scheduled_trains`). Trip ids are `UID:start date:STP`, as
//! `refdata-build --uk-schedule` writes them.

use crate::source::{DecodeError, FeedData, FeedKind, FeedSpec, SourceAdapter};

#[derive(Debug, Default, Clone, Copy)]
pub struct NetworkRail;

/// The ingest Worker rewrites the file once a minute (Cache-Control 30 s).
const POLL_SECS: u32 = 30;

/// Great Britain's (TRUST) and London's: the Underground, DLR and Trams,
/// TfL's arrival predictions matched to the timetable by the same Worker
/// (`backend-uk/src/tfl.js`), trip ids `tfl:…` as `tools/uk/tfl-gtfs.py`
/// writes them.
static FEEDS: [FeedSpec; 2] = [
    FeedSpec {
        key: "tu_uk",
        kind: FeedKind::TripUpdates,
        path: "trip_updates.pb",
        min_interval_secs: POLL_SECS,
        commuter: None,
    },
    FeedSpec {
        key: "tu_tfl",
        kind: FeedKind::TripUpdates,
        path: "tfl_updates.pb",
        min_interval_secs: POLL_SECS,
        commuter: None,
    },
];

impl SourceAdapter for NetworkRail {
    fn id(&self) -> &'static str {
        "networkrail"
    }

    fn feeds(&self) -> &'static [FeedSpec] {
        &FEEDS
    }

    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        // Plain GTFS-Realtime: the same decoding as Renfe's trip updates.
        crate::renfe::Renfe.decode(kind, bytes)
    }
}

/// Region code of Great Britain's timetable (refdata-build `build::UK`).
pub const UK_REGION: &str = "uk";
/// Northern Ireland (NI Railways, Translink's timetable; plan 4).
pub const NI_REGION: &str = "ni";
/// London Underground, DLR and Trams (TfL), in the UK's data.
pub const TFL_REGION: &str = "uk-tfl";
/// Ireland (Iarnród Éireann, the NTA's timetable; docs/europe/ie.md).
pub const IE_REGION: &str = "ie";

/// Seconds the region's local time is behind Madrid's: the UK keeps the
/// same summer-time dates as Spain, one hour behind all year.
pub fn behind_madrid_secs(region: &str) -> i64 {
    if region == UK_REGION || region == NI_REGION || region == IE_REGION {
        3_600
    } else {
        0
    }
}

/// Regions whose trains are placed by their timetable: operators that
/// publish no live data (OUIGO); the UK, Ireland, France and the
/// Netherlands, which publish delays but no positions; and Finland and
/// Norway, for their trains without GPS (`nordic::mixed`).
pub fn placed_by_timetable(region: &str, live: bool) -> bool {
    !live
        || region == UK_REGION
        || region == TFL_REGION
        || region == IE_REGION
        || crate::france::is_french_region(region)
        || crate::nordic::placed(region)
        || crate::nordic::mixed(region)
}
