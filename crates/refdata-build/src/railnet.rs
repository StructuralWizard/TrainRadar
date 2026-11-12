//! The rail network drawn on the map, from OpenStreetMap track.
//!
//! - Every way is classified by its own tags as high speed (AV), conventional
//!   or metre gauge ([`classify`]), so parallel AV and conventional track stay
//!   separate sections, each with its kind.
//! - Renfe stations (the live map's `estaciones.geojson`) are projected onto
//!   the nearest track of each kind close by, and the track is cut there, so
//!   lines pass exactly through the station's point on the track.
//! - The network is then cut into sections between junctions and stations
//!   ([`RailGraph::sections`]) and simplified for the phone.
//!
//! OSM data © OpenStreetMap contributors, ODbL 1.0.

use crate::gtfs_io::Result;
use crate::osm::RailGraph;
use std::collections::HashMap;
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;

/// Kind of track, from its own OSM tags (never from the trains that use it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    /// `highspeed=yes`, or standard gauge (1435 mm) in Spain (not elsewhere:
    /// in France and Great Britain it's the ordinary network).
    Av,
    /// Iberian gauge (1668 mm), and standard gauge outside Spain.
    Conv,
    /// Metre gauge (1000 mm): ex-FEVE and regional narrow-gauge lines.
    Metric,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Av, Kind::Conv, Kind::Metric];

    /// Stored in the network file: 1 AV, 2 conventional, 3 metre gauge.
    pub fn code(self) -> u8 {
        match self {
            Kind::Av => 1,
            Kind::Conv => 2,
            Kind::Metric => 3,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Kind::Av => "av",
            Kind::Conv => "conv",
            Kind::Metric => "metric",
        }
    }
}

/// What we keep of an OSM way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WayClass {
    pub kind: Kind,
    /// More than one gauge on the same track (e.g. "1668;1435", third rail).
    pub mixed: bool,
    /// Drawn on the map. Service track (`service=*`: yards, sidings, spurs,
    /// crossovers) isn't, but trains can use it so lines stay connected, and
    /// the bits that close a gap in a line at a station are drawn
    /// ([`RailGraph::bridge_station_gaps`]).
    pub drawn: bool,
    /// Track in place but out of use (`railway=disused`), e.g. closed for works.
    pub disused: bool,
}

/// Why a way is left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Skip {
    /// Not `railway=rail`, `narrow_gauge` or `disused`.
    NotTrack,
    /// Abandoned, razed or demolished.
    Lifecycle,
    /// Industrial, military or test track.
    Usage,
    /// Only gauges under 1000 mm (tourist and park railways).
    Gauge,
}

impl Skip {
    pub fn label(self) -> &'static str {
        match self {
            Skip::NotTrack => "not railway=rail/narrow_gauge/disused",
            Skip::Lifecycle => "abandoned/razed",
            Skip::Usage => "usage=industrial/military/test",
            Skip::Gauge => "gauge under 1000 mm",
        }
    }
}

/// Approximate Spain–France border, west to east, as (lon, lat): France is
/// north of it (and east of the Bidasoa). Only used to tell standard-gauge
/// high speed (Spain) from standard-gauge conventional track (France).
const BORDER: &[(f64, f64)] = &[
    (-1.783, 43.30),
    (-1.60, 43.25),
    (-1.40, 43.05),
    (-1.00, 43.00),
    (-0.60, 42.92),
    (-0.20, 42.79),
    (0.40, 42.70),
    (0.70, 42.85),
    (1.00, 42.72),
    (1.45, 42.60),
    (1.78, 42.49),
    (1.85, 42.445),
    (1.93, 42.44),
    (2.30, 42.40),
    (2.85, 42.455),
    (3.16, 42.435),
    (3.40, 42.43),
];

/// Is `p` in France (rather than Spain, Andorra or Portugal)?
pub fn in_france(p: LatLon) -> bool {
    let (w, e) = (BORDER[0], BORDER[BORDER.len() - 1]);
    if p.lon < w.0 {
        return false;
    }
    let lat = if p.lon >= e.0 {
        e.1
    } else {
        let i = BORDER.iter().position(|b| b.0 > p.lon).unwrap_or(1);
        let (a, b) = (BORDER[i - 1], BORDER[i]);
        a.1 + (b.1 - a.1) * (p.lon - a.0) / (b.0 - a.0)
    };
    p.lat > lat
}

/// Gauges in mm from OSM `gauge` ("1668", "1435;1668"); near-Iberian
/// variants (1660, 1676) count as 1668.
fn gauges(props: &serde_json::Value) -> Vec<u16> {
    let mut g: Vec<u16> = props["gauge"]
        .as_str()
        .unwrap_or("")
        .split(';')
        .filter_map(|s| s.trim().parse::<u16>().ok())
        .map(|g| if (1660..=1676).contains(&g) { 1668 } else { g })
        .collect();
    g.sort_unstable();
    g.dedup();
    g
}

