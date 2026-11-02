//! Where a train should be at a given time, and when it should be at a given
//! place, from a trip pattern's stop times and distances.
//!
//! All times here are seconds relative to the trip's first arrival; callers
//! add the service-day base, the trip start and the current delay.

use trainradar_proto::refdata::StopTime;

/// Distance along the trip (metres from the first stop) at relative time `t`.
/// Trains wait at stops between arrival and departure and move at constant
/// speed between stops.
pub fn dist_at(st: &[StopTime], t: f64) -> f64 {
    let Some(first) = st.first() else {
        return 0.0;
    };
    if t <= f64::from(first.departure) {
        return f64::from(first.dist_m);
    }
    for w in st.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        let (dep, arr) = (f64::from(a.departure), f64::from(b.arrival));
        if t < arr {
            let f = if arr > dep {
                (t - dep) / (arr - dep)
            } else {
                1.0
            };
            return f64::from(a.dist_m) + f * f64::from(b.dist_m - a.dist_m);
        }
        if t <= f64::from(b.departure) {
            return f64::from(b.dist_m);
        }
    }
    f64::from(st[st.len() - 1].dist_m)
}

/// Relative time window when the train is scheduled at distance `d`: the
/// dwell (arrival, departure) at a stop, or a single instant between stops.
pub fn time_window_at(st: &[StopTime], d: f64) -> (f64, f64) {
    let Some(first) = st.first() else {
        return (0.0, 0.0);
    };
    if d <= f64::from(first.dist_m) + 1.0 {
        return (f64::from(first.arrival), f64::from(first.departure));
    }
    for w in st.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        let (da, db) = (f64::from(a.dist_m), f64::from(b.dist_m));
        if (d - db).abs() <= 1.0 {
            return (f64::from(b.arrival), f64::from(b.departure));
        }
        if d < db {
            let f = if db > da { (d - da) / (db - da) } else { 0.0 };
            let t = f64::from(a.departure) + f * f64::from(b.arrival - a.departure);
            return (t, t);
        }
    }
    let last = &st[st.len() - 1];
    (f64::from(last.arrival), f64::from(last.departure))
}

/// Delay implied by being at distance `d` at relative time `t`: zero if the
/// train is inside its scheduled window there, positive if late.
pub fn delay_at(st: &[StopTime], d: f64, t: f64) -> f64 {
    let (lo, hi) = time_window_at(st, d);
    t - t.clamp(lo, hi)
}

/// Index of the last stop at or behind distance `d`.
pub fn prev_stop(st: &[StopTime], d: f64) -> usize {
    st.partition_point(|s| f64::from(s.dist_m) <= d + 1.0)
        .saturating_sub(1)
}

/// Index of the next stop strictly ahead of distance `d`, if any.
pub fn next_stop(st: &[StopTime], d: f64) -> Option<usize> {
    let i = st.partition_point(|s| f64::from(s.dist_m) <= d + 30.0);
    (i < st.len()).then_some(i)
}

/// Timetabled speed (m/s) at relative time `t`: 0 while dwelling, the
/// section's average between stops, `None` outside the trip.
pub fn scheduled_speed(st: &[StopTime], t: f64) -> Option<f64> {
    for w in st.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        if t >= f64::from(a.arrival) && t <= f64::from(a.departure) {
            return Some(0.0);
        }
        if t > f64::from(a.departure) && t < f64::from(b.arrival) {
            let dt = f64::from(b.arrival - a.departure);
            return (dt > 0.0).then(|| f64::from(b.dist_m - a.dist_m) / dt);
        }
    }
    None
}

/// Current position along the trip at relative time `now`, given an anchor
/// (a GPS fix at distance `fix_d`, relative time `fix_t`) and the delay.
///
/// The train advances from the fix by as much as the schedule says it should
/// have moved since then, and never moves backwards or past the end.
pub fn advance_from_fix(st: &[StopTime], fix_d: f64, fix_t: f64, now: f64, delay: f64) -> f64 {
    let end = st.last().map_or(0.0, |s| f64::from(s.dist_m));
    let moved = dist_at(st, now - delay) - dist_at(st, fix_t - delay);
    (fix_d + moved.max(0.0)).min(end.max(fix_d))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A → B (10 km, 10 min) dwell 1 min → C (5 km, 5 min).
    fn sched() -> Vec<StopTime> {
        vec![
            StopTime {
                arrival: 0,
                departure: 0,
                dist_m: 0,
            },
            StopTime {
                arrival: 600,
                departure: 660,
                dist_m: 10_000,
            },
            StopTime {
                arrival: 960,
                departure: 960,
                dist_m: 15_000,
            },
        ]
    }

    #[test]
    fn distance_over_time() {
        let s = sched();
        assert_eq!(dist_at(&s, -100.0), 0.0);
        assert_eq!(dist_at(&s, 300.0), 5_000.0);
        assert_eq!(dist_at(&s, 630.0), 10_000.0, "dwelling at B");
        assert_eq!(dist_at(&s, 810.0), 12_500.0);
        assert_eq!(dist_at(&s, 5_000.0), 15_000.0);
    }

    #[test]
    fn time_at_distance_and_delay() {
        let s = sched();
        assert_eq!(time_window_at(&s, 5_000.0), (300.0, 300.0));
        assert_eq!(time_window_at(&s, 10_000.0), (600.0, 660.0));
        assert_eq!(delay_at(&s, 5_000.0, 480.0), 180.0, "3 min late");
        assert_eq!(delay_at(&s, 10_000.0, 640.0), 0.0, "within dwell");
        assert_eq!(delay_at(&s, 5_000.0, 240.0), -60.0, "early");
    }

    #[test]
    fn timetabled_speed() {
        let s = sched();
        assert_eq!(scheduled_speed(&s, 300.0), Some(10_000.0 / 600.0));
        assert_eq!(scheduled_speed(&s, 630.0), Some(0.0), "dwelling");
        assert_eq!(scheduled_speed(&s, 5_000.0), None);
    }

    #[test]
    fn stop_indexes() {
        let s = sched();
        assert_eq!(prev_stop(&s, 0.0), 0);
        assert_eq!(prev_stop(&s, 9_999.5), 1, "within a metre counts as at B");
        assert_eq!(next_stop(&s, 5_000.0), Some(1));
        assert_eq!(next_stop(&s, 10_000.0), Some(2));
        assert_eq!(next_stop(&s, 15_000.0), None);
    }

    #[test]
    fn interpolates_between_sparse_fixes() {
        let s = sched();
        // GPS fix at 5 km at t=420, i.e. 2 min late. 10 min later the train
        // is where the schedule puts it at t=900: 80% of the way B→C = 14 km.
        let fix_t = 420.0;
        let delay = delay_at(&s, 5_000.0, fix_t);
        assert_eq!(delay, 120.0);
        let d = advance_from_fix(&s, 5_000.0, fix_t, fix_t + 600.0, delay);
        assert_eq!(d, 14_000.0);
        // Never past the end, never backwards.
        assert_eq!(
            advance_from_fix(&s, 5_000.0, fix_t, 99_999.0, delay),
            15_000.0
        );
        assert_eq!(
            advance_from_fix(&s, 5_000.0, fix_t, fix_t - 100.0, delay),
            5_000.0
        );
    }
}
