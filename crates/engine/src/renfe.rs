//! Renfe adapter: GTFS-RT protobuf feeds on gtfsrt.renfe.com (via the CORS
//! pass-through Worker). Feed list and refresh rates: docs/data-sources.md.

use crate::gtfs_rt::{self, TRIP_CANCELED};
use crate::source::{
    DecodeError, FeedData, FeedKind, FeedSpec, RtTripUpdate, RtVehicle, SourceAdapter,
};
use trainradar_proto::Incident;

#[derive(Debug, Default, Clone, Copy)]
pub struct Renfe;

/// The server sends `Cache-Control: max-age=30`; Renfe refreshes every
/// 15–20 s. Polling every 30 s is the most useful rate that respects both.
const POLL_SECS: u32 = 30;
/// Alerts change rarely (and the feed sometimes stalls for weeks).
const ALERTS_POLL_SECS: u32 = 120;

static FEEDS: [FeedSpec; 5] = [
    FeedSpec {
        key: "vp_ld",
        kind: FeedKind::VehiclePositions,
        path: "vehicle_positions_LD.pb",
        min_interval_secs: POLL_SECS,
        commuter: Some(false),
    },
    FeedSpec {
        key: "tu_ld",
        kind: FeedKind::TripUpdates,
        path: "trip_updates_LD.pb",
        min_interval_secs: POLL_SECS,
        commuter: Some(false),
    },
    FeedSpec {
        key: "vp_cer",
        kind: FeedKind::VehiclePositions,
        path: "vehicle_positions.pb",
        min_interval_secs: POLL_SECS,
        commuter: Some(true),
    },
    FeedSpec {
        key: "tu_cer",
        kind: FeedKind::TripUpdates,
        path: "trip_updates.pb",
        min_interval_secs: POLL_SECS,
        commuter: Some(true),
    },
    FeedSpec {
        key: "alerts",
        kind: FeedKind::Alerts,
        path: "alerts.pb",
        min_interval_secs: ALERTS_POLL_SECS,
        commuter: Some(true),
    },
];

/// Split a Cercanías label like `"C1-23537-PLATF.(3)"` into
/// (line, train number, platform). AV/LD/MD labels are just the number.
pub fn parse_label(label: &str) -> (String, String, Option<String>) {
    let mut parts = label.split('-');
    let first = parts.next().unwrap_or("").trim();
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        return (String::new(), first.to_owned(), None);
    }
    let platform = rest.iter().find(|p| p.starts_with("PLATF")).and_then(|p| {
        let inner = p.split_once('(')?.1.split_once(')')?.0.trim();
        (!inner.is_empty()).then(|| inner.to_owned())
    });
    (first.to_owned(), rest[0].trim().to_owned(), platform)
}

