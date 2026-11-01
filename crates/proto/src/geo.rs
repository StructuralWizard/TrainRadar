//! Geometry helpers shared by the builder and the browser engine: distances,
//! polylines with linear referencing (distance along a line), simplification.

use crate::LatLon;

/// Mean Earth radius in metres.
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Great-circle distance in metres.
pub fn haversine_m(a: LatLon, b: LatLon) -> f64 {
    let (la1, la2) = (a.lat.to_radians(), b.lat.to_radians());
    let dlat = la2 - la1;
    let dlon = (b.lon - a.lon).to_radians();
    let h = (dlat / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * h.sqrt().asin()
}

/// Local flat projection around a reference latitude, in metres. Accurate to
/// well under 1% over a few tens of km, which is all segment maths needs.
#[derive(Debug, Clone, Copy)]
struct Flat {
    kx: f64,
    ky: f64,
}

impl Flat {
    fn at(lat: f64) -> Self {
        let ky = EARTH_RADIUS_M.to_radians();
        Self {
            kx: ky * lat.to_radians().cos(),
            ky,
        }
    }

    fn xy(self, origin: LatLon, p: LatLon) -> (f64, f64) {
        (
            (p.lon - origin.lon) * self.kx,
            (p.lat - origin.lat) * self.ky,
        )
    }
}

/// Project `p` onto segment `a`–`b`: returns (fraction along 0..=1, distance m).
pub fn project_on_segment(p: LatLon, a: LatLon, b: LatLon) -> (f64, f64) {
    let f = Flat::at(p.lat);
    let (bx, by) = f.xy(a, b);
    let (px, py) = f.xy(a, p);
    let len2 = bx * bx + by * by;
    let t = if len2 == 0.0 {
        0.0
    } else {
        ((px * bx + py * by) / len2).clamp(0.0, 1.0)
    };
    let (dx, dy) = (px - t * bx, py - t * by);
    (t, (dx * dx + dy * dy).sqrt())
}

/// A polyline with cumulative distances, for linear referencing.
#[derive(Debug, Clone, PartialEq)]
pub struct Polyline {
    pts: Vec<LatLon>,
    cum: Vec<f64>,
}

/// Result of projecting a point onto a polyline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Projection {
    /// Distance along the line from its start, in metres.
    pub along_m: f64,
    /// Perpendicular distance from the line, in metres.
    pub offset_m: f64,
    /// Index of the segment the point projects onto.
    pub segment: usize,
}

impl Polyline {
    pub fn new(pts: Vec<LatLon>) -> Self {
        let mut cum = Vec::with_capacity(pts.len());
        let mut d = 0.0;
        for (i, p) in pts.iter().enumerate() {
            if i > 0 {
                d += haversine_m(pts[i - 1], *p);
            }
            cum.push(d);
        }
        Self { pts, cum }
    }

    pub fn points(&self) -> &[LatLon] {
        &self.pts
    }

    pub fn length_m(&self) -> f64 {
        self.cum.last().copied().unwrap_or(0.0)
    }

    /// Nearest projection over segments `from_segment..`. Pass the previous
    /// stop's segment to keep stop projections in order on looping lines.
    pub fn project_from(&self, p: LatLon, from_segment: usize) -> Option<Projection> {
        if self.pts.len() < 2 {
            return self.pts.first().map(|&a| Projection {
                along_m: 0.0,
                offset_m: haversine_m(a, p),
                segment: 0,
            });
        }
        let mut best: Option<Projection> = None;
        for i in from_segment.min(self.pts.len() - 2)..self.pts.len() - 1 {
            let (t, off) = project_on_segment(p, self.pts[i], self.pts[i + 1]);
            if best.is_none_or(|b| off < b.offset_m) {
                best = Some(Projection {
                    along_m: self.cum[i] + t * (self.cum[i + 1] - self.cum[i]),
                    offset_m: off,
                    segment: i,
                });
            }
        }
        best
    }

    pub fn project(&self, p: LatLon) -> Option<Projection> {
        self.project_from(p, 0)
    }

    /// Nearest projection onto the part of the line between `from_m` and
    /// `to_m` metres from its start (e.g. the section one trip uses).
    pub fn project_range(&self, p: LatLon, from_m: f64, to_m: f64) -> Option<Projection> {
        if self.pts.len() < 2 {
            return self.project(p);
        }
        let first = self.cum.partition_point(|&c| c <= from_m).saturating_sub(1);
        let last = self
            .cum
            .partition_point(|&c| c < to_m)
            .min(self.pts.len() - 1);
        let mut best: Option<Projection> = None;
        for i in first..last.max(first + 1) {
            let (t, _) = project_on_segment(p, self.pts[i], self.pts[i + 1]);
            let seg = self.cum[i + 1] - self.cum[i];
            let along = (self.cum[i] + t * seg).clamp(from_m, to_m);
            let q = self.point_at(along)?;
            let off = haversine_m(p, q);
            if best.is_none_or(|b| off < b.offset_m) {
                best = Some(Projection {
                    along_m: along,
                    offset_m: off,
                    segment: i,
                });
            }
        }
        best
    }

