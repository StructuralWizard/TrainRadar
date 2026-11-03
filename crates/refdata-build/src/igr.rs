//! Track count and electrification from the IGN national transport network
//! (IGR-RT, rail data from ADIF), matched onto our OpenStreetMap legs.
//!
//! Input: `tools/fetch-igr-rail.py` output, one JSON object per line:
//! `{"p":{"t":tracks,"e":"true"|"false","g":gauge},"c":[[lon,lat],...]}`.
//!
//! © Instituto Geográfico Nacional (SCNE, IGR-RT), CC BY 4.0.

use crate::gtfs_io::Result;
use std::collections::HashMap;
use std::io::BufRead;
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;

/// A leg point matches an IGN link within this distance...
pub const MAX_OFFSET_M: f64 = 30.0;
/// ...running the same way (either direction) within this angle.
pub const MAX_ANGLE_DEG: f64 = 30.0;
/// Distance between the leg points we look up.
pub const SAMPLE_M: f64 = 100.0;
/// A value is only given when matched points cover this share of the leg.
pub const MIN_COVER: f64 = 0.5;

const CELL_DEG: f64 = 0.002;

#[derive(Debug, Clone, Copy)]
struct Seg {
    a: LatLon,
    b: LatLon,
    tracks: u8,
    electrified: u8,
}

#[derive(Debug, Default)]
pub struct TrackAttrs {
    segs: Vec<Seg>,
    grid: HashMap<(i32, i32), Vec<u32>>,
}

fn cell(lat: f64, lon: f64) -> (i32, i32) {
    (
        (lat / CELL_DEG).floor() as i32,
        (lon / CELL_DEG).floor() as i32,
    )
}

/// Local metres east/north of `o`.
fn xy(o: LatLon, p: LatLon) -> (f64, f64) {
    let k = 111_320.0;
    (
        (p.lon - o.lon) * k * o.lat.to_radians().cos(),
        (p.lat - o.lat) * k,
    )
}

