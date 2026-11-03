//! Turn loaded feeds into compact `.bin` files plus a `manifest.json`.

use crate::calendar::Window;
use crate::load::{Feed, Trip};
use crate::osm::Router;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use trainradar_proto::LatLon;
use trainradar_proto::geo::{Polyline, haversine_m, simplify};
use trainradar_proto::refdata::{
    GridIndex, Header, LegInfo, NO_LEG, PatternRec, Profile, RegionRec, RouteRec, SERVICE_COMMUTER,
    SERVICE_LONG_DISTANCE, ShapeRec, StationRec, StationsFile, StopRec, TimetableFile, TripRec,
    to_e5,
};

/// Shape simplification tolerance. 5 m is invisible on a phone map at any zoom
/// where trains are distinguishable, and removes most shape points.
pub const SIMPLIFY_TOLERANCE_M: f64 = 5.0;
/// OpenStreetMap track is mapped very densely. 15 m is under one pixel up to
/// zoom 12 and still smooth on curves when zoomed in.
pub const OSM_SIMPLIFY_TOLERANCE_M: f64 = 15.0;
/// A stop further than this from its trip's shape means the shape is wrong
/// for that trip; fall back to straight segments.
pub const MAX_STOP_OFFSET_M: f64 = 400.0;

/// Region code for AV/LD/MD.
pub const LONG_DISTANCE: &str = "ld";
/// Region code for OUIGO (timetable only, from the NAP).
pub const OUIGO: &str = "ouigo";

/// OUIGO's GTFS (a UIC MERITS export) uses 9-digit UIC station codes; the
/// last five digits are the Adif code Renfe uses (`007160000` → `60000`).
pub fn uic_to_adif(id: &str) -> String {
    if id.len() == 9 && id.starts_with("0071") && id.bytes().all(|b| b.is_ascii_digit()) {
        id[4..].to_owned()
    } else {
        id.to_owned()
    }
}

/// Make a loaded OUIGO feed look like the others: Adif station codes, the
/// brand as line name, and plain train numbers ("TGV 6477" → "6477").
pub fn normalise_ouigo(feed: &mut Feed) {
    for s in &mut feed.stops {
        s.id = uic_to_adif(&s.id);
    }
    for r in &mut feed.routes {
        r.short_name = "OUIGO".into();
    }
    for t in &mut feed.trips {
        t.short_name = t.short_name.chars().filter(char::is_ascii_digit).collect();
    }
}

/// Display names for Cercanías núcleo codes (the leading digits of
/// `route_id`). Unknown codes fall back to "Núcleo NN".
const NUCLEO_NAMES: &[(&str, &str)] = &[
    ("10", "Madrid"),
    ("20", "Asturias"),
    ("30", "Sevilla"),
    ("31", "Cádiz"),
    ("32", "Málaga"),
    ("40", "Valencia"),
    ("41", "Murcia/Alicante"),
    ("45", "Cartagena"),
    ("46", "Ferrol"),
    ("47", "León"),
    ("51", "Rodalies de Catalunya"),
    ("60", "Bilbao"),
    ("61", "San Sebastián"),
    ("62", "Santander"),
    ("70", "Zaragoza"),
];

pub fn region_name(code: &str) -> String {
    if code == LONG_DISTANCE {
        return "Alta Velocidad, Larga y Media Distancia".into();
    }
    if code == OUIGO {
        return "OUIGO (según horario)".into();
    }
    NUCLEO_NAMES
        .iter()
        .find(|(c, _)| *c == code)
        .map_or_else(|| format!("Núcleo {code}"), |(_, n)| (*n).to_owned())
}

/// Núcleo code of a Cercanías route: its leading digits (`10T0001C1` → `10`).
pub fn nucleo_of(route_id: &str) -> Option<&str> {
    let n = route_id.bytes().take_while(u8::is_ascii_digit).count();
    (n > 0).then(|| &route_id[..n])
}

/// Statistics for the build report.
#[derive(Debug, Default, Clone, Serialize)]
pub struct RegionStats {
    pub trips: usize,
    pub patterns: usize,
    pub stops: usize,
    pub routes: usize,
    pub shapes: usize,
    pub shape_points_in: usize,
    pub shape_points_out: usize,
    /// Patterns on a GTFS shape, on OpenStreetMap track, or on straight
    /// segments between stops.
    pub patterns_on_shape: usize,
    pub patterns_on_osm: usize,
    pub patterns_straight: usize,
    /// OpenStreetMap legs with a height profile (DEM heights given).
    pub legs_with_profile: usize,
    /// Consecutive stops further apart than [`JUMP_M`]: in a commuter
    /// network that's bad data (data-quality report only).
    #[serde(skip)]
    pub jumps: Vec<String>,
}

