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
    /// Since when (unix s) the GPS position hasn't changed.
    pub still_since: i64,
    /// Latest fix time at the current position (feed timestamps only).
    pub last_fix: i64,
    /// Speed measured between the last two different fixes, m/s.
    pub measured_speed: Option<f32>,
    /// Wheelchair accessible, if Renfe says.
    pub accessible: Option<bool>,
    /// No live data: placed by timetable (operators that publish none).
    pub scheduled: bool,
}

/// Same train listed more than once (the AV/LD/MD feed lists some trains
/// once per timetable variant): same number, within this distance.
const DUPLICATE_RADIUS_M: f64 = 500.0;

/// Keep one entry per physical train: the best-matched one.
fn dedupe(mut trains: Vec<LiveTrain>) -> Vec<LiveTrain> {
    let rank = |t: &LiveTrain| {
        (
            t.matched.is_some_and(|m| m.exact),
            t.matched.is_some(),
            t.delay_source == Some(DelaySource::TripUpdate),
            t.fix_along.is_some(),
        )
    };
    // Best first within each number, so the first kept wins.
    trains.sort_by(|a, b| {
        (a.feed, &a.rt.train_number)
            .cmp(&(b.feed, &b.rt.train_number))
            .then_with(|| rank(b).cmp(&rank(a)))
    });
    let mut kept: Vec<LiveTrain> = Vec::with_capacity(trains.len());
    for t in trains {
        let dup = !t.rt.train_number.is_empty()
            && kept
                .iter()
                .rev()
                .take_while(|k| k.feed == t.feed && k.rt.train_number == t.rt.train_number)
                .any(|k| {
                    haversine_m(
                        LatLon::new(k.rt.lat, k.rt.lon),
                        LatLon::new(t.rt.lat, t.rt.lon),
                    ) <= DUPLICATE_RADIUS_M
                });
        if !dup {
            kept.push(t);
        }
    }
    // Stable order (by train number) so indexes don't jump between updates.
    kept.sort_by(|a, b| {
        a.rt.train_number
            .cmp(&b.rt.train_number)
            .then(a.feed.cmp(b.feed))
    });
    kept
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
    /// Stopped between stations: since when (unix s), and whether that's
    /// confirmed by fresh timestamped fixes (Cercanías) or only likely.
    pub stopped: Option<Stopped>,
    /// Speed in km/h, and whether measured from GPS (else from the timetable).
    pub speed: Option<(f32, bool)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stopped {
    pub since: i64,
    pub confirmed: bool,
    /// Index of the last stop passed (the train is between it and the next).
    pub after_stop: usize,
}

/// Stopped this long away from a station counts as "stopped between stations".
pub const STOPPED_CONFIRMED_SECS: i64 = 180;
/// Without timestamps (AV/LD/MD), require longer: the GPS may just be silent.
pub const STOPPED_LIKELY_SECS: i64 = 300;
/// Further than this from any stop counts as "between stations".
pub const AWAY_FROM_STOP_M: f64 = 400.0;

#[derive(Debug, Default)]
pub struct Live {
    vehicles: HashMap<&'static str, Vec<RtVehicle>>,
    updates: HashMap<&'static str, Vec<RtTripUpdate>>,
    pub incidents: Vec<Incident>,
    /// Vehicle key → position history (for fix age, stops and speed).
    seen: HashMap<String, Seen>,
    pub trains: Vec<LiveTrain>,
    /// Time of the last ingest/rebuild (unix seconds).
    pub now: i64,
}

/// Trains of timetable-only operators (no live feed) that should be running
/// now, placed by their timetable.
fn scheduled_trains(net: &Network, now: i64) -> Vec<LiveTrain> {
    use trainradar_proto::time::{madrid_day, service_day_base};
    let today = madrid_day(now);
    let mut out = Vec::new();
    for (ri, r) in net.regions.iter().enumerate() {
        if r.tt.live {
            continue;
        }
        for (ti, trip) in r.tt.trips.iter().enumerate() {
            let tref = crate::network::TripRef {
                region: ri as u16,
                trip: ti as u32,
            };
            let st = net.schedule(tref);
            let dur = st.last().map_or(0, |s| i64::from(s.arrival));
            for day in [today - 1, today] {
                let bit = day - i64::from(r.tt.header.window_start_day);
                if !(0..16).contains(&bit) || trip.days & (1 << bit) == 0 {
                    continue;
                }
                let start = service_day_base(day) + i64::from(trip.start);
                if now < start || now > start + dur {
                    continue;
                }
                let first =
                    r.tt.stops[r.tt.patterns[trip.pattern as usize].stops[0] as usize].coord();
                out.push(LiveTrain {
                    rt: RtVehicle {
                        trip_id: r.tt.trip_id(trip),
                        train_number: crate::network::train_number(trip),
                        line: r.tt.routes[trip.route as usize].short_name.clone(),
                        platform: None,
                        lat: first.lat,
                        lon: first.lon,
                        bearing: None,
                        speed: None,
                        timestamp: None,
                        stop_id: None,
                        status: None,
                    },
                    feed: "timetable",
                    matched: Some(Match {
                        trip: tref,
                        day,
                        start_utc: start,
                        exact: true,
                    }),
                    fix_time: now,
                    fix_along: Some(0.0),
                    delay: None,
                    delay_source: None,
                    canceled: false,
                    still_since: now,
                    last_fix: now,
                    measured_speed: None,
                    accessible: None,
                    scheduled: true,
                });
            }
        }
    }
    out
}

/// What we remember about one vehicle's recent positions.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Seen {
    lat: i32,
    lon: i32,
    /// First fix time at this position.
    since: i64,
    /// Latest fix time at this position.
    last: i64,
    /// Previous different position and its last fix time.
    prev: Option<(i32, i32, i64)>,
}