fn tag<'a>(props: &'a serde_json::Value, k: &str) -> &'a str {
    props[k].as_str().unwrap_or("")
}

/// Classify one OSM way (`first`: its first point, to tell the country).
pub fn classify(props: &serde_json::Value, first: LatLon) -> std::result::Result<WayClass, Skip> {
    let railway = tag(props, "railway");
    if !matches!(railway, "rail" | "narrow_gauge" | "disused") {
        return Err(Skip::NotTrack);
    }
    let gone = ["abandoned", "razed", "demolished"]
        .iter()
        .any(|k| tag(props, k) == "yes");
    if gone {
        return Err(Skip::Lifecycle);
    }
    if matches!(tag(props, "usage"), "industrial" | "military" | "test") {
        return Err(Skip::Usage);
    }
    let disused = railway == "disused"
        || tag(props, "disused") == "yes"
        || tag(props, "service") == "disused";
    let service = tag(props, "service");
    let drawn = matches!(service, "" | "disused");
    let g = gauges(props);
    if !g.is_empty() && g.iter().all(|&x| x < 1000) {
        return Err(Skip::Gauge);
    }
    let has = |x: u16| g.contains(&x);
    let kind = if tag(props, "highspeed") == "yes" {
        Kind::Av
    } else if g.is_empty() {
        if railway == "narrow_gauge" {
            Kind::Metric
        } else {
            Kind::Conv
        }
    } else if has(1000) && !has(1668) && !has(1435) {
        Kind::Metric
    } else if has(1435) && !has(1668) && !has(1000) {
        // Standard gauge is high speed in Spain, except FGC's Barcelona–Vallès
        // commuter line; in France it's the ordinary network.
        let fgc =
            tag(props, "operator").contains("Generalitat") || tag(props, "name").starts_with("FGC");
        // Outside Iberia (France, Great Britain) standard gauge is ordinary track.
        if first.lat > 44.0 || in_france(first) || fgc {
            Kind::Conv
        } else {
            Kind::Av
        }
    } else {
        Kind::Conv
    };
    Ok(WayClass {
        kind,
        mixed: g.iter().filter(|&&x| x >= 1000).count() > 1,
        drawn,
        disused,
    })
}

/// A station of Renfe's long-distance live map.
#[derive(Debug, Clone, PartialEq)]
pub struct RenfeStation {
    /// Five-digit code, as in the GTFS `stop_id` and the live feeds.
    pub code: String,
    pub name: String,
    /// 1 main, 2 secondary, 3 minor (0 unknown).
    pub level: u8,
    pub at: LatLon,
}

/// Read `estaciones.geojson` (Point features with `CODIGO`, `NOMBRE`, `NIVEL`).
pub fn read_stations(text: &str) -> Result<Vec<RenfeStation>> {
    let v: serde_json::Value = serde_json::from_str(text)?;
    let mut out = Vec::new();
    for f in v["features"].as_array().into_iter().flatten() {
        let p = &f["properties"];
        let c = &f["geometry"]["coordinates"];
        let (Some(lon), Some(lat)) = (c[0].as_f64(), c[1].as_f64()) else {
            continue;
        };
        let code = match &p["CODIGO"] {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.trim().to_owned(),
            _ => continue,
        };
        out.push(RenfeStation {
            code: format!("{code:0>5}"),
            name: p["NOMBRE"].as_str().unwrap_or("").to_owned(),
            level: p["NIVEL"].as_u64().map_or(0, |n| n.min(9) as u8),
            at: LatLon::new(lat, lon),
        });
    }
    Ok(out)
}

/// Anchor a station onto track of a kind within this distance...
pub const ANCHOR_M: f64 = 300.0;
/// ...or this, for main stations (level 1: big stations, wide track fans).
pub const ANCHOR_MAIN_M: f64 = 600.0;
/// With no track of any kind that close, the nearest track within this
/// distance still gets the station (reported as far).
pub const ANCHOR_FALLBACK_M: f64 = 1_000.0;
/// Stations aren't anchored on isolated pieces of track shorter than this.
pub const MIN_PIECE_M: f64 = 2_000.0;
/// Tracks of the same kind at most this much further than the nearest one
/// run alongside it (double track, station loops): the station sits on them too...
pub const PARALLEL_M: f64 = 50.0;
/// ...up to this many per kind.
pub const MAX_TRACKS: usize = 4;
/// Lines that stop short within this distance of a station (OSM maps
/// platform tracks, and sometimes the through line in a station, as service
/// track) are joined up through it...
pub const BRIDGE_M: f64 = 1_000.0;
/// ...or this, for main stations.
pub const BRIDGE_MAIN_M: f64 = 1_500.0;

