//! Data-source abstraction so another country's operator can be added later
//! without touching matching, interpolation or rendering code.

use trainradar_proto::{Incident, Train};

/// What a realtime endpoint carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedKind {
    VehiclePositions,
    TripUpdates,
    Alerts,
}

/// One realtime endpoint an adapter wants polled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeedSpec {
    pub kind: FeedKind,
    /// Fetched by the browser; comes from configuration, not hard-coded logic.
    pub url: String,
    /// Never poll faster than the publisher refreshes the feed.
    pub min_interval_secs: u32,
}

/// Error from decoding a feed payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError(pub String);

/// Operator-specific parsing. The engine owns polling, matching and stats;
/// an adapter only turns raw bytes into domain types.
pub trait SourceAdapter {
    /// Short identifier, e.g. `"renfe"`.
    fn id(&self) -> &'static str;

    /// Realtime endpoints to poll.
    fn feeds(&self) -> &[FeedSpec];

    /// Decode a vehicle-position / trip-update payload into trains.
    fn decode_trains(&self, kind: FeedKind, bytes: &[u8]) -> Result<Vec<Train>, DecodeError>;

    /// Decode an alerts payload into incidents.
    fn decode_incidents(&self, bytes: &[u8]) -> Result<Vec<Incident>, DecodeError>;
}