impl Seen {
    fn speed(&self) -> Option<f32> {
        let (plat, plon, pt) = self.prev?;
        let dt = self.since - pt;
        if !(5..=300).contains(&dt) {
            return None;
        }
        let a = LatLon::new(f64::from(plat) / 1e5, f64::from(plon) / 1e5);
        let b = LatLon::new(f64::from(self.lat) / 1e5, f64::from(self.lon) / 1e5);
        Some((haversine_m(a, b) / dt as f64) as f32)
    }
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
                    let (lat, lon) = ((x.lat * 1e5) as i32, (x.lon * 1e5) as i32);
                    let ft = x
                        .timestamp
                        .filter(|t| (t - now).abs() <= MAX_CLOCK_SKEW_SECS)
                        .unwrap_or(now);
                    let fresh = Seen {
                        lat,
                        lon,
                        since: ft,
                        last: ft,
                        prev: None,
                    };
                    let e = self.seen.entry(key(x)).or_insert(fresh);
                    if (e.lat, e.lon) == (lat, lon) {
                        e.last = e.last.max(ft);
                    } else {
                        *e = Seen {
                            prev: Some((e.lat, e.lon, e.last)),
                            ..fresh
                        };
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

    /// Renfe's latest trip update for a GTFS trip id, if any.
    pub fn trip_update(&self, trip_id: &str) -> Option<&RtTripUpdate> {
        self.updates
            .values()
            .flatten()
            .find(|u| u.trip_id == trip_id)
    }

    /// Re-match every vehicle (also call after loading a timetable).
    pub fn rebuild(&mut self, net: &Network, now: i64) {
        self.now = now;
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
                let seen = self.seen.get(&key(v)).copied();
                let fix_time = v
                    .timestamp
                    .filter(|t| (t - now).abs() <= MAX_CLOCK_SKEW_SECS)
                    .unwrap_or_else(|| seen.map_or(now, |s| s.since));
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
                    still_since: seen.map_or(fix_time, |s| s.since),
                    last_fix: seen.map_or(fix_time, |s| s.last),
                    measured_speed: seen.and_then(|s| s.speed()),
                    accessible: tu.and_then(|u| u.accessible),
                    scheduled: false,
                });
            }
        }
        let mut trains = dedupe(trains);
        trains.extend(scheduled_trains(net, now));
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
        stopped: None,
        speed: None,
    };
    let (Some(m), Some(fix_d)) = (t.matched, t.fix_along) else {
        return raw;
    };
    let st = net.schedule(m.trip);
    let delay = f64::from(t.delay.unwrap_or(0));
    let rel = |x: i64| (x - m.start_utc) as f64;
    if t.scheduled {
        let along = crate::schedule::dist_at(st, rel(now));
        let Some((coord, bearing)) = net.point_at(m.trip, along) else {
            return raw;
        };
        let next = next_stop(st, along);
        return TrainView {
            coord,
            bearing,
            along: Some(along),
            fix_age_secs: 0,
            source: PositionSource::Scheduled,
            next_stop: next,
            next_arrival: next.map(|i| m.start_utc + i64::from(st[i].arrival)),
            speed: crate::schedule::scheduled_speed(st, rel(now))
                .map(|ms| (ms as f32 * 3.6, false)),
            ..raw
        };
    }

    // Stopped between stations? Confirmed when fresh timestamped fixes keep
    // reporting the same spot; likely when an untimestamped one hasn't moved.
    let total = st.last().map_or(0.0, |s| f64::from(s.dist_m));
    let between = fix_d > AWAY_FROM_STOP_M
        && fix_d < total - AWAY_FROM_STOP_M
        && st
            .iter()
            .all(|s| (f64::from(s.dist_m) - fix_d).abs() > AWAY_FROM_STOP_M);
    let timestamped = t.rt.timestamp.is_some();
    let confirmed = timestamped
        && now - t.last_fix <= 90
        && t.last_fix - t.still_since >= STOPPED_CONFIRMED_SECS;
    let likely = !timestamped && now - t.still_since >= STOPPED_LIKELY_SECS;
    let stopped = (between && (confirmed || likely)).then(|| Stopped {
        since: t.still_since,
        confirmed,
        after_stop: crate::schedule::prev_stop(st, fix_d),
    });

    // A confirmed stop holds the train where it is; otherwise it moves on
    // with the timetable from the last fix.
    let along = if confirmed {
        fix_d
    } else {
        advance_from_fix(st, fix_d, rel(t.fix_time), rel(now), delay)
    };
    let speed = if confirmed {
        Some((0.0, true))
    } else if let Some(ms) = t.measured_speed.filter(|_| now - t.still_since <= 120) {
        Some((ms * 3.6, true))
    } else {
        crate::schedule::scheduled_speed(st, rel(now) - delay).map(|ms| (ms as f32 * 3.6, false))
    };
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
        stopped,
        speed,
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
                accessible: None,
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
    fn merges_duplicate_listings_of_one_train() {
        let net = sample_network();
        let mut live = Live::default();
        let now = local(8, 5);
        let mut a = vehicle("0019052026-11-01", 40.38, Some(now)); // unknown variant id
        a.train_number = "00190".into();
        let mut b = vehicle("1004D100C3", 40.3801, Some(now)); // exact id, same number
        b.train_number = "00190".into();
        let mut far = vehicle("x", 41.5, Some(now)); // same number, elsewhere
        far.train_number = "00190".into();
        live.ingest(&net, "vp_ld", FeedData::Vehicles(vec![a, b, far]), now);
        assert_eq!(live.trains.len(), 2);
        assert!(live.trains.iter().any(|t| t.rt.trip_id == "1004D100C3"));
        assert!(
            live.trains
                .iter()
                .all(|t| t.rt.trip_id != "0019052026-11-01")
        );
    }

    #[test]
    fn detects_trains_stopped_between_stations() {
        let net = sample_network();
        let t0 = local(8, 5);
        // Cercanías (timestamped): same spot between A and B for 4 minutes.
        let mut live = Live::default();
        for k in 0..=4 {
            let t = t0 + k * 60;
            live.ingest(
                &net,
                "vp_cer",
                FeedData::Vehicles(vec![vehicle("1004D100C3", 40.35, Some(t))]),
                t,
            );
        }
        let v = &live.views(&net, t0 + 240, false)[0];
        let s = v.stopped.expect("stopped");
        assert!(s.confirmed);
        assert_eq!(s.since, t0);
        assert_eq!(s.after_stop, 0, "between A and B");
        assert_eq!(v.speed, Some((0.0, true)));
        assert!(
            (v.coord.lat - 40.35).abs() < 1e-3,
            "held at the fix, not moved on"
        );

        // At a station it's a normal stop, not "between stations".
        let mut live = Live::default();
        for k in 0..=4 {
            let t = t0 + k * 60;
            live.ingest(
                &net,
                "vp_cer",
                FeedData::Vehicles(vec![vehicle("1004D100C3", 40.30, Some(t))]),
                t,
            );
        }
        assert!(live.views(&net, t0 + 240, false)[0].stopped.is_none());

        // AV/LD/MD-style (no timestamps): likely after 5 minutes unchanged.
        let mut live = Live::default();
        for k in 0..=6 {
            let t = t0 + k * 60;
            live.ingest(
                &net,
                "vp_ld",
                FeedData::Vehicles(vec![vehicle("1004D100C3", 40.35, None)]),
                t,
            );
        }
        let s = live.views(&net, t0 + 360, false)[0]
            .stopped
            .expect("likely stopped");
        assert!(!s.confirmed);
    }

    #[test]
    fn measures_speed_between_fixes() {
        let net = sample_network();
        let mut live = Live::default();
        let t0 = local(8, 3);
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![vehicle("1004D100C3", 40.38, Some(t0))]),
            t0,
        );
        // 0.01° of latitude (~1112 m) in 60 s ≈ 66.7 km/h.
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![vehicle("1004D100C3", 40.37, Some(t0 + 60))]),
            t0 + 60,
        );
        let (kmh, measured) = live.views(&net, t0 + 70, false)[0].speed.unwrap();
        assert!(measured);
        assert!((kmh - 66.7).abs() < 1.0, "{kmh}");
    }

    #[test]
    fn timetable_only_operators_are_placed_by_timetable() {
        use crate::network::tests::sample_timetable;
        let mut tt = sample_timetable();
        tt.live = false;
        tt.operator = "OUIGO".into();
        let mut net = crate::network::Network::default();
        net.load_timetable(&trainradar_proto::encode(&tt).unwrap())
            .unwrap();
        let mut live = Live::default();
        let now = local(8, 5); // trip 100 halfway A→B, trip 102 not started
        live.rebuild(&net, now);
        let views = live.views(&net, now, false);
        assert_eq!(views.len(), 1);
        let v = &views[0];
        assert_eq!(v.source, PositionSource::Scheduled);
        assert_eq!(v.delay, None);
        assert!((v.coord.lat - 40.35).abs() < 2e-3, "{:?}", v.coord);
        assert_eq!(live.trains[0].rt.trip_id, "1004D100C3");
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
