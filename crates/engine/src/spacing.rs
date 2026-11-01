//! Spacing to the previous and following train on the same line.
//!
//! Train L is ahead of train F when the track segment L is on (previous stop →
//! next stop, as global station ids) also appears in F's remaining route, in
//! the same direction. That links trains on different lines sharing a trunk
//! section (and AV/LD/MD with Cercanías on shared track), and ignores trains
//! going the other way. Distances are along F's track; the time gap is when F
//! is expected to reach L's current position (schedule + F's delay).

use crate::live::{LiveTrain, TrainView};
use crate::network::Network;
use crate::schedule::{prev_stop, time_window_at};
use std::collections::HashMap;
use trainradar_proto::{Gap, PositionSource};

/// Don't look further ahead than this along a train's route.
pub const MAX_LOOKAHEAD_M: f64 = 150_000.0;

struct OnSegment {
    view: usize,
    /// Fraction of the way along the segment, 0..1.
    frac: f64,
}

pub fn fill(net: &Network, trains: &[LiveTrain], views: &mut [TrainView], now: i64) {
    // Per train: its stop gids, schedule and current segment.
    struct Placed {
        gids: Vec<u32>,
        seg: usize,
        frac: f64,
    }
    let mut placed: Vec<Option<Placed>> = Vec::with_capacity(views.len());
    let mut by_segment: HashMap<(u32, u32), Vec<OnSegment>> = HashMap::new();
    for (i, v) in views.iter().enumerate() {
        let p = (|| {
            let m = trains[v.index].matched?;
            let along = v.along?;
            let st = net.schedule(m.trip);
            let seg = prev_stop(st, along);
            if seg + 1 >= st.len() {
                return None; // at the terminus
            }
            let (a, b) = (f64::from(st[seg].dist_m), f64::from(st[seg + 1].dist_m));
            let frac = if b > a {
                ((along - a) / (b - a)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let gids: Vec<u32> = net.stop_gids(m.trip).collect();
            by_segment
                .entry((gids[seg], gids[seg + 1]))
                .or_default()
                .push(OnSegment { view: i, frac });
            Some(Placed { gids, seg, frac })
        })();
        placed.push(p);
    }

    let mut ahead: Vec<Option<(usize, Gap)>> = vec![None; views.len()];
    for (fi, p) in placed.iter().enumerate() {
        let Some(p) = p else { continue };
        let ftrain = &trains[views[fi].index];
        let m = ftrain.matched.expect("placed implies matched");
        let st = net.schedule(m.trip);
        let along = views[fi].along.expect("placed implies along");
        for j in p.seg..p.gids.len() - 1 {
            let (a, b) = (f64::from(st[j].dist_m), f64::from(st[j + 1].dist_m));
            if a - along > MAX_LOOKAHEAD_M {
                break;
            }
            let Some(list) = by_segment.get(&(p.gids[j], p.gids[j + 1])) else {
                continue;
            };
            let best = list
                .iter()
                .filter(|o| o.view != fi && (j > p.seg || o.frac > p.frac))
                .min_by(|x, y| x.frac.total_cmp(&y.frac));
            if let Some(o) = best {
                let at = a + o.frac * (b - a);
                let delay = f64::from(ftrain.delay.unwrap_or(0));
                let reach = m.start_utc as f64 + time_window_at(st, at).0 + delay;
                let estimated = views[fi].source != PositionSource::Gps
                    || views[o.view].source != PositionSource::Gps;
                let rt = &trains[views[o.view].index].rt;
                ahead[fi] = Some((
                    o.view,
                    Gap {
                        trip_id: if rt.trip_id.is_empty() {
                            rt.train_number.clone()
                        } else {
                            rt.trip_id.clone()
                        },
                        distance_m: (at - along).max(0.0).round() as u32,
                        time_secs: (reach - now as f64).max(0.0).round() as u32,
                        source: if estimated {
                            PositionSource::Interpolated
                        } else {
                            PositionSource::Gps
                        },
                    },
                ));
                break;
            }
        }
    }

    // The follower nearest behind each train is its "behind" neighbour.
    for (fi, a) in ahead.iter().enumerate() {
        let Some((li, gap)) = a else { continue };
        let rt = &trains[views[fi].index].rt;
        let behind = Gap {
            trip_id: if rt.trip_id.is_empty() {
                rt.train_number.clone()
            } else {
                rt.trip_id.clone()
            },
            ..gap.clone()
        };
        let slot = &mut views[*li].behind;
        if slot
            .as_ref()
            .is_none_or(|g| behind.distance_m < g.distance_m)
        {
            *slot = Some(behind);
        }
        views[fi].ahead = Some(gap.clone());
    }
}

#[cfg(test)]
mod tests {
    use crate::live::Live;
    use crate::network::tests::{local, sample_network};
    use crate::source::{FeedData, RtVehicle};

    fn v(trip: &str, lat: f64, ts: i64) -> RtVehicle {
        RtVehicle {
            trip_id: trip.into(),
            train_number: String::new(),
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

    #[test]
    fn finds_train_ahead_and_behind() {
        let net = sample_network();
        let mut live = Live::default();
        let now = local(8, 15);
        // Trip 100 (08:00) is past B at 40.25; trip 102 (08:10) is between
        // A and B at 40.35. Both on time-ish, fresh fixes.
        live.ingest(
            &net,
            "vp_cer",
            FeedData::Vehicles(vec![
                v("1004D100C3", 40.25, now),
                v("1004D102C3", 40.35, now),
            ]),
            now,
        );
        let views = live.views(&net, now, true);
        let i100 = views
            .iter()
            .position(|x| live.trains[x.index].rt.trip_id == "1004D100C3")
            .unwrap();
        let i102 = 1 - i100;
        let gap = views[i102].ahead.as_ref().expect("102 has 100 ahead");
        assert_eq!(gap.trip_id, "1004D100C3");
        // 40.35 → 40.25 is ~11.1 km along the line.
        assert!(
            (10_900..11_300).contains(&gap.distance_m),
            "{}",
            gap.distance_m
        );
        // 102 reaches 40.25 about 10 min (+ dwell) after 08:15 at its pace.
        assert!((500..800).contains(&gap.time_secs), "{}", gap.time_secs);
        assert!(views[i100].ahead.is_none(), "nobody ahead of the leader");
        assert_eq!(
            views[i100].behind.as_ref().map(|g| g.trip_id.as_str()),
            Some("1004D102C3")
        );
    }
}
