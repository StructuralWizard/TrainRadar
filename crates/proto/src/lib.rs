//! Domain types shared by the browser engine and the `refdata-build` CLI.
//!
//! Everything here is plain data: serde-serialisable and encoded with
//! [`postcard`] for the compact `.bin` reference files.

#![no_std]
extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Version of the `.bin` format. Bump when a stored type changes shape.
pub const FORMAT_VERSION: u16 = 1;

/// WGS84 coordinate in degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

impl LatLon {
    pub const fn new(lat: f64, lon: f64) -> Self {
        Self { lat, lon }
    }
}

/// How a position was obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionSource {
    /// Straight from a GPS fix in the realtime feed.
    Gps,
    /// Estimated along the shape from the schedule plus current delay.
    Interpolated,
}

/// A train position at a point in time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub coord: LatLon,
    /// Bearing in degrees clockwise from north, if known.
    pub bearing: Option<f32>,
    /// Unix seconds of the last GPS fix this position is based on.
    pub fix_time: i64,
    pub source: PositionSource,
}

impl Position {
    /// Age of the underlying GPS fix in seconds at `now` (never negative).
    pub fn fix_age(&self, now: i64) -> i64 {
        (now - self.fix_time).max(0)
    }
}

/// Delay in seconds; negative means early.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Delay(pub i32);

/// Colour band used on the map.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DelayClass {
    /// On time or under 5 minutes late.
    OnTime,
    /// 5 to 14 minutes late.
    Minor,
    /// 15 minutes or more late.
    Major,
}

impl Delay {
    pub const fn minutes(self) -> i32 {
        self.0 / 60
    }

    pub const fn class(self) -> DelayClass {
        match self.0 {
            s if s < 5 * 60 => DelayClass::OnTime,
            s if s < 15 * 60 => DelayClass::Minor,
            _ => DelayClass::Major,
        }
    }
}

/// Service family. Cercanías data is split per núcleo and lazy-loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Service {
    /// AV/LD/MD (alta velocidad, larga y media distancia).
    LongDistance,
    /// Cercanías / Rodalies, with the núcleo identifier.
    Commuter { nucleo: String },
}

/// A station from the static reference data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Station {
    pub id: String,
    pub name: String,
    pub coord: LatLon,
}

/// Spacing to a neighbouring train running the same way on the same line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Gap {
    pub trip_id: String,
    /// Distance along the track (shape), in metres. Never straight-line.
    pub distance_m: u32,
    /// Time separation in seconds: how long after the leading train the following
    /// train is expected to pass the same point, using schedule plus current delay.
    pub time_secs: u32,
    /// How the gap was estimated; `Interpolated` if either train's position is.
    pub source: PositionSource,
}

/// A live train as shown on the map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Train {
    pub trip_id: String,
    /// Commercial train number or line label shown to users.
    pub label: String,
    pub service: Service,
    pub origin: String,
    pub destination: String,
    pub next_stop: Option<String>,
    pub delay: Option<Delay>,
    pub position: Position,
    /// Train ahead on the same line and direction, if any.
    pub ahead: Option<Gap>,
    /// Train behind on the same line and direction, if any.
    pub behind: Option<Gap>,
}

/// A service incident or notice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Incident {
    pub id: String,
    pub header: String,
    pub description: String,
    /// Unix seconds; `None` means open-ended.
    pub active_from: Option<i64>,
    pub active_until: Option<i64>,
    pub route_ids: Vec<String>,
    pub stop_ids: Vec<String>,
}

/// Encode any proto value as postcard bytes.
pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, postcard::Error> {
    postcard::to_allocvec(value)
}

/// Decode postcard bytes produced by [`encode`].
pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::ToString;
    use alloc::vec;

    fn sample_train() -> Train {
        Train {
            trip_id: "0071023042026".to_string(),
            label: "AVE 03071".to_string(),
            service: Service::LongDistance,
            origin: "Madrid-Puerta de Atocha".to_string(),
            destination: "Barcelona-Sants".to_string(),
            next_stop: Some("Zaragoza-Delicias".to_string()),
            delay: Some(Delay(7 * 60)),
            position: Position {
                coord: LatLon::new(41.0, -2.5),
                bearing: Some(45.0),
                fix_time: 1_000,
                source: PositionSource::Interpolated,
            },
            ahead: Some(Gap {
                trip_id: "0069023042026".to_string(),
                distance_m: 42_300,
                time_secs: 14 * 60,
                source: PositionSource::Gps,
            }),
            behind: None,
        }
    }

    #[test]
    fn delay_classes_match_map_bands() {
        assert_eq!(Delay(-120).class(), DelayClass::OnTime);
        assert_eq!(Delay(0).class(), DelayClass::OnTime);
        assert_eq!(Delay(4 * 60 + 59).class(), DelayClass::OnTime);
        assert_eq!(Delay(5 * 60).class(), DelayClass::Minor);
        assert_eq!(Delay(14 * 60 + 59).class(), DelayClass::Minor);
        assert_eq!(Delay(15 * 60).class(), DelayClass::Major);
    }

    #[test]
    fn fix_age_is_never_negative() {
        let p = sample_train().position;
        assert_eq!(p.fix_age(1_900), 900);
        assert_eq!(p.fix_age(500), 0);
    }

    #[test]
    fn train_round_trips_through_postcard() {
        let t = sample_train();
        let bytes = encode(&t).unwrap();
        assert_eq!(decode::<Train>(&bytes).unwrap(), t);
    }

    #[test]
    fn station_and_incident_round_trip() {
        let s = Station {
            id: "60000".to_string(),
            name: "Madrid-Puerta de Atocha".to_string(),
            coord: LatLon::new(40.4065, -3.6895),
        };
        assert_eq!(decode::<Station>(&encode(&s).unwrap()).unwrap(), s);

        let i = Incident {
            id: "a1".to_string(),
            header: "Obras".to_string(),
            description: "Servicio por carretera".to_string(),
            active_from: Some(1),
            active_until: None,
            route_ids: vec!["C1".to_string()],
            stop_ids: vec![],
        };
        assert_eq!(decode::<Incident>(&encode(&i).unwrap()).unwrap(), i);
    }
}