/// Where one station sits on the track.
#[derive(Debug, Clone, PartialEq)]
pub struct Anchor {
    pub kind: Kind,
    /// Graph node at the station's projection onto the track.
    pub node: u32,
    /// Distance from the station point to the track, metres.
    pub offset_m: f64,
}

/// Result of anchoring every station.
#[derive(Debug, Default)]
pub struct AnchorReport {
    /// Station code → its anchors, one per kind of track nearby.
    pub anchors: HashMap<String, Vec<Anchor>>,
    /// Anchored only by the fallback (no track within the normal distance).
    pub far: Vec<(RenfeStation, f64)>,
    /// No track within [`ANCHOR_FALLBACK_M`].
    pub unanchored: Vec<RenfeStation>,
    /// Service-track edges drawn to close gaps in lines at stations.
    pub bridged: usize,
}

impl AnchorReport {
    /// Markdown list of the stations that couldn't be projected.
    pub fn markdown(&self, stations: usize) -> String {
        let n = self.anchors.len();
        let mut by_kind: HashMap<Kind, usize> = HashMap::new();
        for a in self.anchors.values().flatten() {
            *by_kind.entry(a.kind).or_default() += 1;
        }
        let mut s = format!(
            "- Renfe stations: {n} of {stations} projected onto track \
             (AV {}, conventional {}, metre gauge {} anchors); {} only beyond {ANCHOR_M} m; \
             {} not projected; {} service-track edges drawn to join lines up at stations\n",
            by_kind.get(&Kind::Av).unwrap_or(&0),
            by_kind.get(&Kind::Conv).unwrap_or(&0),
            by_kind.get(&Kind::Metric).unwrap_or(&0),
            self.far.len(),
            self.unanchored.len(),
            self.bridged,
        );
        for (st, d) in &self.far {
            s.push_str(&format!(
                "  - far: {} {} ({d:.0} m from track)\n",
                st.code, st.name
            ));
        }
        for st in &self.unanchored {
            s.push_str(&format!(
                "  - ⚠ not projected: {} {} ({:.5}, {:.5}): no track within {ANCHOR_FALLBACK_M} m\n",
                st.code, st.name, st.at.lat, st.at.lon
            ));
        }
        s
    }
}

/// One drawn section of track between junctions or stations.
#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub pts: Vec<LatLon>,
    pub kind: Kind,
    pub mixed: bool,
    pub disused: bool,
    /// Most common gauge along it in mm (0 unknown).
    pub gauge_mm: u16,
    /// Most common line speed in km/h (0 unknown).
    pub max_kmh: u16,
}

impl RailGraph {
    /// Join up lines that stop short at a station because OSM maps the track
    /// through it as service track: around each station, connect the loose
    /// ends of drawn track of one kind to each other, or else towards the
    /// station, along the shortest service track of that kind, and draw it.
    /// Returns how many edges were drawn.
    pub fn bridge_station_gaps(&mut self, stations: &[RenfeStation]) -> usize {
        let mut drawn = 0;
        for st in stations {
            let r = if st.level == 1 {
                BRIDGE_MAIN_M
            } else {
                BRIDGE_M
            };
            let loose: Vec<(u32, Kind)> = self
                .nodes_near(st.at, r)
                .into_iter()
                .filter_map(|n| {
                    let mut it = self.adj_of(n).filter(|e| e.drawn);
                    match (it.next(), it.next()) {
                        (Some(e), None) => Some((n, e.kind)),
                        _ => None,
                    }
                })
                .collect();
            let mut joined: Vec<u32> = Vec::new();
            for &(u, kind) in &loose {
                if joined.contains(&u) {
                    continue;
                }
                let others: Vec<u32> = loose
                    .iter()
                    .filter(|o| o.1 == kind && o.0 != u)
                    .map(|o| o.0)
                    .collect();
                // To another loose end, or else as close to the station as
                // service track gets (when that is closer than the end).
                let path = self
                    .service_path(u, kind, st.at, 2.0 * r, &others)
                    .or_else(|| {
                        let p = self.service_path(u, kind, st.at, r, &[])?;
                        let gain = haversine_m(self.nodes()[u as usize], st.at)
                            - haversine_m(self.nodes()[*p.last()? as usize], st.at);
                        (gain > BRIDGE_MIN_GAIN_M).then_some(p)
                    });
                let Some(path) = path else { continue };
                joined.extend([u, *path.last().unwrap_or(&u)]);
                for w in path.windows(2) {
                    self.set_drawn(w[0], w[1]);
                    drawn += 1;
                }
            }
        }
        drawn
    }

