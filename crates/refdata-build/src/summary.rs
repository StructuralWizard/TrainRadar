//! A country's summary for the website's world view (`summary.json` next to
//! its manifest): how many stations and lines it has, how many of its
//! trains run in each half hour of each day of the window, and a coarse
//! outline of its network, small enough to draw every country at once.
//! `tools/world/build.mjs` merges the countries' summaries into
//! `data/world.json`; live counts come every ten minutes from backend-eu.

use serde::Serialize;
use std::collections::BTreeSet;
use trainradar_proto::refdata::TimetableFile;

/// Half hours: the "running now" figure's resolution.
pub const SLOT_S: u32 = 1_800;
pub const SLOTS: usize = 48;
/// The network's grid, in hundredths of a degree: 0.02° (about 2 km), finer
/// than a pixel at the world view's zoom (under 3.5).
pub const GRID: i32 = 2;

#[derive(Debug, Serialize)]
pub struct Summary {
    /// First day of `running` (YYYY-MM-DD), local to the country.
    pub window_start: String,
    pub stations: usize,
    pub lines: usize,
    /// Trains running at the middle of each half hour, one row per day.
    pub running: Vec<Vec<u32>>,
    /// Stop-to-stop segments on a 0.01° grid, snapped to `GRID`: flat
    /// `[lon1, lat1, lon2, lat2, …]` in hundredths of a degree, each
    /// segment once.
    pub net: Vec<i32>,
}

/// Summarise the regions of one build.
pub fn summarise(
    regions: &[&TimetableFile],
    stations: usize,
    window_start: String,
    window_days: usize,
) -> Summary {
    let mut running = vec![vec![0u32; SLOTS]; window_days];
    let mut lines = BTreeSet::new();
    let mut segments = BTreeSet::new();
    for tt in regions {
        let ends: Vec<u32> = tt
            .patterns
            .iter()
            .map(|p| p.stop_times().last().map_or(0, |s| s.arrival))
            .collect();
        let mut used = vec![false; tt.routes.len()];
        for t in &tt.trips {
            if let Some(u) = used.get_mut(t.route as usize) {
                *u = true;
            }
            let end = t.start + ends.get(t.pattern as usize).copied().unwrap_or(0);
            for (d, row) in running.iter_mut().enumerate() {
                if t.days >> d & 1 == 0 {
                    continue;
                }
                // Each half hour of the day whose middle the trip spans
                // (past midnight: below).
                let mut s = t.start.saturating_sub(SLOT_S / 2).div_ceil(SLOT_S);
                while (s as usize) < SLOTS && s * SLOT_S + SLOT_S / 2 < end {
                    row[s as usize] += 1;
                    s += 1;
                }
            }
        }
        // Trips past midnight: their slots on the following days.
        for t in &tt.trips {
            let end = t.start + ends.get(t.pattern as usize).copied().unwrap_or(0);
            if end <= SLOTS as u32 * SLOT_S {
                continue;
            }
            for d in 0..window_days {
                if t.days >> d & 1 == 0 {
                    continue;
                }
                let mut s = t
                    .start
                    .saturating_sub(SLOT_S / 2)
                    .div_ceil(SLOT_S)
                    .max(SLOTS as u32);
                while s * SLOT_S + SLOT_S / 2 < end {
                    let day = d + s as usize / SLOTS;
                    if day < window_days {
                        running[day][s as usize % SLOTS] += 1;
                    }
                    s += 1;
                }
            }
        }
        // A line by its name: some feeds give every service its own route
        // (Slovakia's, Hungary's), the same line in several regions too.
        for (r, u) in tt.routes.iter().zip(&used) {
            if *u {
                let name = format!("{}|{}", r.short_name.trim(), r.long_name.trim());
                lines.insert(if name == "|" { r.id.clone() } else { name });
            }
        }
        let snap = |v: i32| -> i32 {
            // e5 → hundredths of a degree, to the nearest GRID.
            let h = (f64::from(v) / 1_000.0).round() as i32;
            (h as f64 / f64::from(GRID)).round() as i32 * GRID
        };
        for p in &tt.patterns {
            for w in p.stops.windows(2) {
                let (Some(a), Some(b)) = (tt.stops.get(w[0] as usize), tt.stops.get(w[1] as usize))
                else {
                    continue;
                };
                let a = (snap(a.lon_e5), snap(a.lat_e5));
                let b = (snap(b.lon_e5), snap(b.lat_e5));
                if a != b {
                    segments.insert(if a < b { (a, b) } else { (b, a) });
                }
            }
        }
    }
    let net = segments
        .into_iter()
        .flat_map(|((x1, y1), (x2, y2))| [x1, y1, x2, y2])
        .collect();
    Summary {
        window_start,
        stations,
        lines: lines.len(),
        running,
        net,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use trainradar_proto::refdata::{Header, PatternRec, RouteRec, StopRec, TripRec};

    fn tt() -> TimetableFile {
        let stop = |id: &str, lat: f64, lon: f64| StopRec {
            id: id.into(),
            name: id.into(),
            lat_e5: (lat * 1e5) as i32,
            lon_e5: (lon * 1e5) as i32,
        };
        let route = |id: &str| RouteRec {
            id: id.into(),
            short_name: id.into(),
            long_name: String::new(),
            color: None,
            text_color: None,
        };
        // One hour from A to B, through C.
        let p = PatternRec::from_absolute(
            vec![0, 1, 2],
            &[(0, 0), (1_800, 1_800), (3_600, 3_600)],
            &[0, 30_000, 60_000],
            None,
            0,
        );
        let trip = |start: u32, days: u64| TripRec {
            route: 0,
            pattern: 0,
            start,
            days,
            service: None,
            id_rest: format!("t{start}"),
            headsign: String::new(),
            short_name: String::new(),
        };
        TimetableFile {
            header: Header::new(0, 2, 0),
            region: "x".into(),
            operator: String::new(),
            live: false,
            stops: vec![
                stop("A", 40.0, -3.7),
                stop("C", 40.2, -3.7),
                stop("B", 40.4, -3.7),
            ],
            routes: vec![route("R1"), route("R2"), route("R1")],
            shapes: vec![],
            patterns: vec![p],
            services: vec![],
            // 08:00 daily; 23:30 on day 0 only (runs past midnight).
            trips: vec![trip(8 * 3_600, 0b11), trip(23 * 3_600 + 1_800, 0b01)],
        }
    }

    #[test]
    fn running_by_half_hour_lines_and_network() {
        let mut t = tt();
        // The night trip on another route of the same name: one line.
        t.trips[1].route = 2;
        let s = summarise(&[&t], 3, "2026-11-26".into(), 2);
        assert_eq!(s.stations, 3);
        // Only R1 has trips (two routes of that name).
        assert_eq!(s.lines, 1);
        // 08:00-09:00: the middles of 08:00-08:30 and 08:30-09:00.
        assert_eq!(s.running[0][16], 1);
        assert_eq!(s.running[0][17], 1);
        assert_eq!(s.running[0][18], 0);
        assert_eq!(s.running[1][16], 1);
        // 23:30-00:30: day 0's last half hour, day 1's first.
        assert_eq!(s.running[0][47], 1);
        assert_eq!(s.running[1][0], 1);
        // Two segments, snapped to 0.02°: A-C and C-B.
        assert_eq!(s.net.len(), 8);
        assert!(s.net.iter().all(|v| v % GRID == 0));
    }
}
