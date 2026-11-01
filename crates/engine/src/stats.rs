//! Numbers for the stats bar.

use trainradar_proto::{Delay, DelayClass};

/// Summary shown in the stats bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MapStats {
    pub trains: usize,
    /// Trains 5+ minutes late.
    pub delayed: usize,
    /// Median delay in seconds over trains with a known delay.
    pub median_delay: Option<i32>,
}

/// Stats over one delay per train (`None` = unknown).
pub fn compute(delays: impl IntoIterator<Item = Option<Delay>>) -> MapStats {
    let mut trains = 0;
    let mut known: Vec<i32> = Vec::new();
    for d in delays {
        trains += 1;
        if let Some(d) = d {
            known.push(d.0);
        }
    }
    let delayed = known
        .iter()
        .filter(|&&d| Delay(d).class() != DelayClass::OnTime)
        .count();
    MapStats {
        trains,
        delayed,
        median_delay: median(&mut known),
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

    #[test]
    fn empty_map() {
        assert_eq!(compute([]), MapStats::default());
    }

    #[test]
    fn counts_delayed_and_median() {
        let s = compute([Some(Delay(0)), Some(Delay(300)), Some(Delay(1200)), None]);
        assert_eq!(s.trains, 4);
        assert_eq!(s.delayed, 2);
        assert_eq!(s.median_delay, Some(300));
    }

    #[test]
    fn even_median_averages_middle_values() {
        assert_eq!(
            compute([Some(Delay(60)), Some(Delay(120))]).median_delay,
            Some(90)
        );
    }
}