    /// Shortest path from `u` along service track of `kind` within `r_m` of
    /// `centre`: to the first of `goals` reached, or (with no goals) to the
    /// node reached that is nearest `centre`.
    fn service_path(
        &self,
        u: u32,
        kind: Kind,
        centre: LatLon,
        r_m: f64,
        goals: &[u32],
    ) -> Option<Vec<u32>> {
        use std::collections::{BTreeMap, HashSet};
        let mut dist: HashMap<u32, f64> = HashMap::from([(u, 0.0)]);
        let mut prev: HashMap<u32, u32> = HashMap::new();
        let mut todo: BTreeMap<(u64, u32), ()> = BTreeMap::from([((0, u), ())]);
        let mut done: HashSet<u32> = HashSet::new();
        let mut best = (haversine_m(self.nodes()[u as usize], centre), u);
        let mut end = None;
        while let Some(((_, n), ())) = todo.pop_first() {
            if !done.insert(n) {
                continue;
            }
            if n != u && goals.contains(&n) {
                end = Some(n);
                break;
            }
            let d_here = haversine_m(self.nodes()[n as usize], centre);
            if d_here < best.0 {
                best = (d_here, n);
            }
            for e in self.adj_of(n).filter(|e| !e.drawn && e.kind == kind) {
                if haversine_m(self.nodes()[e.to as usize], centre) > r_m {
                    continue;
                }
                let nd = dist[&n] + f64::from(e.len_m);
                if dist.get(&e.to).is_none_or(|&d| nd < d) {
                    dist.insert(e.to, nd);
                    prev.insert(e.to, n);
                    todo.insert(((nd * 100.0) as u64, e.to), ());
                }
            }
        }
        let mut n = match (goals.is_empty(), end) {
            (_, Some(n)) => n,
            (true, None) if best.1 != u => best.1,
            _ => return None,
        };
        let mut path = vec![n];
        while let Some(&p) = prev.get(&n) {
            path.push(p);
            n = p;
        }
        path.reverse();
        Some(path)
    }

    /// Project each station onto the nearest track of every kind within
    /// [`ANCHOR_M`] ([`ANCHOR_MAIN_M`] for main stations), and onto the
    /// tracks running alongside it (double track), or failing that onto the
    /// nearest track within [`ANCHOR_FALLBACK_M`]; cut the track there.
    pub fn anchor_stations(&mut self, stations: &[RenfeStation]) -> AnchorReport {
        let mut report = AnchorReport {
            bridged: self.bridge_station_gaps(stations),
            ..AnchorReport::default()
        };
        // Every projection first (on the graph as read), then all cuts.
        let mut cuts: HashMap<(u32, u32), Vec<(f64, usize)>> = HashMap::new();
        let mut wanted: Vec<(String, Kind, f64)> = Vec::new();
        let index = self.edge_index();
        let connected = self.connected_nodes(MIN_PIECE_M);
        for st in stations {
            let near = if st.level == 1 {
                ANCHOR_MAIN_M
            } else {
                ANCHOR_M
            };
            let cands: Vec<_> = self
                .candidates(&index, st.at, ANCHOR_FALLBACK_M)
                .into_iter()
                .filter(|c| connected[c.1.0 as usize])
                .collect();
            let mut chosen: Vec<(Kind, (u32, u32), f64, f64)> = Vec::new();
            for kind in Kind::ALL {
                let mut of_kind = cands.iter().filter(|c| c.0 == kind && c.3 <= near);
                let Some(&first) = of_kind.next() else {
                    continue;
                };
                let mut picked = vec![first];
                for &c in of_kind {
                    if picked.len() >= MAX_TRACKS || c.3 > first.3 + PARALLEL_M {
                        break;
                    }
                    // Another track, not the next segment of one already picked.
                    let (a, b) = c.1;
                    if picked
                        .iter()
                        .all(|p| ![p.1.0, p.1.1].contains(&a) && ![p.1.0, p.1.1].contains(&b))
                    {
                        picked.push(c);
                    }
                }
                chosen.extend(picked);
            }
            if chosen.is_empty() {
                match cands.first() {
                    Some(&c) => {
                        report.far.push((st.clone(), c.3));
                        chosen.push(c);
                    }
                    None => {
                        report.unanchored.push(st.clone());
                        continue;
                    }
                }
            }
            for (kind, edge, t, d) in chosen {
                cuts.entry(edge).or_default().push((t, wanted.len()));
                wanted.push((st.code.clone(), kind, d));
            }
        }
        let mut nodes = vec![0u32; wanted.len()];
        for ((a, b), mut at) in cuts {
            at.sort_by(|x, y| x.0.total_cmp(&y.0));
            let ts: Vec<f64> = at.iter().map(|x| x.0).collect();
            for (i, n) in self.cut_edge(a, b, &ts).into_iter().enumerate() {
                nodes[at[i].1] = n;
            }
        }
        for (i, (code, kind, d)) in wanted.into_iter().enumerate() {
            report.anchors.entry(code).or_default().push(Anchor {
                kind,
                node: nodes[i],
                offset_m: d,
            });
        }
        self.set_anchors(
            report
                .anchors
                .iter()
                .map(|(c, v)| (c.clone(), v.iter().map(|a| a.node).collect()))
                .collect(),
        );
        report
    }

