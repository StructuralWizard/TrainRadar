//! Live state: realtime records matched to trips, with delays and positions
//! interpolated between (possibly sparse) GPS fixes.

use crate::network::{Match, Network};
use crate::schedule::{advance_from_fix, delay_at, next_stop};
use crate::source::{FeedData, RtTripUpdate, RtVehicle};
use std::collections::HashMap;
use trainradar_proto::geo::haversine_m;
use trainradar_proto::{Delay, Gap, Incident, LatLon, PositionSource};

/// A GPS fix this far from the matched trip's line means the match or the
/// fix is wrong; show the raw fix and don't interpolate.
const MAX_OFF_LINE_M: f64 = 1_500.0;
/// A fix younger than this is shown as-is (labelled GPS).
const FRESH_FIX_SECS: i64 = 45;
/// Feed timestamps further than this from "now" are ignored as implausible.
const MAX_CLOCK_SKEW_SECS: i64 = 3 * 3_600;

/// Where a delay figure came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DelaySource {
    /// Renfe's trip update.
    TripUpdate,
    /// Our estimate from the GPS fix versus the timetable.
    Gps,
}

/// One train as the engine sees it after the last feed update.
#[derive(Debug, Clone)]
pub struct LiveTrain {
    pub rt: RtVehicle,
    pub feed: &'static str,
    pub matched: Option<Match>,
    /// Unix seconds of the GPS fix (feed timestamp, or when we first saw it).
    pub fix_time: i64,
    /// Metres along the trip at the fix, if the fix fits the trip's line.
    pub fix_along: Option<f64>,
    pub delay: Option<i32>,
    pub delay_source: Option<DelaySource>,
    pub canceled: bool,
}

/// A train's state at a given instant, ready to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct TrainView {
    pub index: usize,
    pub coord: LatLon,
    pub bearing: Option<f32>,
    pub delay: Option<Delay>,
    /// Metres along the trip now (for spacing), when matched.
    pub along: Option<f64>,
    pub fix_age_secs: i64,
    pub source: PositionSource,
    pub next_stop: Option<usize>,
    /// Expected arrival (unix seconds) at `next_stop`.
    pub next_arrival: Option<i64>,
    pub ahead: Option<Gap>,
    pub behind: Option<Gap>,
}

#[derive(Debug, Default)]
pub struct Live {
    vehicles: HashMap<&'static str, Vec<RtVehicle>>,
    updates: HashMap<&'static str, Vec<RtTripUpdate>>,
    pub incidents: Vec<Incident>,
    /// Vehicle key → (lat e5, lon e5, first time seen at that position).
    seen: HashMap<String, (i32, i32, i64)>,
    pub trains: Vec<LiveTrain>,
}

fn key(v: &RtVehicle) -> String {
    format!("{}|{}", v.trip_id, v.train_number)
}

impl Live {
    /// Store a decoded feed and rebuild the train list.
    pub fn ingest(&mut self, net: &Network, feed: &'static str, data: FeedData, now: i64) {
        match data {
            FeedData::Vehicles(v) => {
                for x in &v {
                    let pos = ((x.lat * 1e5) as i32, (x.lon * 1e5) as i32);
                    let e = self.seen.entry(key(x)).or_insert((pos.0, pos.1, now));
                    if (e.0, e.1) != pos {
                        *e = (pos.0, pos.1, now);
                    }
                }
                self.vehicles.insert(feed, v);
            }
            FeedData::TripUpdates(u) => {
                self.updates.insert(feed, u);
            }
            FeedData::Alerts(a) => self.incidents = a,
        }
        self.rebuild(net, now);
    }

    /// Re-match every vehicle (also call after loading a timetable).
    pub fn rebuild(&mut self, net: &Network, now: i64) {
        let updates: HashMap<&str, &RtTripUpdate> = self
            .updates
            .values()
            .flatten()
            .map(|u| (u.trip_id.as_str(), u))
            .collect();
        let live_keys: std::collections::HashSet<String> =
            self.vehicles.values().flatten().map(key).collect();
        self.seen.retain(|k, _| live_keys.contains(k));

        let mut trains = Vec::new();
        for (&feed, list) in &self.vehicles {
            for v in list {
                let fix_time = v
                    .timestamp
                    .filter(|t| (t - now).abs() <= MAX_CLOCK_SKEW_SECS)
                    .unwrap_or_else(|| self.seen.get(&key(v)).map_or(now, |s| s.2));
                let matched = net.match_trip(&v.trip_id, &v.train_number, now);
                let gps = LatLon::new(v.lat, v.lon);
                let fix_along = matched.and_then(|m| {
                    let (d, off) = net.project(m.trip, gps)?;
                    (off <= MAX_OFF_LINE_M).then_some(d)
                });
                let tu = updates.get(v.trip_id.as_str()).copied().or_else(|| {
                    let m = matched?;
                    let r = &net.regions[m.trip.region as usize];
                    updates
                        .get(r.tt.trip_id(net.trip(m.trip)).as_str())
                        .copied()
                });
                let (delay, delay_source) = match (tu.and_then(|u| u.delay), matched, fix_along) {
                    (Some(d), _, _) => (Some(d), Some(DelaySource::TripUpdate)),
                    (None, Some(m), Some(d)) => {
                        let t = (fix_time - m.start_utc) as f64;
                        let est = delay_at(net.schedule(m.trip), d, t).round() as i32;
                        (Some(est), Some(DelaySource::Gps))
                    }
                    _ => (None, None),
                };
                trains.push(LiveTrain {
                    rt: v.clone(),
                    feed,
                    matched,
                    fix_time,
                    fix_along,
                    delay,
                    delay_source,
                    canceled: tu.is_some_and(|u| u.canceled),
                });
            }
        }
        // Stable order (by train number) so indexes don't jump between updates.
        trains.sort_by(|a, b| a.rt.train_number.cmp(&b.rt.train_number));
        self.trains = trains;
    }