/// Consecutive Cercanías stops further apart than this are reported.
pub const JUMP_M: f64 = 60_000.0;

/// Build one region's timetable from a subset of a feed's trips.
pub fn build_timetable(
    feed: &Feed,
    trips: &[&Trip],
    region: &str,
    header: Header,
    mut router: Option<&mut Router<'_>>,
) -> (
    TimetableFile,
    Vec<(ShapeRec, LegInfo, Profile)>,
    RegionStats,
) {
    let mut legs_out: Vec<(ShapeRec, LegInfo, Profile)> = Vec::new();
    let mut st = RegionStats::default();
    let mut tt = TimetableFile {
        header,
        region: region.to_owned(),
        operator: "Renfe".into(),
        live: true,
        stops: vec![],
        routes: vec![],
        shapes: vec![],
        patterns: vec![],
        services: vec![],
        trips: vec![],
    };
    let mut stop_map: HashMap<usize, u32> = HashMap::new();
    let mut route_map: HashMap<usize, u32> = HashMap::new();
    let mut service_map: HashMap<&str, u32> = HashMap::new();
    // (GTFS shape id, reversed) → (index in tt.shapes, polyline)
    let mut shape_map: HashMap<(&str, bool), (u32, Polyline)> = HashMap::new();
    let mut pattern_map: HashMap<PatternRec, u32> = HashMap::new();
    // Cache per (shape, stop sequence): projecting is the slow part.
    type Placed = Option<(u32, u32, Vec<u32>)>;
    let mut placed_cache: HashMap<(&str, Vec<usize>), Placed> = HashMap::new();
    // OpenStreetMap legs per (stop, next stop): (index in legs_out, length m).
    let mut leg_map: HashMap<(usize, usize), Option<(u32, f64)>> = HashMap::new();

    for trip in trips {
        let stops: Vec<u32> = trip
            .stop_times
            .iter()
            .map(|&(s, _, _)| {
                *stop_map.entry(s).or_insert_with(|| {
                    let s = &feed.stops[s];
                    tt.stops.push(StopRec {
                        id: s.id.clone(),
                        name: s.name.clone(),
                        lat_e5: to_e5(s.coord.lat),
                        lon_e5: to_e5(s.coord.lon),
                    });
                    (tt.stops.len() - 1) as u32
                })
            })
            .collect();
        let route = *route_map.entry(trip.route).or_insert_with(|| {
            let r = &feed.routes[trip.route];
            tt.routes.push(RouteRec {
                id: r.id.clone(),
                short_name: r.short_name.clone(),
                long_name: r.long_name.clone(),
                color: r.color,
                text_color: r.text_color,
            });
            (tt.routes.len() - 1) as u32
        });

        let coords: Vec<LatLon> = trip
            .stop_times
            .iter()
            .map(|&(s, _, _)| feed.stops[s].coord)
            .collect();
        let stop_ids: Vec<usize> = trip.stop_times.iter().map(|s| s.0).collect();
        for i in 1..coords.len() {
            let d = haversine_m(coords[i - 1], coords[i]);
            if d > JUMP_M && st.jumps.len() < 20 {
                let (a, b) = (&feed.stops[stop_ids[i - 1]], &feed.stops[stop_ids[i]]);
                let msg = format!(
                    "{} km: {} {} ({:.4},{:.4}) → {} {} ({:.4},{:.4}) on route {} trip {}",
                    (d / 1000.0).round(),
                    a.id,
                    a.name,
                    a.coord.lat,
                    a.coord.lon,
                    b.id,
                    b.name,
                    b.coord.lat,
                    b.coord.lon,
                    feed.routes[trip.route].id,
                    trip.id
                );
                let key = format!("{}>{}", a.id, b.id);
                if !st.jumps.iter().any(|j| j.contains(&key)) {
                    st.jumps.push(format!("{key} {msg}"));
                }
            }
        }

        // Place stops on the trip's shape, trying it forwards then reversed.
        let placed = if feed.shapes.contains_key(&trip.shape_id) {
            placed_cache
                .entry((trip.shape_id.as_str(), stop_ids.clone()))
                .or_insert_with(|| {
                    [false, true].into_iter().find_map(|rev| {
                        let key = (trip.shape_id.as_str(), rev);
                        if let std::collections::hash_map::Entry::Vacant(e) = shape_map.entry(key) {
                            let mut pts = feed.shapes[&trip.shape_id].clone();
                            if rev {
                                pts.reverse();
                            }
                            st.shape_points_in += pts.len();
                            let simple = simplify(&pts, SIMPLIFY_TOLERANCE_M);
                            st.shape_points_out += simple.len();
                            let id = if rev {
                                format!("{}~r", trip.shape_id)
                            } else {
                                trip.shape_id.clone()
                            };
                            tt.shapes.push(ShapeRec::encode(id, &simple));
                            let idx = (tt.shapes.len() - 1) as u32;
                            e.insert((idx, Polyline::new(simple)));
                        }
                        let (idx, line) = &shape_map[&key];
                        place_on_shape(line, &coords, MAX_STOP_OFFSET_M)
                            .map(|(start, cum)| (*idx, start, cum))
                    })
                })
                .clone()
        } else {
            None
        };
        let (shape, shape_start_m, cum, legs) = match placed {
            Some((idx, start, cum)) => (Some(idx), start, cum, Vec::new()),
            // No usable GTFS shape: follow OpenStreetMap track, leg by leg.
            None => match router.as_deref_mut() {
                Some(router) => {
                    let (mut legs, mut cum, mut d, mut any) = (Vec::new(), vec![0u32], 0.0, false);
                    for i in 1..coords.len() {
                        let key = (stop_ids[i - 1], stop_ids[i]);
                        let leg = *leg_map.entry(key).or_insert_with(|| {
                            let (pts, info, heights) =
                                router.route_pair(key.0, key.1, coords[i - 1], coords[i])?;
                            let profile = crate::profile::leg_profile(&pts, &heights);
                            if !profile.deltas.is_empty() {
                                st.legs_with_profile += 1;
                            }
                            let simple = simplify(&pts, OSM_SIMPLIFY_TOLERANCE_M);
                            let rec = ShapeRec::encode(
                                format!("{}>{}", feed.stops[key.0].id, feed.stops[key.1].id),
                                &simple,
                            );
                            // Measure the geometry exactly as the browser decodes it.
                            let len = Polyline::new(rec.points()).length_m();
                            st.shape_points_in += pts.len();
                            st.shape_points_out += simple.len();
                            legs_out.push((rec, info, profile));
                            Some(((legs_out.len() - 1) as u32, len))
                        });
                        match leg {
                            Some((li, len)) => {
                                legs.push(li);
                                d += len;
                                any = true;
                            }
                            None => {
                                legs.push(NO_LEG);
                                d += haversine_m(coords[i - 1], coords[i]);
                            }
                        }
                        cum.push(d.round() as u32);
                    }
                    if any {
                        (None, 0, cum, legs)
                    } else {
                        (None, 0, straight_distances(&coords), Vec::new())
                    }
                }
                None => (None, 0, straight_distances(&coords), Vec::new()),
            },
        };

        let base = trip.stop_times[0].1;
        let times: Vec<(u32, u32)> = trip
            .stop_times
            .iter()
            .map(|&(_, a, d)| (a.saturating_sub(base), d.saturating_sub(base)))
            .collect();
        let mut pat = PatternRec::from_absolute(stops, &times, &cum, shape, shape_start_m);
        pat.legs = legs;
        let next = pattern_map.len() as u32;
        let pattern = *pattern_map.entry(pat.clone()).or_insert_with(|| {
            tt.patterns.push(pat);
            next
        });

        let (service, id_rest) = match trip.id.strip_prefix(trip.service.as_str()) {
            Some(rest) if !trip.service.is_empty() => {
                let n = service_map.len() as u32;
                let s = *service_map.entry(trip.service.as_str()).or_insert_with(|| {
                    tt.services.push(trip.service.clone());
                    n
                });
                (Some(s), rest.to_owned())
            }
            _ => (None, trip.id.clone()),
        };
        tt.trips.push(TripRec {
            route,
            pattern,
            start: base,
            days: trip.days,
            service,
            id_rest,
            headsign: trip.headsign.clone(),
            short_name: trip.short_name.clone(),
        });
    }
    // Pattern counters above count per trip; report per unique pattern instead.
    st.patterns_on_osm = tt.patterns.iter().filter(|p| !p.legs.is_empty()).count();
    st.patterns_on_shape = tt.patterns.iter().filter(|p| p.shape.is_some()).count();
    st.patterns_straight = tt.patterns.len() - st.patterns_on_shape - st.patterns_on_osm;
    tt.trips.sort_by_key(|t| (t.start, t.route));
    st.trips = tt.trips.len();
    st.patterns = tt.patterns.len();
    st.stops = tt.stops.len();
    st.routes = tt.routes.len();
    st.shapes = tt.shapes.len() + legs_out.len();
    (tt, legs_out, st)
}

