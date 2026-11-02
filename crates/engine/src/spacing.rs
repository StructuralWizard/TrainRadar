//! Spacing to the previous and following train on the same track.
//!
//! For train F, every other train L within reach is projected onto F's own
//! route geometry. L is *ahead* of F when it lies on F's track (within
//! [`MAX_OFF_TRACK_M`]), further along than F, and heading the same way. This
//! works whatever the stopping patterns: a non-stop AVE and a stopping one,
//! semi-direct and stopping Cercanías, AV/LD/MD and Cercanías on shared track.
//! Distances are along F's track. The time to the train ahead is when F should
//! reach L's current position (F's schedule + delay); the time to the train
//! behind is when that train should reach F's position (its schedule + delay).

use crate::live::{LiveTrain, TrainView};
use crate::network::Network;
use crate::schedule::time_window_at;
use trainradar_proto::geo::haversine_m;
use trainradar_proto::{Gap, PositionSource};

/// Furthest we look ahead or behind along a route.
pub const MAX_LOOKAHEAD_M: f64 = 400_000.0;
/// A train further than this from F's line isn't on F's track.
pub const MAX_OFF_TRACK_M: f64 = 250.0;
/// Headings must agree within this many degrees to count as the same direction.
pub const MAX_HEADING_DIFF: f32 = 60.0;

fn heading_diff(a: f32, b: f32) -> f32 {
    let d = (a - b).rem_euclid(360.0);
    d.min(360.0 - d)
}

fn label(t: &LiveTrain) -> String {
    if t.rt.trip_id.is_empty() {
        t.rt.train_number.clone()
    } else {
        t.rt.trip_id.clone()
    }
}

/// Position of train `o` measured along train `f`'s route, if `o` is on
/// `f`'s track and heading the same way.
fn along_route_of(net: &Network, f: &TrainView, ft: &LiveTrain, o: &TrainView) -> Option<f64> {
    let m = ft.matched?;
    let (d, off) = net.project(m.trip, o.coord)?;
    if off > MAX_OFF_TRACK_M {
        return None;
    }
    // Same direction: the other train's heading must follow F's line there.
    let (_, line_bearing) = net.point_at(m.trip, d)?;
    match (o.bearing, line_bearing) {
        (Some(ob), Some(lb)) if heading_diff(ob, lb) <= MAX_HEADING_DIFF => Some(d),
        _ => None,
    }
    .filter(|_| f.index != o.index)
}

fn estimated(a: &TrainView, b: &TrainView) -> PositionSource {
    if a.source == PositionSource::Gps && b.source == PositionSource::Gps {
        PositionSource::Gps
    } else {
        PositionSource::Interpolated
    }
}

/// Seconds until train `t` (view `v`) is expected at `d` metres along its trip.
fn time_to(net: &Network, t: &LiveTrain, d: f64, now: i64) -> Option<u32> {
    let m = t.matched?;
    let st = net.schedule(m.trip);
    let reach = m.start_utc as f64 + time_window_at(st, d).0 + f64::from(t.delay.unwrap_or(0));
    Some((reach - now as f64).max(0.0).round() as u32)
}

/// Gaps to the train ahead of and behind view `i`.
pub fn for_train(
    net: &Network,
    trains: &[LiveTrain],
    views: &[TrainView],
    i: usize,
    now: i64,
) -> (Option<Gap>, Option<Gap>) {
    let f = &views[i];
    let ft = &trains[f.index];
    let Some(f_along) = f.along else {
        return (None, None);
    };
    let mut ahead: Option<(f64, usize)> = None;
    let mut behind: Option<(f64, usize, f64)> = None;
    for (j, o) in views.iter().enumerate() {
        if j == i || haversine_m(f.coord, o.coord) > MAX_LOOKAHEAD_M {
            continue;
        }
        let ot = &trains[o.index];
        // Is o ahead of f, on f's track?
        if let Some(d) = along_route_of(net, f, ft, o) {
            let gap = d - f_along;
            if gap > 20.0 && gap <= MAX_LOOKAHEAD_M && ahead.is_none_or(|a| gap < a.0) {
                ahead = Some((gap, j));
            }
        }
        // Is f ahead of o, on o's track? Then o is behind f.
        if let (Some(o_along), Some(d)) = (o.along, along_route_of(net, o, ot, f)) {
            let gap = d - o_along;
            if gap > 20.0 && gap <= MAX_LOOKAHEAD_M && behind.is_none_or(|b| gap < b.0) {
                behind = Some((gap, j, d));
            }
        }
    }
    let ahead = ahead.map(|(gap, j)| Gap {
        trip_id: label(&trains[views[j].index]),
        distance_m: gap.round() as u32,
        time_secs: time_to(net, ft, f_along + gap, now).unwrap_or(0),
        source: estimated(f, &views[j]),
    });
    let behind = behind.map(|(gap, j, d)| Gap {
        trip_id: label(&trains[views[j].index]),
        distance_m: gap.round() as u32,
        time_secs: time_to(net, &trains[views[j].index], d, now).unwrap_or(0),
        source: estimated(f, &views[j]),
    });
    (ahead, behind)
}

