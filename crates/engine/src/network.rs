//! Loaded reference data: stations, region timetables, pattern geometry and
//! the indexes used to match realtime records to scheduled trips.

use std::collections::HashMap;
use trainradar_proto::LatLon;
use trainradar_proto::geo::Polyline;
use trainradar_proto::refdata::{
    FormatError, StationsFile, StopTime, TimetableFile, TripRec, decode_file,
};
use trainradar_proto::time::{madrid_day, service_day_base};

/// A trip on a specific service day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TripRef {
    pub region: u16,
    pub trip: u32,
}

/// A realtime record matched to a scheduled trip run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Match {
    pub trip: TripRef,
    /// Service date (days since 1970-01-01).
    pub day: i64,
    /// UTC instant of the trip's first scheduled arrival.
    pub start_utc: i64,
    /// Matched by exact trip id (true) or only by train number (false).
    pub exact: bool,
}

#[derive(Debug)]
pub struct Region {
    pub tt: TimetableFile,
    /// Decoded stop times per pattern.
    pub sched: Vec<Vec<StopTime>>,
    /// Geometry per pattern: the shape (with an offset) or straight segments.
    pub geom: Vec<PatternGeom>,
    /// Global station id per timetable stop (for cross-region spacing).
    pub stop_gid: Vec<u32>,
}

#[derive(Debug)]
pub enum PatternGeom {
    Shape { shape: u32, start_m: f64 },
    Straight(Polyline),
}

#[derive(Debug, Default)]
pub struct Network {
    pub stations: Option<StationsFile>,
    pub regions: Vec<Region>,
    pub shapes: Vec<Vec<Polyline>>,
    station_gid: HashMap<String, u32>,
    by_trip_id: HashMap<String, TripRef>,
    by_number: HashMap<String, Vec<TripRef>>,
}

/// Commercial train number of a trip: `short_name`, or the leading digits of
/// the id after its service prefix (Cercanías `1004D` + `19799` + `C1`).
pub fn train_number(t: &TripRec) -> String {
    if !t.short_name.is_empty() {
        return t.short_name.trim_start_matches('0').to_owned();
    }
    let digits: String = t.id_rest.chars().take_while(char::is_ascii_digit).collect();
    digits.trim_start_matches('0').to_owned()
}

impl Network {
    pub fn load_stations(&mut self, bytes: &[u8]) -> Result<usize, FormatError> {
        let st: StationsFile = decode_file(bytes)?;
        let n = st.stations.len();
        for s in &st.stations {
            self.gid(&s.id);
        }
        self.stations = Some(st);
        Ok(n)
    }

    fn gid(&mut self, id: &str) -> u32 {
        let next = self.station_gid.len() as u32;
        *self.station_gid.entry(id.to_owned()).or_insert(next)
    }

    /// Load a region timetable; returns its region code. Reloading a region
    /// (e.g. after a daily rebuild) replaces the old one.
    pub fn load_timetable(&mut self, bytes: &[u8]) -> Result<String, FormatError> {
        let tt: TimetableFile = decode_file(bytes)?;
        let code = tt.region.clone();
        if let Some(i) = self.regions.iter().position(|r| r.tt.region == code) {
            self.regions.remove(i);
            self.shapes.remove(i);
            self.rebuild_indexes();
        }
        let shapes: Vec<Polyline> = tt.shapes.iter().map(|s| s.polyline()).collect();
        let sched: Vec<Vec<StopTime>> = tt.patterns.iter().map(|p| p.stop_times()).collect();
        let geom = tt
            .patterns
            .iter()
            .map(|p| match p.shape {
                Some(s) => PatternGeom::Shape {
                    shape: s,
                    start_m: f64::from(p.shape_start_m),
                },
                None => PatternGeom::Straight(Polyline::new(
                    p.stops
                        .iter()
                        .map(|&s| tt.stops[s as usize].coord())
                        .collect(),
                )),
            })
            .collect();
        let stop_gid = tt.stops.iter().map(|s| s.id.clone()).collect::<Vec<_>>();
        let stop_gid = stop_gid.iter().map(|id| self.gid(id)).collect();
        self.regions.push(Region {
            tt,
            sched,
            geom,
            stop_gid,
        });
        self.shapes.push(shapes);
        self.index_region(self.regions.len() - 1);
        Ok(code)
    }

    fn rebuild_indexes(&mut self) {
        self.by_trip_id.clear();
        self.by_number.clear();
        for i in 0..self.regions.len() {
            self.index_region(i);
        }
    }