/// Cumulative straight-line distances between consecutive stops, in metres.
fn straight_distances(coords: &[LatLon]) -> Vec<u32> {
    let mut d = 0.0;
    coords
        .iter()
        .enumerate()
        .map(|(i, &c)| {
            if i > 0 {
                d += haversine_m(coords[i - 1], c);
            }
            d.round() as u32
        })
        .collect()
}

/// Project stops onto a shape in order. Returns the first stop's position on
/// the shape and cumulative distances from it, or `None` if a stop is too far
/// from the shape or the stops don't advance along it.
fn place_on_shape(
    line: &Polyline,
    coords: &[LatLon],
    max_offset_m: f64,
) -> Option<(u32, Vec<u32>)> {
    let mut seg = 0;
    let mut along = Vec::with_capacity(coords.len());
    for &c in coords {
        let p = line.project_from(c, seg)?;
        if p.offset_m > max_offset_m {
            return None;
        }
        if along.last().is_some_and(|&prev| p.along_m + 1.0 < prev) {
            return None;
        }
        seg = p.segment;
        along.push(p.along_m);
    }
    let start = along[0];
    // A trip that doesn't move along the shape is running the other way.
    if coords.len() >= 2 && along[along.len() - 1] - start < 1.0 {
        return None;
    }
    Some((
        start.round() as u32,
        along
            .iter()
            .map(|a| (a - start).max(0.0).round() as u32)
            .collect(),
    ))
}