    /// Per node: is it on a piece of track (drawn or service) at least
    /// `min_m` long? Short isolated bits (a turntable road, a museum track)
    /// would otherwise catch a station and cut it off from its line.
    fn connected_nodes(&self, min_m: f64) -> Vec<bool> {
        let n = self.nodes().len();
        let mut piece = vec![u32::MAX; n];
        let mut lens: Vec<f64> = Vec::new();
        for start in 0..n {
            if piece[start] != u32::MAX {
                continue;
            }
            let id = lens.len() as u32;
            let mut len = 0.0;
            let mut stack = vec![start as u32];
            piece[start] = id;
            while let Some(i) = stack.pop() {
                for e in self.adj_of(i) {
                    len += f64::from(e.len_m) / 2.0; // each edge is seen from both ends
                    if piece[e.to as usize] == u32::MAX {
                        piece[e.to as usize] = id;
                        stack.push(e.to);
                    }
                }
            }
            lens.push(len);
        }
        piece.iter().map(|&p| lens[p as usize] >= min_m).collect()
    }

    /// Every drawn edge within `max_m` of `p`, nearest first:
    /// (kind, edge (a, b), fraction along a→b, distance m).
    fn candidates(
        &self,
        index: &HashMap<(i32, i32), Vec<(u32, u32)>>,
        p: LatLon,
        max_m: f64,
    ) -> Vec<(Kind, (u32, u32), f64, f64)> {
        let mut out = Vec::new();
        let r = (max_m / 111_000.0 / INDEX_CELL_DEG).ceil() as i32 + 1;
        let (cr, cc) = index_cell(p);
        let mut seen = std::collections::HashSet::new();
        for dr in -r..=r {
            for dc in -r..=r {
                for &(a, b) in index.get(&(cr + dr, cc + dc)).into_iter().flatten() {
                    if !seen.insert((a, b)) {
                        continue;
                    }
                    let Some(e) = self.edge(a, b) else { continue };
                    let (t, d) = trainradar_proto::geo::project_on_segment(
                        p,
                        self.nodes()[a as usize],
                        self.nodes()[b as usize],
                    );
                    if d <= max_m {
                        out.push((e.kind, (a, b), t, d));
                    }
                }
            }
        }
        out.sort_by(|x, y| x.3.total_cmp(&y.3).then(x.1.cmp(&y.1)));
        out
    }

    /// Grid of edges (each once, a < b) by the cells their bounding box covers.
    fn edge_index(&self) -> HashMap<(i32, i32), Vec<(u32, u32)>> {
        let mut idx: HashMap<(i32, i32), Vec<(u32, u32)>> = HashMap::new();
        for (a, b) in self.edge_pairs() {
            let (pa, pb) = (self.nodes()[a as usize], self.nodes()[b as usize]);
            let (r0, c0) = index_cell(LatLon::new(pa.lat.min(pb.lat), pa.lon.min(pb.lon)));
            let (r1, c1) = index_cell(LatLon::new(pa.lat.max(pb.lat), pa.lon.max(pb.lon)));
            for r in r0..=r1 {
                for c in c0..=c1 {
                    idx.entry((r, c)).or_default().push((a, b));
                }
            }
        }
        idx
    }

    /// The drawn network in sections: cut at junctions, at stations, and
    /// where the kind of track changes; simplified at `tolerance_m`.
    pub fn sections(&self, tolerance_m: f64) -> Vec<Section> {
        use std::collections::HashSet;
        let n = self.nodes().len();
        let drawn = |i: usize| self.adj_of(i as u32).filter(|e| e.drawn);
        let anchored: HashSet<u32> = self.anchor_nodes().collect();
        let is_break = |i: usize| -> bool {
            let mut it = drawn(i);
            match (it.next(), it.next(), it.next()) {
                (Some(x), Some(y), None) => {
                    anchored.contains(&(i as u32))
                        || x.kind != y.kind
                        || x.mixed != y.mixed
                        || x.disused != y.disused
                }
                _ => true,
            }
        };
        let breaks: Vec<bool> = (0..n).map(is_break).collect();
        let mut seen: HashSet<(u32, u32)> = HashSet::new();
        let mut out = Vec::new();
        let key = |a: u32, b: u32| if a < b { (a, b) } else { (b, a) };
        // From every break node, then any loops left without one.
        let starts = (0..n).filter(|&i| breaks[i]).chain(0..n);
        for s in starts {
            for first in drawn(s).collect::<Vec<_>>() {
                if seen.contains(&key(s as u32, first.to)) {
                    continue;
                }
                let mut ids = vec![s as u32];
                let mut gauge: HashMap<u16, f64> = HashMap::new();
                let mut speed: HashMap<u16, f64> = HashMap::new();
                let (mut prev, mut e) = (s as u32, first);
                loop {
                    seen.insert(key(prev, e.to));
                    *gauge.entry(e.gauge_mm).or_default() += f64::from(e.len_m);
                    *speed.entry(e.max_kmh).or_default() += f64::from(e.len_m);
                    ids.push(e.to);
                    let here = e.to as usize;
                    if breaks[here] || here == s {
                        break;
                    }
                    let Some(next) =
                        drawn(here).find(|x| x.to != prev && !seen.contains(&key(e.to, x.to)))
                    else {
                        break;
                    };
                    prev = e.to;
                    e = next;
                }
                let pts: Vec<LatLon> = ids.iter().map(|&i| self.nodes()[i as usize]).collect();
                out.push(Section {
                    pts: trainradar_proto::geo::simplify(&pts, tolerance_m),
                    kind: first.kind,
                    mixed: first.mixed,
                    disused: first.disused,
                    gauge_mm: crate::osm::most_common(&gauge),
                    max_kmh: crate::osm::most_common(&speed),
                });
            }
        }
        out
    }
}