    fn index_region(&mut self, ri: usize) {
        let r = &self.regions[ri];
        for (ti, t) in r.tt.trips.iter().enumerate() {
            let tref = TripRef {
                region: ri as u16,
                trip: ti as u32,
            };
            self.by_trip_id.insert(r.tt.trip_id(t), tref);
            let n = train_number(t);
            if !n.is_empty() {
                self.by_number.entry(n).or_default().push(tref);
            }
        }
    }

    pub fn trip(&self, t: TripRef) -> &TripRec {
        &self.regions[t.region as usize].tt.trips[t.trip as usize]
    }

    pub fn schedule(&self, t: TripRef) -> &[StopTime] {
        let r = &self.regions[t.region as usize];
        &r.sched[r.tt.trips[t.trip as usize].pattern as usize]
    }

    /// Point at `d` metres along the trip, and the bearing there.
    pub fn point_at(&self, t: TripRef, d: f64) -> Option<(LatLon, Option<f32>)> {
        let r = &self.regions[t.region as usize];
        match &r.geom[r.tt.trips[t.trip as usize].pattern as usize] {
            PatternGeom::Shape { shape, start_m } => {
                let line = &self.shapes[t.region as usize][*shape as usize];
                Some((line.point_at(start_m + d)?, line.bearing_at(start_m + d)))
            }
            PatternGeom::Straight(line) => Some((line.point_at(d)?, line.bearing_at(d))),
        }
    }

    /// Project a GPS point onto the trip: (metres along trip, metres off line).
    pub fn project(&self, t: TripRef, p: LatLon) -> Option<(f64, f64)> {
        let r = &self.regions[t.region as usize];
        let total = self.schedule(t).last().map_or(0.0, |s| f64::from(s.dist_m));
        match &r.geom[r.tt.trips[t.trip as usize].pattern as usize] {
            PatternGeom::Shape { shape, start_m } => {
                let line = &self.shapes[t.region as usize][*shape as usize];
                let pr = line.project(p)?;
                Some(((pr.along_m - start_m).clamp(0.0, total), pr.offset_m))
            }
            PatternGeom::Straight(line) => {
                let pr = line.project(p)?;
                Some((pr.along_m.clamp(0.0, total), pr.offset_m))
            }
        }
    }