/// Region code → trips, for one feed.
pub fn split_regions(feed: &Feed, commuter: bool) -> BTreeMap<String, Vec<&Trip>> {
    let mut out: BTreeMap<String, Vec<&Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let code = if commuter {
            match nucleo_of(&feed.routes[t.route].id) {
                Some(c) => c.to_owned(),
                None => continue,
            }
        } else {
            LONG_DISTANCE.to_owned()
        };
        out.entry(code).or_default().push(t);
    }
    out
}

/// Bounding box of a timetable's stops, in 1e-5 degrees.
pub fn bbox_e5(tt: &TimetableFile) -> [i32; 4] {
    let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
    for s in &tt.stops {
        b[0] = b[0].min(s.lat_e5);
        b[1] = b[1].min(s.lon_e5);
        b[2] = b[2].max(s.lat_e5);
        b[3] = b[3].max(s.lon_e5);
    }
    b
}

/// Merge stops of all region timetables into one nationwide station list.
pub fn build_stations(timetables: &[(RegionRec, &TimetableFile)], header: Header) -> StationsFile {
    let mut by_id: BTreeMap<&str, StationRec> = BTreeMap::new();
    for (ri, (region, tt)) in timetables.iter().enumerate() {
        let flag = if region.code == LONG_DISTANCE || region.code == OUIGO {
            SERVICE_LONG_DISTANCE
        } else {
            SERVICE_COMMUTER
        };
        for s in &tt.stops {
            let e = by_id.entry(s.id.as_str()).or_insert_with(|| StationRec {
                id: s.id.clone(),
                name: s.name.clone(),
                lat_e5: s.lat_e5,
                lon_e5: s.lon_e5,
                services: 0,
                regions: vec![],
            });
            // Prefer Renfe's AV/LD/MD name (usually the full official one).
            if region.code == LONG_DISTANCE {
                e.name.clone_from(&s.name);
            }
            e.services |= flag;
            e.regions.push(ri as u16);
        }
    }
    let mut stations: Vec<StationRec> = by_id.into_values().collect();
    let grid = GridIndex::build(
        &mut stations,
        |s| (s.lat_e5, s.lon_e5),
        GridIndex::DEFAULT_CELL_E5,
    );
    StationsFile {
        header,
        regions: timetables.iter().map(|(r, _)| r.clone()).collect(),
        stations,
        grid,
    }
}

/// Stable 64-bit FNV-1a, used only for cache-busting file names.
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")[..10].to_owned()
}

/// `manifest.json`: the only un-hashed file; the web app reads it first.
#[derive(Debug, Serialize)]
pub struct Manifest {
    pub format: u16,
    pub generated_at: i64,
    pub window_start: String,
    pub window_days: u8,
    pub sources: Vec<Source>,
    pub stations: FileEntry,
    pub regions: Vec<RegionEntry>,
    pub attribution: &'static str,
}