    /// Positions of all trains at `now`. Spacing to neighbours is optional
    /// because the map redraws every frame but only the popup needs it.
    pub fn views(&self, net: &Network, now: i64, with_spacing: bool) -> Vec<TrainView> {
        let mut out: Vec<TrainView> = self
            .trains
            .iter()
            .enumerate()
            .map(|(i, t)| view(net, i, t, now))
            .collect();
        if with_spacing {
            crate::spacing::fill(net, &self.trains, &mut out, now);
        }
        out
    }
}

fn view(net: &Network, index: usize, t: &LiveTrain, now: i64) -> TrainView {
    let gps = LatLon::new(t.rt.lat, t.rt.lon);
    let fix_age = (now - t.fix_time).max(0);
    let raw = TrainView {
        index,
        coord: gps,
        bearing: t.rt.bearing,
        delay: t.delay.map(Delay),
        along: None,
        fix_age_secs: fix_age,
        source: PositionSource::Gps,
        next_stop: None,
        next_arrival: None,
        ahead: None,
        behind: None,
    };
    let (Some(m), Some(fix_d)) = (t.matched, t.fix_along) else {
        return raw;
    };
    let st = net.schedule(m.trip);
    let delay = f64::from(t.delay.unwrap_or(0));
    let rel = |x: i64| (x - m.start_utc) as f64;
    let along = advance_from_fix(st, fix_d, rel(t.fix_time), rel(now), delay);
    let Some((coord, bearing)) = net.point_at(m.trip, along) else {
        return raw;
    };
    let next = next_stop(st, along);
    // Show the GPS fix itself while it's fresh and the train hasn't moved on.
    let fresh = fix_age <= FRESH_FIX_SECS && (along - fix_d).abs() < 50.0;
    TrainView {
        coord: if fresh && haversine_m(gps, coord) < 200.0 {
            gps
        } else {
            coord
        },
        bearing: t.rt.bearing.or(bearing),
        along: Some(along),
        source: if fresh {
            PositionSource::Gps
        } else {
            PositionSource::Interpolated
        },
        next_stop: next,
        next_arrival: next.map(|i| m.start_utc + i64::from(st[i].arrival) + delay as i64),
        ..raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::tests::{local, sample_network};

    fn vehicle(trip: &str, lat: f64, ts: Option<i64>) -> RtVehicle {
        RtVehicle {
            trip_id: trip.into(),
            train_number: trip.chars().filter(char::is_ascii_digit).collect(),
            line: "C3".into(),
            platform: None,
            lat,
            lon: -3.70,
            bearing: None,
            speed: None,
            timestamp: ts,
            stop_id: None,
            status: None,
        }
    }

    #[test]
    fn gps_delay_and_interpolation_between_fixes() {
        let net = sample_network();
        let mut live = Live::default();
        // 08:07: train 100 is only halfway A→B (~5.6 km): scheduled for 08:05,
        // so 2 min late.
        let fix = local(8, 7);
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![vehicle("1004D100C3", 40.35, Some(fix))]),
            fix,
        );
        let t = &live.trains[0];
        assert_eq!(t.delay_source, Some(DelaySource::Gps));
        assert!((t.delay.unwrap() - 120).abs() <= 5, "{:?}", t.delay);

        // 08:13 with no new fix: interpolated to B (scheduled 08:10–08:11
        // +2 min = dwelling at B until 08:13).
        let v = &live.views(&net, local(8, 13), false)[0];
        assert_eq!(v.source, PositionSource::Interpolated);
        assert_eq!(v.fix_age_secs, 360);
        assert!((v.coord.lat - 40.30).abs() < 2e-3, "{:?}", v.coord);
        assert_eq!(v.next_stop, Some(2));
        assert_eq!(v.next_arrival, Some(local(8, 21) + 120));
    }

    #[test]
    fn trip_update_delay_wins_and_fix_age_from_first_sight() {
        let net = sample_network();
        let mut live = Live::default();
        let now = local(8, 5);
        live.ingest(
            &net,
            "tu_cer",
            FeedData::TripUpdates(vec![RtTripUpdate {
                trip_id: "1004D100C3".into(),
                delay: Some(300),
                canceled: false,
                stops: vec![],
            }]),
            now,
        );
        // No timestamp in the feed (like AV/LD/MD): age counts from first sight.
        let vp = || FeedData::Vehicles(vec![vehicle("1004D100C3", 40.38, None)]);
        live.ingest(&net, "vp_cer", vp(), now);
        live.ingest(&net, "vp_cer", vp(), now + 60);
        let t = &live.trains[0];
        assert_eq!(t.delay, Some(300));
        assert_eq!(t.delay_source, Some(DelaySource::TripUpdate));
        assert_eq!(t.fix_time, now, "same position: still the old fix");
        assert_eq!(live.views(&net, now + 90, false)[0].fix_age_secs, 90);
    }

    #[test]
    fn unmatched_trains_stay_at_raw_gps() {
        let net = sample_network();
        let mut live = Live::default();
        let now = local(8, 5);
        live.ingest(
            &net,
            "vp_ld",
            FeedData::Vehicles(vec![vehicle("unknown", 41.0, Some(now - 30))]),
            now,
        );
        let v = &live.views(&net, now, false)[0];
        assert!(live.trains[0].matched.is_none());
        assert_eq!(v.coord, LatLon::new(41.0, -3.70));
        assert_eq!(v.delay, None);
        assert_eq!(v.fix_age_secs, 30);
    }
}
