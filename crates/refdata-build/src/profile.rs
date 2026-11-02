//! Height profiles for track legs, from per-point track heights (terrain
//! heights from the DEM, with tunnels and bridges already interpolated).

use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;
use trainradar_proto::refdata::Profile;

/// Target spacing between profile samples.
/// (400 m: a gradient is read over 800 m anyway, and it keeps the
/// geometry files small.)
pub const STEP_M: f64 = 400.0;
/// Share of a leg's points that must have a height.
pub const MIN_KNOWN: f64 = 0.9;

/// Resample `heights` (one per point of `pts`, NaN = unknown) to evenly
/// spaced samples over the leg and smooth out DEM noise. Empty when under
/// [`MIN_KNOWN`] of the points have a height (say, a DEM tile is missing):
/// filling long gaps would show flat track that may not be.
pub fn leg_profile(pts: &[LatLon], heights: &[f32]) -> Profile {
    if pts.len() < 2 || pts.len() != heights.len() {
        return Profile::default();
    }
    let mut cum = vec![0.0];
    for w in pts.windows(2) {
        cum.push(cum[cum.len() - 1] + haversine_m(w[0], w[1]));
    }
    let known: Vec<(f64, f64)> = cum
        .iter()
        .zip(heights)
        .filter(|(_, h)| !h.is_nan())
        .map(|(&d, &h)| (d, f64::from(h)))
        .collect();
    if known.is_empty() || (known.len() as f64) < MIN_KNOWN * pts.len() as f64 {
        return Profile::default();
    }
    let len = cum[cum.len() - 1];
    let n = ((len / STEP_M).round() as usize + 1).max(2);
    let mut z: Vec<f64> = (0..n)
        .map(|i| interpolate(&known, len * i as f64 / (n - 1) as f64))
        .collect();
    z = smooth(&z);
    Profile::encode(&z.iter().map(|&h| h as f32).collect::<Vec<_>>())
}

/// Linear interpolation in (distance, height) pairs sorted by distance;
/// flat beyond the ends.
fn interpolate(known: &[(f64, f64)], d: f64) -> f64 {
    let i = known.partition_point(|k| k.0 <= d);
    match (i.checked_sub(1).map(|j| known[j]), known.get(i)) {
        (Some(a), Some(b)) if b.0 > a.0 => a.1 + (b.1 - a.1) * (d - a.0) / (b.0 - a.0),
        (Some(a), _) => a.1,
        (None, Some(b)) => b.1,
        (None, None) => 0.0,
    }
}

/// One pass of a [1, 2, 1] / 4 filter, ends kept.
fn smooth(z: &[f64]) -> Vec<f64> {
    (0..z.len())
        .map(|i| {
            if i == 0 || i + 1 == z.len() {
                z[i]
            } else {
                (z[i - 1] + 2.0 * z[i] + z[i + 1]) / 4.0
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn even_samples_fill_gaps_and_keep_steady_grades() {
        // 4 km due east (~0.047° at lat 40), climbing 40 m: a 10 ‰ grade,
        // with one unknown height in the middle (one in 11 is fine).
        let pts: Vec<LatLon> = (0..=10)
            .map(|i| LatLon::new(40.0, -3.7 + 0.0047 * f64::from(i)))
            .collect();
        let mut z: Vec<f32> = (0..=10).map(|i| 600.0 + 4.0 * i as f32).collect();
        z[5] = f32::NAN;
        let p = leg_profile(&pts, &z);
        let h = p.heights_m();
        assert_eq!(h.len(), 11, "every 400 m");
        assert_eq!((h[0], h[10]), (600.0, 640.0));
        for w in h.windows(2) {
            assert!((w[1] - w[0] - 4.0).abs() < 0.15, "{h:?}");
        }
        z[6] = f32::NAN;
        assert!(leg_profile(&pts, &z).deltas.is_empty(), "too many unknown");
    }

    #[test]
    fn smoothing_damps_a_spike() {
        let z = smooth(&smooth(&[0.0, 0.0, 0.0, 16.0, 0.0, 0.0, 0.0]));
        assert_eq!(z, [0.0, 1.0, 4.0, 6.0, 4.0, 1.0, 0.0]);
    }
}