    /// Point at `along_m` metres from the start (clamped to the line).
    pub fn point_at(&self, along_m: f64) -> Option<LatLon> {
        let last = *self.pts.last()?;
        if along_m <= 0.0 {
            return self.pts.first().copied();
        }
        if along_m >= self.length_m() {
            return Some(last);
        }
        let i = self
            .cum
            .partition_point(|&c| c <= along_m)
            .saturating_sub(1);
        let seg = self.cum[i + 1] - self.cum[i];
        let t = if seg > 0.0 {
            (along_m - self.cum[i]) / seg
        } else {
            0.0
        };
        let (a, b) = (self.pts[i], self.pts[i + 1]);
        Some(LatLon::new(
            a.lat + t * (b.lat - a.lat),
            a.lon + t * (b.lon - a.lon),
        ))
    }

    /// Bearing in degrees (0 = north, clockwise) of the segment at `along_m`.
    pub fn bearing_at(&self, along_m: f64) -> Option<f32> {
        if self.pts.len() < 2 {
            return None;
        }
        let i = self
            .cum
            .partition_point(|&c| c <= along_m)
            .saturating_sub(1)
            .min(self.pts.len() - 2);
        let (a, b) = (self.pts[i], self.pts[i + 1]);
        let (x, y) = Flat::at(a.lat).xy(a, b);
        Some((x.atan2(y).to_degrees().rem_euclid(360.0)) as f32)
    }
}

/// Douglas–Peucker simplification with a tolerance in metres.
pub fn simplify(pts: &[LatLon], tolerance_m: f64) -> Vec<LatLon> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let mut keep = vec![false; pts.len()];
    keep[0] = true;
    keep[pts.len() - 1] = true;
    let mut stack = vec![(0, pts.len() - 1)];
    while let Some((s, e)) = stack.pop() {
        let mut worst = (0.0, 0);
        for i in s + 1..e {
            let (_, d) = project_on_segment(pts[i], pts[s], pts[e]);
            if d > worst.0 {
                worst = (d, i);
            }
        }
        if worst.0 > tolerance_m {
            keep[worst.1] = true;
            stack.push((s, worst.1));
            stack.push((worst.1, e));
        }
    }
    pts.iter()
        .zip(keep)
        .filter_map(|(p, k)| k.then_some(*p))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MADRID: LatLon = LatLon::new(40.4065, -3.6895);
    const BARCELONA: LatLon = LatLon::new(41.3793, 2.1404);

    #[test]
    fn haversine_madrid_barcelona() {
        let d = haversine_m(MADRID, BARCELONA) / 1000.0;
        assert!((d - 504.0).abs() < 3.0, "{d}");
    }

    #[test]
    fn polyline_projection_and_point_at() {
        // Roughly 1.1 km east, then 1.1 km north.
        let line = Polyline::new(vec![
            LatLon::new(40.0, -3.0),
            LatLon::new(40.0, -2.987),
            LatLon::new(40.01, -2.987),
        ]);
        let p = line.project(LatLon::new(40.0005, -2.9935)).unwrap();
        assert_eq!(p.segment, 0);
        assert!((p.along_m - 554.0).abs() < 5.0, "{}", p.along_m);
        assert!((p.offset_m - 55.6).abs() < 2.0, "{}", p.offset_m);

        let mid = line.point_at(p.along_m).unwrap();
        assert!((mid.lat - 40.0).abs() < 1e-9 && (mid.lon + 2.9935).abs() < 1e-4);
        assert_eq!(line.point_at(-5.0), Some(line.points()[0]));
        assert_eq!(line.point_at(1e9), Some(line.points()[2]));
        assert!((line.bearing_at(10.0).unwrap() - 90.0).abs() < 0.5);
        assert!(line.bearing_at(line.length_m() - 1.0).unwrap() < 0.5);
    }

    #[test]
    fn project_range_stays_within_section() {
        // Straight line 0 → ~2.2 km east; restrict to the first ~550 m.
        let line = Polyline::new(vec![
            LatLon::new(40.0, -3.0),
            LatLon::new(40.0, -2.9935),
            LatLon::new(40.0, -2.974),
        ]);
        let far = LatLon::new(40.0, -2.98); // ~1.7 km along, outside the range
        let p = line.project_range(far, 0.0, 550.0).unwrap();
        assert!((p.along_m - 550.0).abs() < 1.0);
        assert!(p.offset_m > 1_000.0, "reported as far from this section");
        let near = line
            .project_range(LatLon::new(40.0001, -2.997), 0.0, 550.0)
            .unwrap();
        assert!(near.offset_m < 20.0);
    }

    #[test]
    fn project_from_skips_earlier_segments() {
        // Out and back: the return leg passes the start point again.
        let line = Polyline::new(vec![
            LatLon::new(40.0, -3.0),
            LatLon::new(40.0, -2.99),
            LatLon::new(40.0001, -3.0),
        ]);
        let start = LatLon::new(40.0, -3.0);
        assert_eq!(line.project(start).unwrap().segment, 0);
        assert_eq!(line.project_from(start, 1).unwrap().segment, 1);
    }

    #[test]
    fn simplify_drops_collinear_points() {
        let pts: Vec<_> = (0..=10)
            .map(|i| LatLon::new(40.0, -3.0 + f64::from(i) * 0.001))
            .collect();
        assert_eq!(simplify(&pts, 1.0).len(), 2);
        // A tent: straight up to a ~110 m peak at the middle, straight down.
        let tent: Vec<_> = pts
            .iter()
            .enumerate()
            .map(|(i, p)| LatLon::new(p.lat + 0.0002 * i.min(10 - i) as f64, p.lon))
            .collect();
        assert_eq!(simplify(&tent, 5.0).len(), 3);
    }
}
