//! Countries shown by timetable only, with no live feed yet (Luxembourg,
//! docs/europe/west-central.md): nothing to poll, every train placed by
//! its timetable (the regions are built with `live: false`).

use crate::source::{DecodeError, FeedData, FeedKind, FeedSpec, SourceAdapter};

#[derive(Debug)]
pub struct TimetableOnly;

impl SourceAdapter for TimetableOnly {
    fn id(&self) -> &'static str {
        "timetable"
    }

    fn feeds(&self) -> &'static [FeedSpec] {
        &[]
    }

    fn decode(&self, _kind: FeedKind, _bytes: &[u8]) -> Result<FeedData, DecodeError> {
        Err(DecodeError("no live feed for this country".into()))
    }
}