/// Douglas–Peucker tolerance for the drawn network, metres: as for the
/// trains' legs, under a pixel up to zoom 12 (236 KB gzipped for Spain).
pub const NET_SIMPLIFY_M: f64 = 15.0;

/// Extending a loose end towards a station must bring it this much closer.
const BRIDGE_MIN_GAIN_M: f64 = 20.0;

/// Edge index cell in degrees (~550 m).
const INDEX_CELL_DEG: f64 = 0.005;

fn index_cell(p: LatLon) -> (i32, i32) {
    (
        (p.lat / INDEX_CELL_DEG).floor() as i32,
        (p.lon / INDEX_CELL_DEG).floor() as i32,
    )
}

/// The network as GeoJSON (for checking it on a map): sections with their
/// kind, and every Renfe station with its anchors (or none).
pub fn debug_geojson(
    sections: &[Section],
    stations: &[RenfeStation],
    report: &AnchorReport,
    g: &RailGraph,
) -> String {
    let mut f: Vec<serde_json::Value> = Vec::new();
    for s in sections {
        f.push(serde_json::json!({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates":
                s.pts.iter().map(|p| [round5(p.lon), round5(p.lat)]).collect::<Vec<_>>()},
            "properties": {"kind": s.kind.name(), "mixed": s.mixed, "disused": s.disused, "gauge": s.gauge_mm, "max_kmh": s.max_kmh},
        }));
    }
    for st in stations {
        let anchors = report.anchors.get(&st.code);
        f.push(serde_json::json!({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [st.at.lon, st.at.lat]},
            "properties": {"station": st.code, "name": st.name, "level": st.level,
                "kinds": anchors.map(|v| v.iter().map(|a| a.kind.name()).collect::<Vec<_>>()).unwrap_or_default()},
        }));
        for a in anchors.into_iter().flatten() {
            let p = g.nodes()[a.node as usize];
            f.push(serde_json::json!({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[st.at.lon, st.at.lat], [round5(p.lon), round5(p.lat)]]},
                "properties": {"anchor": st.code, "kind": a.kind.name(), "offset_m": a.offset_m.round()},
            }));
        }
    }
    serde_json::json!({"type": "FeatureCollection", "features": f}).to_string()
}