#[derive(Debug, Serialize, Clone)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub etag: String,
    pub last_modified: String,
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub file: String,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct RegionEntry {
    pub code: String,
    pub name: String,
    /// [min lat, min lon, max lat, max lon] in degrees.
    pub bbox: [f64; 4],
    pub file: String,
    pub bytes: usize,
    /// OpenStreetMap track for this region, loaded after the timetable.
    pub geometry: Option<FileEntry>,
    pub operator: String,
    /// False for timetable-only operators (no live positions).
    pub live: bool,
    pub stats: RegionStats,
}

pub const ATTRIBUTION: &str = "Datos: © Renfe Operadora, CC BY 4.0 (data.renfe.com). \
     OUIGO: horario del Punto de Acceso Nacional, Powered by MITRAMS (datos explotados). \
     Vías: © colaboradores de OpenStreetMap, ODbL. Procesados y combinados por TrainRadar.";

pub fn window_header(w: &Window, generated_at: i64) -> Header {
    Header::new(w.start as u32, w.days, generated_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::{Window, parse_date};
    use crate::load::{load, tests::sample_gtfs};
    use trainradar_proto::refdata::{decode_file, from_e5};
    use trainradar_proto::{decode, encode};

    fn sample() -> Feed {
        let w = Window {
            start: parse_date("20261031").unwrap(),
            days: 8,
        };
        load(&mut sample_gtfs(), &w).unwrap()
    }

    #[test]
    fn ouigo_station_codes_map_to_adif() {
        assert_eq!(uic_to_adif("007160000"), "60000");
        assert_eq!(uic_to_adif("007104040"), "04040");
        assert_eq!(uic_to_adif("60000"), "60000");
        assert_eq!(
            uic_to_adif("008700014"),
            "008700014",
            "not Spanish: unchanged"
        );
    }

    #[test]
    fn nucleo_codes_and_names() {
        assert_eq!(nucleo_of("10T0001C1"), Some("10"));
        assert_eq!(nucleo_of("51T0001R1"), Some("51"));
        assert_eq!(nucleo_of("T1"), None);
        assert_eq!(region_name("51"), "Rodalies de Catalunya");
        assert_eq!(region_name("99"), "Núcleo 99");
    }

    #[test]
    fn builds_patterns_shapes_and_compact_trip_ids() {
        let feed = sample();
        let regions = split_regions(&feed, true);
        assert_eq!(regions.keys().collect::<Vec<_>>(), ["10"]);
        let (tt, _legs, st) =
            build_timetable(&feed, &regions["10"], "10", Header::new(0, 8, 0), None);

        // Trips 100 and 102 share one pattern; 101 runs the other way.
        assert_eq!(st.trips, 3);
        assert_eq!(st.patterns, 2);
        assert_eq!(st.patterns_on_shape, 2, "both directions use the shape");
        assert_eq!(st.shapes, 2, "forward + reversed copy");
        assert!(tt.shapes.iter().any(|s| s.id == "10_C3~r"));

        // Trip ids are stored without their service prefix.
        assert_eq!(tt.services, ["1004D"]);
        let t = tt.trips.iter().find(|t| t.id_rest == "100C3").unwrap();
        assert_eq!(tt.trip_id(t), "1004D100C3");
        assert_eq!(t.start, 8 * 3600);

        // Distances follow the shape and increase along the trip.
        let p = &tt.patterns[t.pattern as usize];
        let times = p.stop_times();
        assert_eq!(
            times
                .iter()
                .map(|s| (s.arrival, s.departure))
                .collect::<Vec<_>>(),
            [(0, 0), (240, 300), (900, 900)]
        );
        let total = times[2].dist_m;
        assert!(
            (7_000..9_000).contains(&total),
            "{total} m Atocha–Villaverde"
        );

        // Overnight trip keeps its >24 h start time.
        assert!(tt.trips.iter().any(|t| t.start == 24 * 3600 + 600));

        // The file survives encode/decode.
        let back: TimetableFile = decode(&encode(&tt).unwrap()).unwrap();
        assert_eq!(back, tt);
    }

    #[test]
    fn falls_back_to_straight_segments_without_shapes() {
        let mut feed = sample();
        feed.shapes.clear();
        let trips: Vec<&Trip> = feed.trips.iter().collect();
        let (tt, _legs, st) =
            build_timetable(&feed, &trips, LONG_DISTANCE, Header::new(0, 8, 0), None);
        assert_eq!(st.shapes, 0);
        assert_eq!(st.patterns_straight, st.patterns);
        let d = tt.patterns[0].stop_times()[1].dist_m;
        let a = tt.stops[tt.patterns[0].stops[0] as usize].coord();
        let b = tt.stops[tt.patterns[0].stops[1] as usize].coord();
        assert_eq!(d, haversine_m(a, b).round() as u32);
    }

    #[test]
    fn routes_shapeless_trips_along_osm_track() {
        use crate::load::tests::zip_of;
        use crate::osm::{Router, tests::sample_graph};
        // West end of line 1 → west end of line 2 (stops ~2.2 km apart; the
        // track goes round via the east end, ~19 km).
        let mut gtfs = zip_of(&[
            (
                "stops.txt",
                "stop_id,stop_name,stop_lat,stop_lon\nP,P,40.0003,-3.7\nQ,Q,40.0197,-3.7\n",
            ),
            (
                "routes.txt",
                "route_id,route_short_name,route_type\nR,MD,2\n",
            ),
            (
                "calendar.txt",
                "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,1,1,20260101,20261231\n",
            ),
            ("trips.txt", "route_id,service_id,trip_id\nR,S,T1\n"),
            (
                "stop_times.txt",
                "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,10:00:00,10:00:00,P,1\nT1,10:20:00,10:20:00,Q,2\n",
            ),
        ]);
        let w = Window {
            start: parse_date("20261101").unwrap(),
            days: 1,
        };
        let feed = load(&mut gtfs, &w).unwrap();
        let graph = sample_graph();
        let mut router = Router::new(&graph);
        let trips: Vec<&Trip> = feed.trips.iter().collect();
        let (tt, legs, st) = build_timetable(
            &feed,
            &trips,
            LONG_DISTANCE,
            Header::new(0, 1, 0),
            Some(&mut router),
        );
        assert_eq!(st.patterns_on_osm, 1);
        assert_eq!(tt.patterns[0].legs, [0]);
        assert_eq!(legs[0].0.id, "P>Q");
        let d = tt.patterns[0].stop_times()[1].dist_m;
        assert!(
            (18_000..20_000).contains(&d),
            "{d} m along track, not 2.2 km straight"
        );
    }

    #[test]
    fn rejects_shape_far_from_stops() {
        let line = Polyline::new(vec![LatLon::new(41.0, -3.0), LatLon::new(41.1, -3.0)]);
        let stops = [LatLon::new(40.40, -3.69), LatLon::new(40.35, -3.71)];
        assert!(place_on_shape(&line, &stops, MAX_STOP_OFFSET_M).is_none());
    }

    #[test]
    fn stations_merge_services_and_index() {
        let feed = sample();
        let regions = split_regions(&feed, true);
        let (cer, _, _) = build_timetable(&feed, &regions["10"], "10", Header::new(0, 8, 0), None);
        let all: Vec<&Trip> = feed.trips.iter().take(1).collect();
        let (ld, _, _) = build_timetable(&feed, &all, LONG_DISTANCE, Header::new(0, 8, 0), None);
        let rec = |code: &str, tt: &TimetableFile| RegionRec {
            code: code.into(),
            name: region_name(code),
            bbox_e5: bbox_e5(tt),
        };
        let st = build_stations(
            &[(rec("ld", &ld), &ld), (rec("10", &cer), &cer)],
            Header::new(0, 8, 0),
        );
        assert_eq!(st.stations.len(), 3);
        let atocha = st.stations.iter().find(|s| s.id == "A").unwrap();
        assert_eq!(atocha.services, SERVICE_LONG_DISTANCE | SERVICE_COMMUTER);
        assert_eq!(atocha.regions, [0, 1]);

        let me = LatLon::new(40.40, -3.685);
        let near = st
            .grid
            .nearest(&st.stations, StationRec::coord, me, 1, 5_000.0);
        assert_eq!(st.stations[near[0].0].id, "B");
        let bytes = encode(&st).unwrap();
        assert_eq!(decode_file::<StationsFile>(&bytes).unwrap(), st);
        assert!(from_e5(st.regions[1].bbox_e5[0]) > 40.3);
    }

    #[test]
    fn content_hash_is_stable() {
        assert_eq!(content_hash(b"trainradar"), content_hash(b"trainradar"));
        assert_ne!(content_hash(b"a"), content_hash(b"b"));
        assert_eq!(content_hash(b"").len(), 10);
    }
}