/// Distance from `p` to segment `s` (m) and the segment's direction (deg, 0..180).
fn offset_and_axis(p: LatLon, s: &Seg) -> (f64, f64) {
    let (bx, by) = xy(s.a, s.b);
    let (px, py) = xy(s.a, p);
    let len2 = bx * bx + by * by;
    let t = if len2 > 0.0 {
        ((px * bx + py * by) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let (dx, dy) = (px - t * bx, py - t * by);
    (
        (dx * dx + dy * dy).sqrt(),
        bx.atan2(by).to_degrees().rem_euclid(180.0),
    )
}

fn axis_diff(a: f64, b: f64) -> f64 {
    let d = (a - b).rem_euclid(180.0);
    d.min(180.0 - d)
}

impl TrackAttrs {
    pub fn len(&self) -> usize {
        self.segs.len()
    }

    pub fn from_lines(r: impl BufRead) -> Result<Self> {
        let mut t = Self::default();
        for line in r.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let v: serde_json::Value = serde_json::from_str(&line)?;
            let tracks = v["p"]["t"].as_u64().map_or(0, |n| n.min(9) as u8);
            let electrified = match v["p"]["e"].as_str() {
                Some("true") => 2,
                Some("false") => 1,
                _ => 0,
            };
            if tracks == 0 && electrified == 0 {
                continue;
            }
            let pts: Vec<LatLon> = v["c"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| Some(LatLon::new(c.get(1)?.as_f64()?, c.get(0)?.as_f64()?)))
                .collect();
            for w in pts.windows(2) {
                t.add(Seg {
                    a: w[0],
                    b: w[1],
                    tracks,
                    electrified,
                });
            }
        }
        Ok(t)
    }

    fn add(&mut self, s: Seg) {
        let id = self.segs.len() as u32;
        let (r0, c0) = cell(s.a.lat.min(s.b.lat), s.a.lon.min(s.b.lon));
        let (r1, c1) = cell(s.a.lat.max(s.b.lat), s.a.lon.max(s.b.lon));
        for r in r0..=r1 {
            for c in c0..=c1 {
                self.grid.entry((r, c)).or_default().push(id);
            }
        }
        self.segs.push(s);
    }

    /// The nearest link along the track direction `axis` near `p`.
    fn nearest(&self, p: LatLon, axis: f64) -> Option<&Seg> {
        let (r, c) = cell(p.lat, p.lon);
        let mut best: Option<(f64, u32)> = None;
        for dr in -1..=1 {
            for dc in -1..=1 {
                for &i in self.grid.get(&(r + dr, c + dc)).into_iter().flatten() {
                    let (d, ax) = offset_and_axis(p, &self.segs[i as usize]);
                    if d <= MAX_OFFSET_M
                        && axis_diff(ax, axis) <= MAX_ANGLE_DEG
                        && best.is_none_or(|b| d < b.0)
                    {
                        best = Some((d, i));
                    }
                }
            }
        }
        best.map(|(_, i)| &self.segs[i as usize])
    }

    /// (tracks, electrified) along a leg: the values covering most of it,
    /// 0 when unknown or matched on under [`MIN_COVER`] of the leg.
    pub fn along(&self, pts: &[LatLon]) -> (u8, u8) {
        let mut tracks: HashMap<u8, usize> = HashMap::new();
        let mut elec: HashMap<u8, usize> = HashMap::new();
        let mut samples = 0;
        for w in pts.windows(2) {
            let len = haversine_m(w[0], w[1]);
            let (ex, ny) = xy(w[0], w[1]);
            let axis = ex.atan2(ny).to_degrees().rem_euclid(180.0);
            let n = (len / SAMPLE_M).ceil().max(1.0) as usize;
            for i in 0..n {
                let f = (i as f64 + 0.5) / n as f64;
                let p = LatLon::new(
                    w[0].lat + (w[1].lat - w[0].lat) * f,
                    w[0].lon + (w[1].lon - w[0].lon) * f,
                );
                samples += 1;
                if let Some(s) = self.nearest(p, axis) {
                    if s.tracks > 0 {
                        *tracks.entry(s.tracks).or_default() += 1;
                    }
                    if s.electrified > 0 {
                        *elec.entry(s.electrified).or_default() += 1;
                    }
                }
            }
        }
        let pick = |m: &HashMap<u8, usize>| {
            let covered: usize = m.values().sum();
            if samples == 0 || (covered as f64) < MIN_COVER * samples as f64 {
                return 0;
            }
            m.iter()
                .max_by_key(|(k, n)| (**n, std::cmp::Reverse(**k)))
                .map_or(0, |(k, _)| *k)
        };
        (pick(&tracks), pick(&elec))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = concat!(
        // Double track, electrified, along lat 40.000 from -3.70 to -3.65.
        "{\"p\":{\"t\":2,\"e\":\"true\",\"g\":1435},\"c\":[[-3.70,40.0],[-3.65,40.0]]}\n",
        // Single track, not electrified, continuing to -3.60.
        "{\"p\":{\"t\":1,\"e\":\"false\",\"g\":1668},\"c\":[[-3.65,40.0],[-3.60,40.0]]}\n",
        // A crossing line (north-south) that must not count.
        "{\"p\":{\"t\":4,\"e\":\"true\",\"g\":1668},\"c\":[[-3.68,39.99],[-3.68,40.01]]}\n",
        "{\"p\":{\"t\":null,\"e\":null,\"g\":null},\"c\":[[-3.7,40.0],[-3.6,40.0]]}\n",
    );

    #[test]
    fn majority_along_the_leg_ignoring_crossings() {
        let t = TrackAttrs::from_lines(SAMPLE.as_bytes()).unwrap();
        assert_eq!(t.len(), 3, "the line without attributes is skipped");
        // 10 m north of the track, mostly on the double-track part.
        let leg = [LatLon::new(40.0001, -3.70), LatLon::new(40.0001, -3.66)];
        assert_eq!(t.along(&leg), (2, 2));
        let leg = [LatLon::new(40.0, -3.64), LatLon::new(40.0, -3.60)];
        assert_eq!(t.along(&leg), (1, 1));
    }

    #[test]
    fn unknown_when_far_or_barely_covered() {
        let t = TrackAttrs::from_lines(SAMPLE.as_bytes()).unwrap();
        let far = [LatLon::new(40.001, -3.70), LatLon::new(40.001, -3.66)];
        assert_eq!(t.along(&far), (0, 0), "~110 m away");
        // 4.3 km on known track, 17 km beyond its end: under half covered.
        let mostly_off = [LatLon::new(40.0, -3.65), LatLon::new(40.0, -3.40)];
        assert_eq!(t.along(&mostly_off), (0, 0));
    }
}
