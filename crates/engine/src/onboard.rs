//! "Am I on this train?": compare the user's recent positions and speed with
//! the trains around them. Never assumes: it needs several fixes over at
//! least 30 s while moving, and reports a confidence, not a certainty.
//!
//! Location samples stay in memory only and are dropped after the window,
//! or immediately with [`Onboard::clear`].

use crate::live::Live;
use crate::network::Network;
use std::collections::VecDeque;
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;

/// Only the last this-many seconds of samples are used (and kept).
pub const WINDOW_SECS: i64 = 90;
pub const MIN_SPAN_SECS: i64 = 30;
pub const MIN_SAMPLES: usize = 3;
/// Below ~15 km/h we can't tell a train from a platform or a street.
pub const MIN_SPEED_MS: f64 = 4.0;
/// Trains further than this from a fix aren't candidates for it.
pub const SEARCH_RADIUS_M: f64 = 3_000.0;

/// Median speed (m/s) over consecutive points at least 5 s apart. Robust to
/// a single bad fix (e.g. a coarse first fix), unlike first-to-last.
fn median_speed(points: impl Iterator<Item = (i64, LatLon)>) -> f64 {
    let pts: Vec<(i64, LatLon)> = points.collect();
    let mut speeds = Vec::new();
    let mut prev = match pts.first() {
        Some(&p) => p,
        None => return 0.0,
    };
    for &(t, p) in &pts[1..] {
        if t - prev.0 >= 5 {
            speeds.push(haversine_m(prev.1, p) / (t - prev.0) as f64);
            prev = (t, p);
        }
    }
    if speeds.is_empty() {
        return 0.0;
    }
    speeds.sort_by(f64::total_cmp);
    speeds[speeds.len() / 2]
}

#[derive(Debug, Clone, PartialEq)]
pub struct Sample {
    pub t: i64,
    pub p: LatLon,
    pub accuracy_m: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct Seen {
    trip_id: String,
    number: String,
    coord: LatLon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Not enough fixes yet.
    Collecting,
    /// The user isn't moving fast enough to tell.
    Stationary,
    /// No train moves with the user.
    NoMatch,
    /// One train fits.
    Match,
    /// Several trains fit about equally well.
    Ambiguous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Confidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub trip_id: String,
    pub number: String,
    pub median_m: f64,
    pub speed_diff_ms: f64,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub status: Status,
    pub samples: usize,
    pub span_secs: i64,
    pub user_speed_ms: Option<f64>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Default)]
pub struct Onboard {
    samples: VecDeque<(Sample, Vec<Seen>)>,
}

impl Onboard {
    pub fn clear(&mut self) {
        self.samples.clear();
    }

    /// Record a location fix and which trains were near it at that moment.
    pub fn add(&mut self, net: &Network, live: &Live, s: Sample) {
        let radius = SEARCH_RADIUS_M + s.accuracy_m;
        let seen = live
            .views(net, s.t, false)
            .into_iter()
            .filter(|v| haversine_m(v.coord, s.p) <= radius)
            .map(|v| {
                let t = &live.trains[v.index];
                Seen {
                    trip_id: t.rt.trip_id.clone(),
                    number: t.rt.train_number.clone(),
                    coord: v.coord,
                }
            })
            .collect();
        self.samples.push_back((s, seen));
        let newest = self.samples.back().map_or(0, |x| x.0.t);
        while self
            .samples
            .front()
            .is_some_and(|x| newest - x.0.t > WINDOW_SECS)
        {
            self.samples.pop_front();
        }
    }