fn round5(x: f64) -> f64 {
    (x * 1e5).round() / 1e5
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MADRID: LatLon = LatLon::new(40.4, -3.7);

    #[test]
    fn classifies_by_track_tags() {
        let c = |p: serde_json::Value, at: LatLon| classify(&p, at);
        let av = c(
            json!({"railway": "rail", "gauge": "1435", "highspeed": "yes"}),
            MADRID,
        )
        .unwrap();
        assert_eq!((av.kind, av.mixed, av.drawn), (Kind::Av, false, true));
        assert_eq!(
            c(json!({"railway": "rail", "gauge": "1435"}), MADRID)
                .unwrap()
                .kind,
            Kind::Av
        );
        assert_eq!(
            c(json!({"railway": "rail", "gauge": "1668"}), MADRID)
                .unwrap()
                .kind,
            Kind::Conv
        );
        let hs_iberian = c(
            json!({"railway": "rail", "gauge": "1668", "highspeed": "yes"}),
            MADRID,
        );
        assert_eq!(hs_iberian.unwrap().kind, Kind::Av, "highspeed=yes wins");
        // Great Britain: standard gauge is ordinary track; HS1 is tagged highspeed.
        let london = LatLon::new(51.53, -0.12);
        let york = LatLon::new(53.96, -1.09);
        for p in [london, york] {
            assert_eq!(
                c(json!({"railway": "rail", "gauge": "1435"}), p)
                    .unwrap()
                    .kind,
                Kind::Conv
            );
        }
        assert_eq!(
            c(
                json!({"railway": "rail", "gauge": "1435", "highspeed": "yes"}),
                london
            )
            .unwrap()
            .kind,
            Kind::Av
        );
        let third_rail = c(json!({"railway": "rail", "gauge": "1435;1668"}), MADRID).unwrap();
        assert_eq!((third_rail.kind, third_rail.mixed), (Kind::Conv, true));
        assert_eq!(
            c(json!({"railway": "narrow_gauge", "gauge": "1000"}), MADRID)
                .unwrap()
                .kind,
            Kind::Metric
        );
        assert_eq!(
            c(json!({"railway": "narrow_gauge"}), MADRID).unwrap().kind,
            Kind::Metric
        );
        let fgc = json!({"railway": "rail", "gauge": "1435", "operator": "Ferrocarrils de la Generalitat de Catalunya"});
        assert_eq!(c(fgc, LatLon::new(41.4, 2.1)).unwrap().kind, Kind::Conv);
        // Standard gauge in France is the ordinary network.
        let narbonne = LatLon::new(43.18, 3.0);
        assert_eq!(
            c(json!({"railway": "rail", "gauge": "1435"}), narbonne)
                .unwrap()
                .kind,
            Kind::Conv
        );
        assert_eq!(
            c(
                json!({"railway": "rail", "gauge": "1435", "highspeed": "yes"}),
                narbonne
            )
            .unwrap()
            .kind,
            Kind::Av
        );
    }

    #[test]
    fn skips_service_dead_and_toy_track() {
        let c = |p: serde_json::Value| classify(&p, MADRID);
        assert_eq!(c(json!({"railway": "abandoned"})), Err(Skip::NotTrack));
        // Service track joins lines up but isn't drawn.
        assert!(
            !c(json!({"railway": "rail", "service": "siding"}))
                .unwrap()
                .drawn
        );
        assert!(
            !c(json!({"railway": "rail", "service": "yard"}))
                .unwrap()
                .drawn
        );
        assert!(
            !c(json!({"railway": "rail", "service": "crossover"}))
                .unwrap()
                .drawn
        );
        assert_eq!(c(json!({"railway": "abandoned"})), Err(Skip::NotTrack));
        assert_eq!(c(json!({"railway": "construction"})), Err(Skip::NotTrack));
        assert_eq!(
            c(json!({"railway": "rail", "abandoned": "yes"})),
            Err(Skip::Lifecycle)
        );
        // Closed for works but the track is there (Murcia–Águilas in 2026).
        let closed = c(json!({"railway": "disused", "gauge": "1668"})).unwrap();
        assert_eq!(
            (closed.kind, closed.disused, closed.drawn),
            (Kind::Conv, true, true)
        );
        assert!(
            c(json!({"railway": "rail", "disused": "yes"}))
                .unwrap()
                .disused
        );
        assert_eq!(
            c(json!({"railway": "rail", "usage": "industrial"})),
            Err(Skip::Usage)
        );
        assert_eq!(
            c(json!({"railway": "narrow_gauge", "gauge": "600"})),
            Err(Skip::Gauge)
        );
    }

    #[test]
    fn border_splits_spain_from_france() {
        for (lat, lon, fr) in [
            (42.443, 3.165, true),   // Cerbère
            (42.427, 3.158, false),  // Portbou
            (42.459, 1.889, true),   // Latour-de-Carol
            (42.432, 1.928, false),  // Puigcerdà
            (43.353, -1.775, true),  // Hendaye
            (43.339, -1.792, false), // Irun
            (42.75, -0.52, false),   // Canfranc
            (42.82, -1.64, false),   // Pamplona
            (43.30, 5.38, true),     // Marseille
            (42.27, 2.96, false),    // Figueres
            (41.15, -8.61, false),   // Porto
        ] {
            assert_eq!(in_france(LatLon::new(lat, lon)), fr, "{lat},{lon}");
        }
    }

    #[test]
    fn reads_renfe_stations() {
        let s = read_stations(
            r#"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"CODIGO":5193,"NOMBRE":"Ferrol","NIVEL":1},"geometry":{"type":"Point","coordinates":[-8.23,43.49]}}]}"#,
        )
        .unwrap();
        assert_eq!(s[0].code, "05193");
        assert_eq!((s[0].level, s[0].at), (1, LatLon::new(43.49, -8.23)));
    }

    /// AV and conventional track side by side 100 m apart, with a station
    /// between them and a metre-gauge line 2 km away.
    fn parallel() -> RailGraph {
        let line = |coords: &str, tags: &str| {
            format!(
                "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"LineString\",\"coordinates\":{coords}}},\"properties\":{tags}}}\n"
            )
        };
        let text = [
            line(
                "[[-3.70,40.0000],[-3.60,40.0000]]",
                r#"{"railway":"rail","gauge":"1435","highspeed":"yes"}"#,
            ),
            line(
                "[[-3.70,40.0009],[-3.60,40.0009]]",
                r#"{"railway":"rail","gauge":"1668"}"#,
            ),
            line(
                "[[-3.70,40.0200],[-3.60,40.0200]]",
                r#"{"railway":"narrow_gauge","gauge":"1000"}"#,
            ),
        ]
        .concat();
        RailGraph::from_geojsonseq(text.as_bytes()).unwrap()
    }

    fn station(code: &str, lat: f64, lon: f64, level: u8) -> RenfeStation {
        RenfeStation {
            code: code.into(),
            name: code.into(),
            level,
            at: LatLon::new(lat, lon),
        }
    }

    #[test]
    fn bridges_lines_through_stations_mapped_as_sidings() {
        let line = |coords: &str, tags: &str| {
            format!(
                "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"LineString\",\"coordinates\":{coords}}},\"properties\":{tags}}}\n"
            )
        };
        let av = r#"{"railway":"rail","gauge":"1435","highspeed":"yes"}"#;
        let siding = r#"{"railway":"rail","gauge":"1435","service":"siding"}"#;
        let yard = r#"{"railway":"rail","gauge":"1435","service":"yard"}"#;
        let text = [
            line("[[-3.70,40.0],[-3.66,40.0]]", av),
            line("[[-3.66,40.0],[-3.65,40.0],[-3.64,40.0]]", siding), // through the station
            line("[[-3.64,40.0],[-3.60,40.0]]", av),
            line("[[-3.66,40.0],[-3.65,40.002],[-3.64,40.0]]", yard), // a longer loop
            line("[[-3.65,40.0],[-3.65,40.004]]", siding),            // a stub: not drawn
        ]
        .concat();
        let mut g = RailGraph::from_geojsonseq(text.as_bytes()).unwrap();
        let r = g.anchor_stations(&[station("S", 40.0003, -3.65, 2)]);
        assert_eq!(r.bridged, 2, "the two through-line edges");
        assert_eq!(
            r.anchors["S"].iter().map(|a| a.kind).collect::<Vec<_>>(),
            [Kind::Av]
        );
        let s = g.sections(5.0);
        assert_eq!(s.len(), 2, "one line, cut at the station: {s:?}");
        assert!(
            s.iter()
                .all(|x| x.kind == Kind::Av && x.pts.iter().all(|p| p.lat == 40.0))
        );
    }

    #[test]
    fn skips_isolated_bits_of_track() {
        let text = concat!(
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.70,40.0],[-3.60,40.0]]},\"properties\":{\"railway\":\"rail\",\"gauge\":\"1668\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.651,40.0015],[-3.649,40.0015]]},\"properties\":{\"railway\":\"rail\",\"gauge\":\"1668\"}}\n",
        );
        let mut g = RailGraph::from_geojsonseq(text.as_bytes()).unwrap();
        let r = g.anchor_stations(&[station("S", 40.0011, -3.65, 2)]);
        let a = &r.anchors["S"];
        assert_eq!(a.len(), 1);
        assert!(
            g.nodes()[a[0].node as usize].lat == 40.0,
            "on the line, not the 170 m bit"
        );
    }

    #[test]
    fn anchors_each_kind_nearby_and_cuts_track() {
        let mut g = parallel();
        let r = g.anchor_stations(&[
            station("A", 40.0004, -3.65, 2), // between AV and conventional
            station("M", 40.0198, -3.66, 3), // on the metre-gauge line
            station("X", 40.2000, -3.65, 2), // nowhere near track
            station("F", 40.0120, -3.62, 3), // 890 m from the metre gauge: far
        ]);
        let kinds = |c: &str| r.anchors[c].iter().map(|a| a.kind).collect::<Vec<_>>();
        assert_eq!(kinds("A"), [Kind::Av, Kind::Conv]);
        assert_eq!(kinds("M"), [Kind::Metric]);
        assert_eq!(r.unanchored.len(), 1);
        assert_eq!(r.far.len(), 1);
        // The track now has a node exactly at each projection.
        let a = &r.anchors["A"][0];
        let p = g.nodes()[a.node as usize];
        assert!(
            (p.lon - -3.65).abs() < 1e-9 && (p.lat - 40.0).abs() < 1e-9,
            "{p:?}"
        );
        // Sections: AV and conventional each cut in two at A; metre gauge cut
        // at M and F.
        let s = g.sections(5.0);
        let count = |k: Kind| s.iter().filter(|x| x.kind == k).count();
        assert_eq!(
            (count(Kind::Av), count(Kind::Conv), count(Kind::Metric)),
            (2, 2, 3)
        );
    }
}
