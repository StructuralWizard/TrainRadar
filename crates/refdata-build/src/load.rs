//! Load a GTFS feed into memory, keeping only trips that run in the window.

use crate::calendar::{Window, parse_time};
use crate::gtfs_io::{Gtfs, Result, Table};
use std::collections::HashMap;
use std::io::{Read, Seek};
use trainradar_proto::LatLon;

#[derive(Debug, Clone)]
pub struct Stop {
    pub id: String,
    pub name: String,
    pub coord: LatLon,
}

#[derive(Debug, Clone)]
pub struct Route {
    pub id: String,
    pub short_name: String,
    pub long_name: String,
    pub color: Option<u32>,
    pub text_color: Option<u32>,
    pub route_type: String,
}

#[derive(Debug, Clone)]
pub struct Trip {
    pub id: String,
    pub route: usize,
    pub service: String,
    pub headsign: String,
    pub short_name: String,
    pub shape_id: String,
    pub days: u16,
    /// (stop index, arrival, departure), in stop_sequence order.
    pub stop_times: Vec<(usize, u32, u32)>,
}

#[derive(Debug, Default)]
pub struct Feed {
    pub stops: Vec<Stop>,
    pub routes: Vec<Route>,
    pub trips: Vec<Trip>,
    pub shapes: HashMap<String, Vec<LatLon>>,
    pub stats: LoadStats,
}

#[derive(Debug, Default)]
pub struct LoadStats {
    pub trips_total: usize,
    pub trips_outside_window: usize,
    pub trips_skipped_bus: usize,
    pub trips_too_short: usize,
    pub stop_time_rows: usize,
}

fn parse_color(s: &str) -> Option<u32> {
    (s.len() == 6)
        .then(|| u32::from_str_radix(s, 16).ok())
        .flatten()
}

fn coord(t: &Table, r: &[String], lat: Option<usize>, lon: Option<usize>) -> Option<LatLon> {
    let lat: f64 = t.get(r, lat).parse().ok()?;
    let lon: f64 = t.get(r, lon).parse().ok()?;
    (lat.abs() <= 90.0 && lon.abs() <= 180.0 && (lat, lon) != (0.0, 0.0))
        .then(|| LatLon::new(lat, lon))
}

/// GTFS `route_type` 3 is bus: Renfe uses it for replacement and connecting
/// buses, which are not trains and have no realtime positions.
const BUS_ROUTE_TYPE: &str = "3";

