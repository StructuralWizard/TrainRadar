//! GTFS-Realtime protobuf messages (the subset TrainRadar uses), with field
//! numbers from the official `gtfs-realtime.proto` (Apache-2.0, MobilityData).
//! Hand-written prost structs, so the build needs no `protoc`.

use prost::Message;

#[derive(Clone, PartialEq, Message)]
pub struct FeedMessage {
    #[prost(message, optional, tag = "1")]
    pub header: Option<FeedHeader>,
    #[prost(message, repeated, tag = "2")]
    pub entity: Vec<FeedEntity>,
}

#[derive(Clone, PartialEq, Message)]
pub struct FeedHeader {
    #[prost(string, optional, tag = "1")]
    pub gtfs_realtime_version: Option<String>,
    #[prost(int32, optional, tag = "2")]
    pub incrementality: Option<i32>,
    #[prost(uint64, optional, tag = "3")]
    pub timestamp: Option<u64>,
}

#[derive(Clone, PartialEq, Message)]
pub struct FeedEntity {
    #[prost(string, optional, tag = "1")]
    pub id: Option<String>,
    #[prost(bool, optional, tag = "2")]
    pub is_deleted: Option<bool>,
    #[prost(message, optional, tag = "3")]
    pub trip_update: Option<TripUpdate>,
    #[prost(message, optional, tag = "4")]
    pub vehicle: Option<VehiclePosition>,
    #[prost(message, optional, tag = "5")]
    pub alert: Option<Alert>,
}

#[derive(Clone, PartialEq, Message)]
pub struct TripDescriptor {
    #[prost(string, optional, tag = "1")]
    pub trip_id: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub start_time: Option<String>,
    #[prost(string, optional, tag = "3")]
    pub start_date: Option<String>,
    /// 0 SCHEDULED, 1 ADDED, 2 UNSCHEDULED, 3 CANCELED.
    #[prost(int32, optional, tag = "4")]
    pub schedule_relationship: Option<i32>,
    #[prost(string, optional, tag = "5")]
    pub route_id: Option<String>,
    #[prost(uint32, optional, tag = "6")]
    pub direction_id: Option<u32>,
}

pub const TRIP_CANCELED: i32 = 3;

#[derive(Clone, PartialEq, Message)]
pub struct VehicleDescriptor {
    #[prost(string, optional, tag = "1")]
    pub id: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub label: Option<String>,
    #[prost(string, optional, tag = "3")]
    pub license_plate: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
pub struct StopTimeEvent {
    #[prost(int32, optional, tag = "1")]
    pub delay: Option<i32>,
    #[prost(int64, optional, tag = "2")]
    pub time: Option<i64>,
    #[prost(int32, optional, tag = "3")]
    pub uncertainty: Option<i32>,
}

#[derive(Clone, PartialEq, Message)]
pub struct StopTimeUpdate {
    #[prost(uint32, optional, tag = "1")]
    pub stop_sequence: Option<u32>,
    #[prost(message, optional, tag = "2")]
    pub arrival: Option<StopTimeEvent>,
    #[prost(message, optional, tag = "3")]
    pub departure: Option<StopTimeEvent>,
    #[prost(string, optional, tag = "4")]
    pub stop_id: Option<String>,
    #[prost(int32, optional, tag = "5")]
    pub schedule_relationship: Option<i32>,
}

#[derive(Clone, PartialEq, Message)]
pub struct TripUpdate {
    #[prost(message, optional, tag = "1")]
    pub trip: Option<TripDescriptor>,
    #[prost(message, repeated, tag = "2")]
    pub stop_time_update: Vec<StopTimeUpdate>,
    #[prost(message, optional, tag = "3")]
    pub vehicle: Option<VehicleDescriptor>,
    #[prost(uint64, optional, tag = "4")]
    pub timestamp: Option<u64>,
    #[prost(int32, optional, tag = "5")]
    pub delay: Option<i32>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Position {
    #[prost(float, tag = "1")]
    pub latitude: f32,
    #[prost(float, tag = "2")]
    pub longitude: f32,
    #[prost(float, optional, tag = "3")]
    pub bearing: Option<f32>,
    #[prost(double, optional, tag = "4")]
    pub odometer: Option<f64>,
    /// Metres per second.
    #[prost(float, optional, tag = "5")]
    pub speed: Option<f32>,
}

#[derive(Clone, PartialEq, Message)]
pub struct VehiclePosition {
    #[prost(message, optional, tag = "1")]
    pub trip: Option<TripDescriptor>,
    #[prost(message, optional, tag = "2")]
    pub position: Option<Position>,
    #[prost(uint32, optional, tag = "3")]
    pub current_stop_sequence: Option<u32>,
    /// 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO.
    #[prost(int32, optional, tag = "4")]
    pub current_status: Option<i32>,
    #[prost(uint64, optional, tag = "5")]
    pub timestamp: Option<u64>,
    #[prost(string, optional, tag = "7")]
    pub stop_id: Option<String>,
    #[prost(message, optional, tag = "8")]
    pub vehicle: Option<VehicleDescriptor>,
}

#[derive(Clone, PartialEq, Message)]
pub struct TimeRange {
    #[prost(uint64, optional, tag = "1")]
    pub start: Option<u64>,
    #[prost(uint64, optional, tag = "2")]
    pub end: Option<u64>,
}

#[derive(Clone, PartialEq, Message)]
pub struct EntitySelector {
    #[prost(string, optional, tag = "1")]
    pub agency_id: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub route_id: Option<String>,
    #[prost(int32, optional, tag = "3")]
    pub route_type: Option<i32>,
    #[prost(message, optional, tag = "4")]
    pub trip: Option<TripDescriptor>,
    #[prost(string, optional, tag = "5")]
    pub stop_id: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Translation {
    #[prost(string, optional, tag = "1")]
    pub text: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub language: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
pub struct TranslatedString {
    #[prost(message, repeated, tag = "1")]
    pub translation: Vec<Translation>,
}

impl TranslatedString {
    /// Text in `lang` if present, else Spanish, else the first translation.
    pub fn pick(&self, lang: &str) -> String {
        let by = |l: &str| {
            self.translation.iter().find(|t| {
                t.language
                    .as_deref()
                    .is_some_and(|x| x.eq_ignore_ascii_case(l))
            })
        };
        by(lang)
            .or_else(|| by("es"))
            .or_else(|| self.translation.first())
            .and_then(|t| t.text.clone())
            .unwrap_or_default()
    }
}

#[derive(Clone, PartialEq, Message)]
pub struct Alert {
    #[prost(message, repeated, tag = "1")]
    pub active_period: Vec<TimeRange>,
    #[prost(message, repeated, tag = "5")]
    pub informed_entity: Vec<EntitySelector>,
    #[prost(int32, optional, tag = "6")]
    pub cause: Option<i32>,
    #[prost(int32, optional, tag = "7")]
    pub effect: Option<i32>,
    #[prost(message, optional, tag = "8")]
    pub url: Option<TranslatedString>,
    #[prost(message, optional, tag = "10")]
    pub header_text: Option<TranslatedString>,
    #[prost(message, optional, tag = "11")]
    pub description_text: Option<TranslatedString>,
}

pub fn decode(bytes: &[u8]) -> Result<FeedMessage, prost::DecodeError> {
    FeedMessage::decode(bytes)
}