    pub fn verdict(&self) -> Verdict {
        let n = self.samples.len();
        let (first, last) = match (self.samples.front(), self.samples.back()) {
            (Some(f), Some(l)) => (&f.0, &l.0),
            _ => {
                return Verdict {
                    status: Status::Collecting,
                    samples: 0,
                    span_secs: 0,
                    user_speed_ms: None,
                    candidates: vec![],
                };
            }
        };
        let span = last.t - first.t;
        let mut v = Verdict {
            status: Status::Collecting,
            samples: n,
            span_secs: span,
            user_speed_ms: None,
            candidates: vec![],
        };
        if n < MIN_SAMPLES || span < MIN_SPAN_SECS {
            return v;
        }
        let user_speed = median_speed(self.samples.iter().map(|x| (x.0.t, x.0.p)));
        v.user_speed_ms = Some(user_speed);
        if user_speed < MIN_SPEED_MS {
            v.status = Status::Stationary;
            return v;
        }

        let mut accs: Vec<f64> = self.samples.iter().map(|x| x.0.accuracy_m).collect();
        accs.sort_by(f64::total_cmp);
        let tolerance = (2.0 * accs[accs.len() / 2]).max(300.0);

        // Every train seen near any fix.
        let mut keys: Vec<(&str, &str)> = self
            .samples
            .iter()
            .flat_map(|x| x.1.iter().map(|s| (s.trip_id.as_str(), s.number.as_str())))
            .collect();
        keys.sort_unstable();
        keys.dedup();

        let mut fits = Vec::new();
        for (trip_id, number) in keys {
            let track: Vec<(i64, LatLon, f64)> = self
                .samples
                .iter()
                .filter_map(|(s, seen)| {
                    let x = seen
                        .iter()
                        .find(|x| x.trip_id == trip_id && x.number == number)?;
                    Some((s.t, x.coord, haversine_m(s.p, x.coord)))
                })
                .collect();
            if (track.len() as f64) < 0.8 * n as f64 || track.len() < 2 {
                continue;
            }
            let mut d: Vec<f64> = track.iter().map(|x| x.2).collect();
            d.sort_by(f64::total_cmp);
            let median = d[d.len() / 2];
            let train_speed = median_speed(track.iter().map(|x| (x.0, x.1)));
            let speed_diff = (train_speed - user_speed).abs();
            if median <= tolerance && speed_diff <= (0.35 * user_speed).max(3.0) {
                fits.push(Candidate {
                    trip_id: trip_id.to_owned(),
                    number: number.to_owned(),
                    median_m: median,
                    speed_diff_ms: speed_diff,
                    confidence: Confidence::Low,
                });
            }
        }
        fits.sort_by(|a, b| a.median_m.total_cmp(&b.median_m));

        let long_enough = n >= 4 && span >= 45;
        match fits.len() {
            0 => v.status = Status::NoMatch,
            1 => {
                v.status = Status::Match;
                fits[0].confidence = if long_enough {
                    Confidence::High
                } else {
                    Confidence::Medium
                };
            }
            _ => {
                // A clear winner if the next train is much further away.
                if fits[1].median_m > 2.5 * fits[0].median_m.max(50.0) {
                    v.status = Status::Match;
                    fits[0].confidence = Confidence::Medium;
                } else {
                    v.status = Status::Ambiguous;
                }
            }
        }
        v.candidates = fits;
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::tests::{local, sample_network};
    use crate::source::{FeedData, RtVehicle};

    fn vehicle(trip: &str, lat: f64, lon: f64, ts: i64) -> RtVehicle {
        RtVehicle {
            trip_id: trip.into(),
            train_number: trip.chars().filter(char::is_ascii_digit).collect(),
            line: "C3".into(),
            platform: None,
            lat,
            lon,
            bearing: None,
            speed: None,
            timestamp: Some(ts),
            stop_id: None,
            status: None,
        }
    }

    /// Train 100 runs south from A (40.40) at ~18.5 m/s (11.1 km in 10 min).
    /// Sample the user every 15 s from 08:02, with an offset in degrees.
    fn ride(dlat: f64, dlon: f64, speed_factor: f64, secs: i64) -> (Onboard, Network, Live) {
        let net = sample_network();
        let mut live = Live::default();
        let t0 = local(8, 2);
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![vehicle(
                "1004D100C3",
                40.40 - 0.1 * 120.0 / 600.0,
                -3.70,
                t0,
            )]),
            t0,
        );
        let mut ob = Onboard::default();
        for k in 0..=secs / 15 {
            let t = t0 + k * 15;
            let lat = 40.40 - 0.1 * (120.0 + speed_factor * (k * 15) as f64) / 600.0;
            ob.add(
                &net,
                &live,
                Sample {
                    t,
                    p: LatLon::new(lat + dlat, -3.70 + dlon),
                    accuracy_m: 20.0,
                },
            );
        }
        (ob, net, live)
    }

    #[test]
    fn matches_the_train_the_user_rides() {
        let (ob, _, _) = ride(0.0, 0.0005, 1.0, 60); // ~40 m beside the track
        let v = ob.verdict();
        assert_eq!(v.status, Status::Match, "{v:?}");
        assert_eq!(v.candidates[0].trip_id, "1004D100C3");
        assert_eq!(v.candidates[0].confidence, Confidence::High);
        assert!((v.user_speed_ms.unwrap() - 18.5).abs() < 1.0);
    }

    #[test]
    fn a_stray_first_fix_does_not_spoil_the_match() {
        let (mut ob, net, live) = ride(0.0, 0.0005, 1.0, 75);
        // Rebuild with a bad first fix 5 km away, 10 s before the ride.
        let rest: Vec<_> = ob.samples.drain(..).collect();
        ob.add(
            &net,
            &live,
            Sample {
                t: rest[0].0.t - 10,
                p: LatLon::new(40.40, -3.64),
                accuracy_m: 900.0,
            },
        );
        for (s, _) in rest {
            ob.add(&net, &live, s);
        }
        let v = ob.verdict();
        assert_eq!(v.status, Status::Match, "{v:?}");
        assert_eq!(v.candidates[0].trip_id, "1004D100C3");
    }

    #[test]
    fn needs_time_and_movement() {
        let (ob, _, _) = ride(0.0, 0.0, 1.0, 15);
        assert_eq!(ob.verdict().status, Status::Collecting);
        let (ob, _, _) = ride(0.0, 0.0, 0.0, 60); // standing on the platform
        assert_eq!(ob.verdict().status, Status::Stationary);
    }

    #[test]
    fn no_match_on_a_parallel_road_or_at_another_speed() {
        let (ob, _, _) = ride(0.0, 0.02, 1.0, 60); // ~1.7 km east
        assert_eq!(ob.verdict().status, Status::NoMatch);
        let (ob, _, _) = ride(0.0, 0.0, 0.4, 60); // a car going 40% as fast
        assert_eq!(ob.verdict().status, Status::NoMatch);
    }

    #[test]
    fn old_samples_expire_and_clear_forgets() {
        let (mut ob, net, live) = ride(0.0, 0.0, 1.0, 60);
        ob.add(
            &net,
            &live,
            Sample {
                t: local(8, 2) + 60 + WINDOW_SECS + 30,
                p: LatLon::new(40.0, -3.7),
                accuracy_m: 10.0,
            },
        );
        assert_eq!(ob.verdict().samples, 1);
        ob.clear();
        assert_eq!(ob.verdict().samples, 0);
    }
}