pub fn load<R: Read + Seek>(g: &mut Gtfs<R>, window: &Window) -> Result<Feed> {
    let mut feed = Feed::default();

    let stops = g.table("stops.txt")?.ok_or("stops.txt missing")?;
    let (sid, sname) = (
        stops.require("stops.txt", "stop_id")?,
        stops.col("stop_name"),
    );
    let (slat, slon) = (stops.col("stop_lat"), stops.col("stop_lon"));
    let mut stop_idx = HashMap::new();
    for r in &stops.rows {
        if let Some(c) = coord(&stops, r, slat, slon) {
            stop_idx.insert(r[sid].clone(), feed.stops.len());
            feed.stops.push(Stop {
                id: r[sid].clone(),
                name: stops.get(r, sname).to_owned(),
                coord: c,
            });
        }
    }

    let routes = g.table("routes.txt")?.ok_or("routes.txt missing")?;
    let rid = routes.require("routes.txt", "route_id")?;
    let mut route_idx = HashMap::new();
    for r in &routes.rows {
        route_idx.insert(r[rid].clone(), feed.routes.len());
        feed.routes.push(Route {
            id: r[rid].clone(),
            short_name: routes.get(r, routes.col("route_short_name")).to_owned(),
            long_name: routes.get(r, routes.col("route_long_name")).to_owned(),
            color: parse_color(routes.get(r, routes.col("route_color"))),
            text_color: parse_color(routes.get(r, routes.col("route_text_color"))),
            route_type: routes.get(r, routes.col("route_type")).to_owned(),
        });
    }

    let masks = window.service_masks(
        g.table("calendar.txt")?.as_ref(),
        g.table("calendar_dates.txt")?.as_ref(),
    );

    let trips = g.table("trips.txt")?.ok_or("trips.txt missing")?;
    let (tid, troute, tsvc) = (
        trips.require("trips.txt", "trip_id")?,
        trips.require("trips.txt", "route_id")?,
        trips.require("trips.txt", "service_id")?,
    );
    let mut trip_idx = HashMap::new();
    for r in &trips.rows {
        feed.stats.trips_total += 1;
        let Some(&route) = route_idx.get(&r[troute]) else {
            continue;
        };
        if feed.routes[route].route_type == BUS_ROUTE_TYPE {
            feed.stats.trips_skipped_bus += 1;
            continue;
        }
        let days = masks.get(&r[tsvc]).copied().unwrap_or(0);
        if days == 0 {
            feed.stats.trips_outside_window += 1;
            continue;
        }
        trip_idx.insert(r[tid].clone(), feed.trips.len());
        feed.trips.push(Trip {
            id: r[tid].clone(),
            route,
            service: r[tsvc].clone(),
            headsign: trips.get(r, trips.col("trip_headsign")).to_owned(),
            short_name: trips.get(r, trips.col("trip_short_name")).to_owned(),
            shape_id: trips.get(r, trips.col("shape_id")).to_owned(),
            days,
            stop_times: Vec::new(),
        });
    }

    // stop_times.txt is ~300 MB for Cercanías: stream it, keep window trips only.
    let text = g.text("stop_times.txt")?.ok_or("stop_times.txt missing")?;
    let mut rdr = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(text.as_bytes());
    let h = rdr.headers()?.clone();
    let col = |n: &str| {
        h.iter()
            .position(|x| x.eq_ignore_ascii_case(n))
            .ok_or_else(|| format!("stop_times.txt: missing column `{n}`"))
    };
    let (ct, ca, cd, cs, cq) = (
        col("trip_id")?,
        col("arrival_time")?,
        col("departure_time")?,
        col("stop_id")?,
        col("stop_sequence")?,
    );
    let mut seqs: Vec<Vec<(u32, usize, u32, u32)>> = vec![Vec::new(); feed.trips.len()];
    let mut rec = csv::StringRecord::new();
    while rdr.read_record(&mut rec)? {
        feed.stats.stop_time_rows += 1;
        let Some(&t) = trip_idx.get(&rec[ct]) else {
            continue;
        };
        let Some(&stop) = stop_idx.get(&rec[cs]) else {
            continue;
        };
        let (Some(a), Some(d)) = (parse_time(&rec[ca]), parse_time(&rec[cd])) else {
            continue;
        };
        let seq = rec[cq].parse().unwrap_or(u32::MAX);
        seqs[t].push((seq, stop, a, d.max(a)));
    }
    drop(text);
    for (trip, mut st) in feed.trips.iter_mut().zip(seqs) {
        st.sort_by_key(|s| s.0);
        trip.stop_times = st.into_iter().map(|(_, s, a, d)| (s, a, d)).collect();
    }
    let before = feed.trips.len();
    feed.trips.retain(|t| t.stop_times.len() >= 2);
    feed.stats.trips_too_short = before - feed.trips.len();

    if let Some(shapes) = g.table("shapes.txt")? {
        let (id, la, lo, sq) = (
            shapes.col("shape_id"),
            shapes.col("shape_pt_lat"),
            shapes.col("shape_pt_lon"),
            shapes.col("shape_pt_sequence"),
        );
        let mut raw: HashMap<String, Vec<(u32, LatLon)>> = HashMap::new();
        for r in &shapes.rows {
            if let Some(c) = coord(&shapes, r, la, lo) {
                let seq = shapes.get(r, sq).parse().unwrap_or(u32::MAX);
                raw.entry(shapes.get(r, id).to_owned())
                    .or_default()
                    .push((seq, c));
            }
        }
        for (k, mut v) in raw {
            v.sort_by_key(|p| p.0);
            feed.shapes.insert(k, v.into_iter().map(|p| p.1).collect());
        }
    }
    Ok(feed)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    /// Build an in-memory GTFS zip from (file name, contents) pairs.
    pub fn zip_of(files: &[(&str, &str)]) -> Gtfs<Cursor<Vec<u8>>> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (name, body) in files {
                w.start_file(*name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        buf.set_position(0);
        Gtfs::from_reader(buf).unwrap()
    }

    /// A tiny two-line commuter network around Madrid (route prefix "10").
    pub fn sample_gtfs() -> Gtfs<Cursor<Vec<u8>>> {
        zip_of(&[
            (
                "stops.txt",
                "stop_id,stop_name,stop_lat,stop_lon\n\
                 A, Atocha ,40.4065,-3.6895\n\
                 B,Mendez Alvaro,40.3953,-3.6785\n\
                 C,Villaverde,40.3460,-3.7110\n\
                 X,Nowhere,0,0\n",
            ),
            (
                "routes.txt",
                "route_id,route_short_name,route_long_name,route_type,route_color\n\
                 10T0001C3,C3,Atocha-Villaverde,2,943F90\n\
                 10T0002C3,C3,Villaverde-Atocha,2,943F90\n\
                 10T0099BUS,BUS,Bus,3,\n",
            ),
            (
                "calendar.txt",
                "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n\
                 1004D,0,0,0,0,0,0,1,20261101,20261101\n\
                 OLD,1,1,1,1,1,1,1,20200101,20200102\n",
            ),
            (
                "trips.txt",
                "route_id,service_id,trip_id,shape_id\n\
                 10T0001C3,1004D,1004D100C3,10_C3\n\
                 10T0001C3,1004D,1004D102C3,10_C3\n\
                 10T0002C3,1004D,1004D101C3,10_C3\n\
                 10T0001C3,OLD,OLD1C3,10_C3\n\
                 10T0099BUS,1004D,1004D9BUS,\n",
            ),
            (
                "stop_times.txt",
                "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n\
                 1004D100C3,8:00:00,8:00:00,A,1\n\
                 1004D100C3,8:04:00,8:05:00,B,2\n\
                 1004D100C3,8:15:00,8:15:00,C,3\n\
                 1004D102C3,8:15:00,8:15:00,C,3\n\
                 1004D102C3,8:04:00,8:05:00,B,2\n\
                 1004D102C3,8:00:00,8:00:00,A,1\n\
                 1004D101C3,24:10:00,24:10:00,C,1\n\
                 1004D101C3,24:20:00,24:20:00,B,2\n\
                 1004D101C3,24:25:00,24:25:00,A,3\n\
                 OLD1C3,8:00:00,8:00:00,A,1\n\
                 OLD1C3,8:10:00,8:10:00,B,2\n\
                 1004D9BUS,8:00:00,8:00:00,A,1\n\
                 1004D9BUS,8:30:00,8:30:00,C,2\n",
            ),
            (
                "shapes.txt",
                "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n\
                 10_C3,40.3460,-3.7110,3\n\
                 10_C3,40.4065,-3.6895,1\n\
                 10_C3,40.3953,-3.6785,2\n",
            ),
        ])
    }

    #[test]
    fn loads_window_trips_in_sequence_order() {
        let w = Window {
            start: crate::calendar::parse_date("20261031").unwrap(),
            days: 8,
        };
        let f = load(&mut sample_gtfs(), &w).unwrap();
        assert_eq!(f.stops.len(), 3, "stop with 0,0 coords dropped");
        assert_eq!(f.stops[0].name, "Atocha", "padding trimmed");
        assert_eq!(f.trips.len(), 3);
        assert_eq!(f.stats.trips_outside_window, 1);
        assert_eq!(f.stats.trips_skipped_bus, 1);
        let t = f.trips.iter().find(|t| t.id == "1004D102C3").unwrap();
        assert_eq!(t.days, 0b10);
        let order: Vec<_> = t
            .stop_times
            .iter()
            .map(|s| f.stops[s.0].id.as_str())
            .collect();
        assert_eq!(order, ["A", "B", "C"]);
        assert_eq!(t.stop_times[1], (1, 8 * 3600 + 240, 8 * 3600 + 300));
        assert_eq!(f.routes[0].color, Some(0x943F90));
        let shape = &f.shapes["10_C3"];
        assert_eq!(
            shape[0],
            LatLon::new(40.4065, -3.6895),
            "sorted by sequence"
        );
    }
}