    /// Global station ids of a trip's stops, in order.
    pub fn stop_gids(&self, t: TripRef) -> impl Iterator<Item = u32> + '_ {
        let r = &self.regions[t.region as usize];
        r.tt.patterns[r.tt.trips[t.trip as usize].pattern as usize]
            .stops
            .iter()
            .map(|&s| r.stop_gid[s as usize])
    }

    pub fn stop_name(&self, t: TripRef, index: usize) -> &str {
        let r = &self.regions[t.region as usize];
        let p = &r.tt.patterns[r.tt.trips[t.trip as usize].pattern as usize];
        p.stops
            .get(index)
            .map_or("", |&s| r.tt.stops[s as usize].name.as_str())
    }

    /// Find the scheduled run a realtime record belongs to. Tries the exact
    /// trip id, then the train number. Among service days, picks the run
    /// whose scheduled span (with slack for delays) contains `now`.
    pub fn match_trip(&self, trip_id: &str, number: &str, now: i64) -> Option<Match> {
        let exact = self.by_trip_id.get(trip_id).map(|&t| (t, true));
        let by_number = || {
            let n = number.trim_start_matches('0');
            self.by_number
                .get(n)
                .into_iter()
                .flatten()
                .map(|&t| (t, false))
                .collect::<Vec<_>>()
        };
        let candidates: Vec<(TripRef, bool)> = match exact {
            Some(e) => vec![e],
            None => by_number(),
        };
        let today = madrid_day(now);
        let mut best: Option<(i64, Match)> = None;
        for (tref, exact) in candidates {
            let r = &self.regions[tref.region as usize];
            let trip = &r.tt.trips[tref.trip as usize];
            let dur = self
                .schedule(tref)
                .last()
                .map_or(0, |s| i64::from(s.arrival));
            for day in [today - 1, today, today + 1] {
                let bit = day - i64::from(r.tt.header.window_start_day);
                if !(0..16).contains(&bit) || trip.days & (1 << bit) == 0 {
                    continue;
                }
                let start = service_day_base(day) + i64::from(trip.start);
                // Allow 30 min early (positioning) to 6 h late.
                let (lo, hi) = (start - 1_800, start + dur + 6 * 3_600);
                if !(lo..=hi).contains(&now) {
                    continue;
                }
                // Prefer the run whose middle is closest to now.
                let score = (now - (start + dur / 2)).abs();
                if best.is_none_or(|b| score < b.0) {
                    best = Some((
                        score,
                        Match {
                            trip: tref,
                            day,
                            start_utc: start,
                            exact,
                        },
                    ));
                }
            }
        }
        best.map(|b| b.1)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use trainradar_proto::encode;
    use trainradar_proto::refdata::{
        Header, PatternRec, RouteRec, ShapeRec, StopRec, TimetableFile, to_e5,
    };
    use trainradar_proto::time::days_from_civil;

    pub fn stop(id: &str, lat: f64, lon: f64) -> StopRec {
        StopRec {
            id: id.into(),
            name: format!("Stop {id}"),
            lat_e5: to_e5(lat),
            lon_e5: to_e5(lon),
        }
    }

    /// Region "10": stops A–B–C on a straight north–south line ~11 km apart,
    /// one pattern A→B→C (10 min, 1 min dwell, 10 min), trips at 08:00 and
    /// 08:10 on 1 Nov 2026, and an id-less AV/LD-style trip with a number.
    pub fn sample_timetable() -> TimetableFile {
        let day = days_from_civil(2026, 11, 1);
        let stops = vec![
            stop("A", 40.40, -3.70),
            stop("B", 40.30, -3.70),
            stop("C", 40.20, -3.70),
        ];
        let pts: Vec<LatLon> = stops.iter().map(StopRec::coord).collect();
        let line = Polyline::new(pts.clone());
        let d1 = line.project(pts[1]).unwrap().along_m.round() as u32;
        let d2 = line.length_m().round() as u32;
        let pattern = PatternRec::from_absolute(
            vec![0, 1, 2],
            &[(0, 0), (600, 660), (1260, 1260)],
            &[0, d1, d2],
            Some(0),
            0,
        );
        let trip = |start: u32, rest: &str, short: &str| TripRec {
            route: 0,
            pattern: 0,
            start,
            days: 0b10, // window starts 31 Oct; bit 1 = 1 Nov
            service: if short.is_empty() { Some(0) } else { None },
            id_rest: rest.into(),
            headsign: String::new(),
            short_name: short.into(),
        };
        TimetableFile {
            header: Header::new((day - 1) as u32, 8, 0),
            region: "10".into(),
            stops,
            routes: vec![RouteRec {
                id: "10T0001C3".into(),
                short_name: "C3".into(),
                long_name: String::new(),
                color: None,
                text_color: None,
            }],
            shapes: vec![ShapeRec::encode("10_C3".into(), &pts)],
            patterns: vec![pattern],
            services: vec!["1004D".into()],
            trips: vec![
                trip(8 * 3600, "100C3", ""),
                trip(8 * 3600 + 600, "102C3", ""),
                trip(9 * 3600, "0019012026-10-31", "00190"),
            ],
        }
    }

    pub fn sample_network() -> Network {
        let mut n = Network::default();
        n.load_timetable(&encode(&sample_timetable()).unwrap())
            .unwrap();
        n
    }

    /// UTC for a Madrid local time on 1 Nov 2026 (CET, UTC+1).
    pub fn local(h: i64, m: i64) -> i64 {
        days_from_civil(2026, 11, 1) * 86_400 + (h - 1) * 3_600 + m * 60
    }

    #[test]
    fn matches_by_trip_id_and_by_number() {
        let n = sample_network();
        let m = n.match_trip("1004D100C3", "", local(8, 5)).unwrap();
        assert!(m.exact);
        assert_eq!(m.trip.trip, 0);
        assert_eq!(m.start_utc, local(8, 0));

        // Unknown id, but train number 190 (leading zeros ignored).
        let m = n
            .match_trip("0019012026-11-01", "00190", local(9, 10))
            .unwrap();
        assert!(!m.exact);
        assert_eq!(m.trip.trip, 2);

        // Outside the trip's span (8:00 run, at 20:00 even with slack): no match.
        assert!(n.match_trip("1004D100C3", "", local(20, 0)).is_none());
        assert!(n.match_trip("nope", "999", local(8, 5)).is_none());
    }

    #[test]
    fn projects_and_places_along_trip() {
        let n = sample_network();
        let t = TripRef { region: 0, trip: 0 };
        let (d, off) = n.project(t, LatLon::new(40.35, -3.7005)).unwrap();
        assert!((d - 5_560.0).abs() < 20.0, "{d}");
        assert!(off < 50.0);
        let (p, bearing) = n.point_at(t, d).unwrap();
        assert!((p.lat - 40.35).abs() < 1e-3);
        assert!((bearing.unwrap() - 180.0).abs() < 1.0, "heading south");
        assert_eq!(n.stop_name(t, 1), "Stop B");
        assert_eq!(n.stop_gids(t).count(), 3);
    }

    #[test]
    fn train_numbers() {
        let tt = sample_timetable();
        assert_eq!(train_number(&tt.trips[0]), "100");
        assert_eq!(train_number(&tt.trips[2]), "190");
    }
}
