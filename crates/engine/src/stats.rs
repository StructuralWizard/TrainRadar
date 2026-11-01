//! Numbers for the stats bar.

use trainradar_proto::{Delay, DelayClass, Train};

/// Summary shown in the stats bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MapStats {
    pub trains: usize,
    /// Trains 5+ minutes late.
    pub delayed: usize,
    /// Median delay in seconds over trains with a known delay.
    pub median_delay: Option<i32>,
}

pub fn compute(trains: &[Train]) -> MapStats {
    let mut delays: Vec<i32> = trains.iter().filter_map(|t| t.delay.map(|d| d.0)).collect();
    let delayed = delays
        .iter()
        .filter(|&&d| Delay(d).class() != DelayClass::OnTime)
        .count();
    MapStats {
        trains: trains.len(),
        delayed,
        median_delay: median(&mut delays),
    }
}

/// Median of the values (mean of the two middle values for even counts).
fn median(values: &mut [i32]) -> Option<i32> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 1 {
        values[mid]
    } else {
        // i64 avoids overflow on extreme inputs.
        ((i64::from(values[mid - 1]) + i64::from(values[mid])) / 2) as i32
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use trainradar_proto::{LatLon, Position, PositionSource, Service};

    fn train(delay: Option<i32>) -> Train {
        Train {
            trip_id: "t".into(),
            label: "t".into(),
            service: Service::LongDistance,
            origin: "a".into(),
            destination: "b".into(),
            next_stop: None,
            delay: delay.map(Delay),
            position: Position {
                coord: LatLon::new(40.0, -3.0),
                bearing: None,
                fix_time: 0,
                source: PositionSource::Gps,
            },
            ahead: None,
            behind: None,
        }
    }

    #[test]
    fn empty_map() {
        assert_eq!(compute(&[]), MapStats::default());
    }

    #[test]
    fn counts_delayed_and_median() {
        let ts = [
            train(Some(0)),
            train(Some(300)),
            train(Some(1200)),
            train(None),
        ];
        let s = compute(&ts);
        assert_eq!(s.trains, 4);
        assert_eq!(s.delayed, 2);
        assert_eq!(s.median_delay, Some(300));
    }

    #[test]
    fn even_median_averages_middle_values() {
        let ts = [train(Some(60)), train(Some(120))];
        assert_eq!(compute(&ts).median_delay, Some(90));
    }
}
