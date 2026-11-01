//! Generate fake GTFS-RT feeds from a refdata build, for offline UI work and
//! tests: every trip scheduled around now gets a vehicle where the timetable
//! (plus a made-up delay) puts it, and a matching trip update.
//!
//!   cargo run -p trainradar-engine --example fixture -- web/data OUT_DIR [unix_now]
//!
//! Writes OUT_DIR/{vehicle_positions,trip_updates}{,_LD}.pb and alerts.pb.

use prost::Message;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use trainradar_engine::gtfs_rt::*;
use trainradar_engine::network::{Network, TripRef, train_number};
use trainradar_engine::schedule::dist_at;
use trainradar_proto::time::{madrid_day, service_day_base};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (data, out) = (Path::new(&args[0]), Path::new(&args[1]));
    let now: i64 = match args.get(2) {
        Some(n) => n.parse()?,
        None => SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64,
    };
    std::fs::create_dir_all(out)?;
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(data.join("manifest.json"))?)?;
    let mut net = Network::default();
    let file = |v: &serde_json::Value| std::fs::read(data.join(v["file"].as_str().unwrap()));
    for r in manifest["regions"].as_array().unwrap() {
        net.load_timetable(&file(r)?)?;
        if !r["geometry"].is_null() {
            net.load_geometry(&file(&r["geometry"])?)?;
        }
    }

    let mut feeds: [(Vec<FeedEntity>, Vec<FeedEntity>); 2] = Default::default();
    let today = madrid_day(now);
    for (ri, region) in net.regions.iter().enumerate() {
        let ld = region.tt.region == "ld";
        for (ti, trip) in region.tt.trips.iter().enumerate() {
            let tref = TripRef {
                region: ri as u16,
                trip: ti as u32,
            };
            let st = net.schedule(tref);
            let dur = i64::from(st.last().map_or(0, |s| s.arrival));
            for day in [today - 1, today] {
                let bit = day - i64::from(region.tt.header.window_start_day);
                if !(0..16).contains(&bit) || trip.days & (1 << bit) == 0 {
                    continue;
                }
                let start = service_day_base(day) + i64::from(trip.start);
                // Deterministic pseudo-random delay: mostly on time, some late.
                let h = trip
                    .id_rest
                    .bytes()
                    .fold(7u32, |a, b| a.wrapping_mul(31) ^ u32::from(b));
                let delay = match h % 10 {
                    0..=5 => (h % 4) as i64 * 60,
                    6..=8 => 300 + (h % 9) as i64 * 60,
                    _ => 900 + (h % 30) as i64 * 60,
                };
                let rel = now - start - delay;
                if rel < 0 || rel > dur {
                    continue;
                }
                let d = dist_at(st, rel as f64);
                let Some((p, bearing)) = net.point_at(tref, d) else {
                    continue;
                };
                let id = region.tt.trip_id(trip);
                let number = train_number(trip);
                let route = &region.tt.routes[trip.route as usize];
                let label = if ld {
                    format!("{number:0>5}")
                } else {
                    format!("{}-{number}-PLATF.({})", route.short_name, h % 6 + 1)
                };
                let trip_desc = TripDescriptor {
                    trip_id: Some(id.clone()),
                    ..Default::default()
                };
                let f = &mut feeds[usize::from(!ld)];
                f.0.push(FeedEntity {
                    id: Some(format!("VP_{label}")),
                    vehicle: Some(VehiclePosition {
                        trip: Some(trip_desc.clone()),
                        position: Some(Position {
                            latitude: p.lat as f32,
                            longitude: p.lon as f32,
                            bearing,
                            ..Default::default()
                        }),
                        // AV/LD/MD positions carry no timestamp, like Renfe's.
                        timestamp: (!ld).then_some(now as u64 - 10),
                        vehicle: Some(VehicleDescriptor {
                            id: Some(number.clone()),
                            label: Some(label),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
                f.1.push(FeedEntity {
                    id: Some(format!("TUUPDATE_{id}")),
                    trip_update: Some(TripUpdate {
                        trip: Some(trip_desc),
                        delay: Some(delay as i32),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
            }
        }
    }
    let header = || {
        Some(FeedHeader {
            gtfs_realtime_version: Some("2.0".into()),
            timestamp: Some(now as u64),
            ..Default::default()
        })
    };
    let write = |name: &str, entity: Vec<FeedEntity>| {
        let n = entity.len();
        let msg = FeedMessage {
            header: header(),
            entity,
        };
        std::fs::write(out.join(name), msg.encode_to_vec()).map(|()| n)
    };
    let [(ld_vp, ld_tu), (cer_vp, cer_tu)] = feeds;
    println!(
        "vehicles: {} AV/LD/MD, {} Cercanías",
        write("vehicle_positions_LD.pb", ld_vp)?,
        write("vehicle_positions.pb", cer_vp)?
    );
    write("trip_updates_LD.pb", ld_tu)?;
    write("trip_updates.pb", cer_tu)?;
    // Two sample notices in Renfe's style: one for line C3 naming Pinto,
    // one without lines.
    let text = |s: &str| {
        Some(TranslatedString {
            translation: vec![Translation {
                text: Some(s.into()),
                language: Some("es".into()),
            }],
        })
    };
    let alerts = vec![
        FeedEntity {
            id: Some("AVISO_DEMO1".into()),
            alert: Some(Alert {
                active_period: vec![TimeRange {
                    start: Some(now as u64 - 3 * 86_400),
                    end: None,
                }],
                informed_entity: vec![
                    EntitySelector {
                        route_id: Some("10T0001C3".into()),
                        ..Default::default()
                    },
                    EntitySelector {
                        stop_id: Some("35600".into()),
                        ..Default::default()
                    },
                ],
                description_text: text(
                    "#MadC3 Por obras en la estación de Pinto, los trenes no efectúan parada en la vía 2.",
                ),
                ..Default::default()
            }),
            ..Default::default()
        },
        FeedEntity {
            id: Some("AVISO_DEMO2".into()),
            alert: Some(Alert {
                active_period: vec![TimeRange {
                    start: Some(now as u64 - 3_600),
                    end: Some(now as u64 + 3_600),
                }],
                description_text: text("Aviso de prueba sin línea."),
                ..Default::default()
            }),
            ..Default::default()
        },
    ];
    write("alerts.pb", alerts)?;
    Ok(())
}