impl SourceAdapter for Renfe {
    fn id(&self) -> &'static str {
        "renfe"
    }

    fn feeds(&self) -> &'static [FeedSpec] {
        &FEEDS
    }

    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        let msg = gtfs_rt::decode(bytes).map_err(|e| DecodeError(e.to_string()))?;
        let entities = msg
            .entity
            .into_iter()
            .filter(|e| e.is_deleted != Some(true));
        Ok(match kind {
            FeedKind::VehiclePositions => FeedData::Vehicles(
                entities
                    .filter_map(|e| {
                        let v = e.vehicle?;
                        let p = v.position?;
                        let desc = v.vehicle.unwrap_or_default();
                        let label = desc.label.unwrap_or_default();
                        let (line, number, platform) = parse_label(&label);
                        let number = if number.is_empty() {
                            desc.id.unwrap_or_default()
                        } else {
                            number
                        };
                        Some(RtVehicle {
                            trip_id: v.trip.and_then(|t| t.trip_id).unwrap_or_default(),
                            train_number: number,
                            line,
                            platform,
                            lat: f64::from(p.latitude),
                            lon: f64::from(p.longitude),
                            bearing: p.bearing,
                            speed: p.speed,
                            timestamp: v.timestamp.map(|t| t as i64),
                            stop_id: v.stop_id,
                            status: v.current_status,
                        })
                    })
                    .filter(|v| v.lat.abs() > 1.0 && v.lon.abs() > 0.0)
                    .collect(),
            ),
            FeedKind::TripUpdates => FeedData::TripUpdates(
                entities
                    .filter_map(|e| {
                        let tu = e.trip_update?;
                        let trip = tu.trip.unwrap_or_default();
                        let stops: Vec<_> = tu
                            .stop_time_update
                            .iter()
                            .map(|s| {
                                let ev = s.arrival.as_ref().or(s.departure.as_ref());
                                (
                                    s.stop_id.clone().unwrap_or_default(),
                                    ev.and_then(|e| e.delay),
                                    ev.and_then(|e| e.time),
                                )
                            })
                            .collect();
                        let delay = tu.delay.or_else(|| stops.iter().rev().find_map(|s| s.1));
                        Some(RtTripUpdate {
                            trip_id: trip.trip_id?,
                            delay,
                            canceled: trip.schedule_relationship == Some(TRIP_CANCELED),
                            stops,
                        })
                    })
                    .collect(),
            ),
            FeedKind::Alerts => FeedData::Alerts(
                entities
                    .filter_map(|e| {
                        let id = e.id.unwrap_or_default();
                        let a = e.alert?;
                        let period = a.active_period.first();
                        Some(Incident {
                            id,
                            header: a.header_text.map(|t| t.pick("es")).unwrap_or_default(),
                            description: a
                                .description_text
                                .map(|t| t.pick("es"))
                                .unwrap_or_default(),
                            active_from: period.and_then(|p| p.start).map(|t| t as i64),
                            active_until: period.and_then(|p| p.end).map(|t| t as i64),
                            route_ids: a
                                .informed_entity
                                .iter()
                                .filter_map(|s| s.route_id.clone())
                                .collect(),
                            stop_ids: a
                                .informed_entity
                                .iter()
                                .filter_map(|s| s.stop_id.clone())
                                .collect(),
                        })
                    })
                    .collect(),
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gtfs_rt::*;
    use prost::Message;

    #[test]
    fn parses_renfe_labels() {
        assert_eq!(
            parse_label("C1-23537-PLATF.(3)"),
            ("C1".into(), "23537".into(), Some("3".into()))
        );
        assert_eq!(
            parse_label("C4a-21007"),
            ("C4a".into(), "21007".into(), None)
        );
        assert_eq!(parse_label("12960"), (String::new(), "12960".into(), None));
        assert_eq!(parse_label("C1-1-PLATF.()").2, None);
    }

    fn vehicle(trip: &str, label: &str, lat: f32, ts: Option<u64>) -> FeedEntity {
        FeedEntity {
            id: Some(format!("VP_{label}")),
            vehicle: Some(VehiclePosition {
                trip: Some(TripDescriptor {
                    trip_id: Some(trip.into()),
                    ..Default::default()
                }),
                position: Some(Position {
                    latitude: lat,
                    longitude: -5.87,
                    ..Default::default()
                }),
                timestamp: ts,
                stop_id: Some("50702".into()),
                current_status: Some(0),
                vehicle: Some(VehicleDescriptor {
                    id: Some("23561".into()),
                    label: Some(label.into()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn decodes_vehicle_positions() {
        let msg = FeedMessage {
            header: Some(FeedHeader {
                gtfs_realtime_version: Some("2.0".into()),
                timestamp: Some(1_793_554_054),
                ..Default::default()
            }),
            entity: vec![
                vehicle(
                    "3004D23561C1",
                    "C1-23561-PLATF.(1)",
                    37.546,
                    Some(1_793_554_051),
                ),
                vehicle("1296012026-10-31", "12960", 42.85, None),
                vehicle("bad", "0", 0.0, None), // no fix: dropped
            ],
        };
        let FeedData::Vehicles(v) = Renfe
            .decode(FeedKind::VehiclePositions, &msg.encode_to_vec())
            .unwrap()
        else {
            panic!("wrong kind");
        };
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].trip_id, "3004D23561C1");
        assert_eq!(v[0].line, "C1");
        assert_eq!(v[0].platform.as_deref(), Some("1"));
        assert_eq!(v[0].timestamp, Some(1_793_554_051));
        assert!((v[0].lat - 37.546).abs() < 1e-4);
        assert_eq!(v[1].train_number, "12960");
        assert_eq!(v[1].timestamp, None);
    }

    #[test]
    fn decodes_trip_updates_and_alerts() {
        let msg = FeedMessage {
            header: None,
            entity: vec![
                FeedEntity {
                    id: Some("TU1".into()),
                    trip_update: Some(TripUpdate {
                        trip: Some(TripDescriptor {
                            trip_id: Some("0146012026-11-01".into()),
                            ..Default::default()
                        }),
                        stop_time_update: vec![StopTimeUpdate {
                            stop_id: Some("65000".into()),
                            arrival: Some(StopTimeEvent {
                                delay: Some(4920),
                                time: Some(1_793_548_200),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }],
                        delay: None,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                FeedEntity {
                    id: Some("TU2".into()),
                    trip_update: Some(TripUpdate {
                        trip: Some(TripDescriptor {
                            trip_id: Some("X".into()),
                            schedule_relationship: Some(TRIP_CANCELED),
                            ..Default::default()
                        }),
                        delay: Some(0),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
        };
        let FeedData::TripUpdates(t) = Renfe
            .decode(FeedKind::TripUpdates, &msg.encode_to_vec())
            .unwrap()
        else {
            panic!("wrong kind");
        };
        assert_eq!(t[0].delay, Some(4920), "falls back to stop-level delay");
        assert_eq!(t[0].stops[0].0, "65000");
        assert!(t[1].canceled);

        let alert = FeedMessage {
            header: None,
            entity: vec![FeedEntity {
                id: Some("A1".into()),
                alert: Some(Alert {
                    active_period: vec![TimeRange {
                        start: Some(10),
                        end: None,
                    }],
                    informed_entity: vec![EntitySelector {
                        route_id: Some("10T0001C1".into()),
                        ..Default::default()
                    }],
                    header_text: Some(TranslatedString {
                        translation: vec![
                            Translation {
                                text: Some("Works".into()),
                                language: Some("en".into()),
                            },
                            Translation {
                                text: Some("Obras".into()),
                                language: Some("es".into()),
                            },
                        ],
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }],
        };
        let FeedData::Alerts(a) = Renfe
            .decode(FeedKind::Alerts, &alert.encode_to_vec())
            .unwrap()
        else {
            panic!("wrong kind");
        };
        assert_eq!(a[0].header, "Obras");
        assert_eq!(a[0].active_from, Some(10));
        assert_eq!(a[0].route_ids, ["10T0001C1"]);
    }

    #[test]
    fn rejects_garbage() {
        assert!(Renfe.decode(FeedKind::Alerts, b"\xff\xff\xff").is_err());
    }
}
