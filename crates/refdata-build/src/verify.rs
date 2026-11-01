//! `refdata-build verify DIR`: decode every file listed in `manifest.json` and
//! check internal references, so a bad build fails CI instead of the browser.

use crate::gtfs_io::Result;
use std::path::Path;
use trainradar_proto::refdata::{StationsFile, TimetableFile, decode_file};

pub fn run(dir: &Path) -> Result<()> {
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json"))?)?;
    let file = |v: &serde_json::Value| -> Result<Vec<u8>> {
        let name = v["file"].as_str().ok_or("manifest: missing file name")?;
        Ok(std::fs::read(dir.join(name))?)
    };

    let st: StationsFile = decode_file(&file(&manifest["stations"])?)?;
    check_stations(&st)?;
    println!(
        "ok  stations: {} stations, {} regions",
        st.stations.len(),
        st.regions.len()
    );

    for r in manifest["regions"]
        .as_array()
        .ok_or("manifest: no regions")?
    {
        let tt: TimetableFile = decode_file(&file(r)?)?;
        check_timetable(&tt)?;
        println!(
            "ok  {}: {} trips, {} patterns, {} stops",
            tt.region,
            tt.trips.len(),
            tt.patterns.len(),
            tt.stops.len()
        );
    }
    Ok(())
}

fn ensure(cond: bool, msg: impl FnOnce() -> String) -> Result<()> {
    if cond { Ok(()) } else { Err(msg().into()) }
}

pub fn check_stations(st: &StationsFile) -> Result<()> {
    let n = st.stations.len();
    ensure(
        st.grid
            .cells
            .windows(2)
            .all(|w| w[0].key < w[1].key && w[0].start < w[1].start),
        || "grid cells not sorted".into(),
    )?;
    ensure(st.grid.cells.first().is_none_or(|c| c.start == 0), || {
        "grid must start at 0".into()
    })?;
    ensure(st.grid.cells.iter().all(|c| (c.start as usize) < n), || {
        "grid start out of range".into()
    })?;
    for s in &st.stations {
        ensure(s.services != 0, || {
            format!("station {} has no service", s.id)
        })?;
        ensure(
            s.regions.iter().all(|&r| (r as usize) < st.regions.len()),
            || format!("station {} has a bad region", s.id),
        )?;
    }
    Ok(())
}

pub fn check_timetable(tt: &TimetableFile) -> Result<()> {
    let window_mask = if tt.header.window_days >= 16 {
        u16::MAX
    } else {
        (1u16 << tt.header.window_days) - 1
    };
    for (i, p) in tt.patterns.iter().enumerate() {
        let n = p.stops.len();
        ensure(n >= 2, || {
            format!("{}: pattern {i} has {n} stops", tt.region)
        })?;
        ensure(
            p.run.len() == n && p.dwell.len() == n && p.dist_m.len() == n,
            || format!("{}: pattern {i} has mismatched arrays", tt.region),
        )?;
        ensure(
            p.stops.iter().all(|&s| (s as usize) < tt.stops.len()),
            || format!("{}: pattern {i} has a bad stop index", tt.region),
        )?;
        ensure(
            p.shape.is_none_or(|s| (s as usize) < tt.shapes.len()),
            || format!("{}: pattern {i} has a bad shape index", tt.region),
        )?;
    }
    for t in &tt.trips {
        let id = tt.trip_id(t);
        ensure((t.pattern as usize) < tt.patterns.len(), || {
            format!("{id}: bad pattern")
        })?;
        ensure((t.route as usize) < tt.routes.len(), || {
            format!("{id}: bad route")
        })?;
        ensure(
            t.service.is_none_or(|s| (s as usize) < tt.services.len()),
            || format!("{id}: bad service"),
        )?;
        ensure(t.days != 0 && t.days & !window_mask == 0, || {
            format!("{id}: days outside window")
        })?;
    }
    for s in &tt.shapes {
        ensure(s.deltas.len() % 2 == 0 && s.deltas.len() >= 4, || {
            format!("{}: shape {} is malformed", tt.region, s.id)
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::{build_timetable, split_regions};
    use crate::calendar::{Window, parse_date};
    use crate::load::{load, tests::sample_gtfs};
    use trainradar_proto::refdata::Header;

    #[test]
    fn built_timetable_verifies_and_corruption_is_caught() {
        let w = Window {
            start: parse_date("20261031").unwrap(),
            days: 8,
        };
        let feed = load(&mut sample_gtfs(), &w).unwrap();
        let regions = split_regions(&feed, true);
        let (mut tt, _) = build_timetable(&feed, &regions["10"], "10", Header::new(0, 8, 0), None);
        check_timetable(&tt).unwrap();
        tt.trips[0].days = 1 << 9;
        assert!(check_timetable(&tt).is_err());
    }
}
