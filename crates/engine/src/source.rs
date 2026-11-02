//! Data-source abstraction so another country's operator can be added later
//! without touching matching, interpolation or rendering code.
//!
//! An adapter only turns raw feed bytes into the normalised records below;
//! the engine owns polling, matching, delays, interpolation and stats.

use trainradar_proto::Incident;

/// What a realtime endpoint carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FeedKind {
    VehiclePositions,
    TripUpdates,
    Alerts,
}

/// One realtime endpoint an adapter wants polled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeedSpec {
    /// Stable key, e.g. `"vp_ld"`; the web app uses it to name feeds.
    pub key: &'static str,
    pub kind: FeedKind,
    /// Path appended to the configured base URL (the CORS pass-through Worker).
    pub path: &'static str,
    /// Never poll faster than the publisher refreshes the feed.
    pub min_interval_secs: u32,
    /// `None` = always poll; `Some(true)` = only while a Cercanías region is
    /// loaded; `Some(false)` = only for long-distance.
    pub commuter: Option<bool>,
}

/// A vehicle position, normalised.
#[derive(Debug, Clone, PartialEq)]
pub struct RtVehicle {
    pub trip_id: String,
    /// Commercial train number, used when `trip_id` doesn't match the timetable.
    pub train_number: String,
    /// Route/line label shown to users (e.g. "C1"), if the feed has one.
    pub line: String,
    /// Platform, if the feed encodes it.
    pub platform: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub bearing: Option<f32>,
    /// Metres per second.
    pub speed: Option<f32>,
    /// Unix seconds of the GPS fix, when the feed provides it.
    pub timestamp: Option<i64>,
    pub stop_id: Option<String>,
    pub status: Option<i32>,
}

/// A trip update, normalised.
#[derive(Debug, Clone, PartialEq)]
pub struct RtTripUpdate {
    pub trip_id: String,
    /// Trip-level delay in seconds, or the latest stop-level one.
    pub delay: Option<i32>,
    pub canceled: bool,
    /// Wheelchair accessible vehicle, if the feed says.
    pub accessible: Option<bool>,
    /// (stop id, arrival delay seconds, arrival unix time).
    pub stops: Vec<(String, Option<i32>, Option<i64>)>,
}

/// Decoded contents of one feed fetch.
#[derive(Debug, Clone, PartialEq)]
pub enum FeedData {
    Vehicles(Vec<RtVehicle>),
    TripUpdates(Vec<RtTripUpdate>),
    Alerts(Vec<Incident>),
}

/// Error from decoding a feed payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError(pub String);

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DecodeError {}

/// Operator-specific parsing.
pub trait SourceAdapter {
    /// Short identifier, e.g. `"renfe"`.
    fn id(&self) -> &'static str;

    /// Realtime endpoints to poll.
    fn feeds(&self) -> &'static [FeedSpec];

    /// Decode a payload fetched from `feeds()[i]`.
    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError>;
}