/// Fill spacing for every train (diagnostics; the app asks per train).
pub fn fill(net: &Network, trains: &[LiveTrain], views: &mut [TrainView], now: i64) {
    let gaps: Vec<_> = (0..views.len())
        .map(|i| for_train(net, trains, views, i, now))
        .collect();
    for (v, (a, b)) in views.iter_mut().zip(gaps) {
        v.ahead = a;
        v.behind = b;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::Live;
    use crate::network::tests::{local, sample_network};
    use crate::source::{FeedData, RtVehicle};

    fn v(trip: &str, number: &str, lat: f64, ts: i64) -> RtVehicle {
        RtVehicle {
            trip_id: trip.into(),
            train_number: number.into(),
            line: "C3".into(),
            platform: None,
            lat,
            lon: -3.70,
            bearing: None,
            speed: None,
            timestamp: Some(ts),
            stop_id: None,
            status: None,
        }
    }

    fn by_trip<'a>(live: &Live, views: &'a [TrainView], trip: &str) -> &'a TrainView {
        views
            .iter()
            .find(|x| live.trains[x.index].rt.trip_id == trip)
            .unwrap()
    }

    #[test]
    fn finds_train_ahead_and_behind() {
        let net = sample_network();
        let mut live = Live::default();
        let now = local(8, 15);
        // Trip 100 (08:00) is past B at 40.25; trip 102 (08:10) is between
        // A and B at 40.35. Both southbound on the same track.
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![
                v("1004D100C3", "100", 40.25, now),
                v("1004D102C3", "102", 40.35, now),
            ]),
            now,
        );
        let views = live.views(&net, now, true);
        let t102 = by_trip(&live, &views, "1004D102C3");
        let gap = t102.ahead.as_ref().expect("102 has 100 ahead");
        assert_eq!(gap.trip_id, "1004D100C3");
        assert!(
            (10_900..11_300).contains(&gap.distance_m),
            "{}",
            gap.distance_m
        );
        assert!((500..800).contains(&gap.time_secs), "{}", gap.time_secs);
        let t100 = by_trip(&live, &views, "1004D100C3");
        assert!(t100.ahead.is_none(), "nobody ahead of the leader");
        let b = t100.behind.as_ref().expect("102 is behind 100");
        assert_eq!(b.trip_id, "1004D102C3");
        assert_eq!(b.distance_m, gap.distance_m);
        // 102 reaches 100's current spot ~11 min later.
        assert!((500..800).contains(&b.time_secs), "{}", b.time_secs);
    }

    #[test]
    fn links_trains_with_different_stopping_patterns_far_apart() {
        // Trip 190 (an AV/LD-style trip on the same pattern) 09:00, and an
        // unknown train on the same line ahead: matched by position only.
        let net = sample_network();
        let mut live = Live::default();
        let now = local(9, 5);
        let mut other = v("SPECIAL_1", "777", 40.22, now);
        other.bearing = Some(180.0); // southbound, like the line
        let mut opposite = v("SPECIAL_2", "888", 40.30, now);
        opposite.bearing = Some(0.0); // northbound: never a neighbour
        live.ingest(
            &net,
            "vp_ld",
            FeedData::Vehicles(vec![
                v("0019012026-10-31", "190", 40.36, now),
                other,
                opposite,
            ]),
            now,
        );
        let views = live.views(&net, now, true);
        let t = by_trip(&live, &views, "0019012026-10-31");
        let g = t
            .ahead
            .as_ref()
            .expect("unknown train ahead on the same track");
        assert_eq!(g.trip_id, "SPECIAL_1");
        assert!((15_000..16_000).contains(&g.distance_m), "{}", g.distance_m);
    }

    #[test]
    fn ignores_trains_off_the_track() {
        let net = sample_network();
        let mut live = Live::default();
        let now = local(8, 15);
        let mut far = v("X", "9", 40.25, now);
        far.lon = -3.60; // ~8.5 km east of the line
        far.bearing = Some(180.0);
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![v("1004D102C3", "102", 40.35, now), far]),
            now,
        );
        let views = live.views(&net, now, true);
        assert!(by_trip(&live, &views, "1004D102C3").ahead.is_none());
    }
}
