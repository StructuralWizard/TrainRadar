//! Track geometry from OpenStreetMap, for trips whose GTFS has no shape
//! (all of AV/LD/MD, and the few Cercanías trips whose shape doesn't fit).
//!
//! Input: OSM `railway=rail` and `railway=narrow_gauge` ways exported by
//! `osmium export -f geojsonseq` (see `tools/fetch-osm-rail.sh`), classified
//! and filtered by [`crate::railnet::classify`]. We build a graph where ways
//! that share an OSM node connect, then route each pair of consecutive stops
//! with A*, from the stations' anchors on the track ([`crate::railnet`]) and
//! preferring the kind of track the train runs on.
//!
//! OSM data © OpenStreetMap contributors, ODbL 1.0. Shapes derived from it are
//! published under the ODbL with the generated files.

use crate::gtfs_io::Result;
use crate::railnet::{Kind, Skip, WayClass, classify};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::io::BufRead;
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;
use trainradar_proto::refdata::LegInfo;

/// Stops further than this from any track can't be routed.
pub const MAX_SNAP_M: f64 = 1_000.0;
/// Reject a route longer than `DETOUR_FACTOR × straight + DETOUR_SLACK_M`:
/// it has probably gone round a missing link.
pub const DETOUR_FACTOR: f64 = 1.8;
pub const DETOUR_SLACK_M: f64 = 20_000.0;

/// Search cost factor on track of another kind than the train's: an AVE
/// keeps to high-speed track and a regional train to the conventional line,
/// unless the other is much shorter.
pub const OFF_KIND_COST: f64 = 1.5;
/// Search cost factor on service track (yards, sidings, crossovers): used to
/// join lines up where OSM maps them that way, not as a shortcut.
pub const SERVICE_COST: f64 = 4.0;

/// Snapping grid cell in degrees (~1.1 km).
const CELL_DEG: f64 = 0.01;

#[derive(Debug, Default)]
pub struct RailGraph {
    nodes: Vec<LatLon>,
    adj: Vec<Vec<Edge>>,
    grid: HashMap<(i32, i32), Vec<u32>>,
    /// Track height per node in metres (NaN = unknown), once heights are set.
    elev: Vec<f32>,
    /// Station code → its nodes on the track ([`crate::railnet`]).
    anchors: HashMap<String, Vec<u32>>,
    /// Ways left out, by reason.
    pub skipped: HashMap<Skip, usize>,
    /// Ways kept, by kind of track.
    pub kept: HashMap<Kind, usize>,
}

#[derive(Debug, Clone, Copy)]
pub struct Edge {
    pub to: u32,
    pub len_m: f32,
    pub gauge_mm: u16,
    pub max_kmh: u16,
    /// On a tunnel or bridge: the terrain height there isn't the track's.
    pub structure: bool,
    pub kind: Kind,
    /// More than one gauge on this track.
    pub mixed: bool,
    /// Drawn on the map (service track isn't, except station sidings).
    pub drawn: bool,
    /// `service=siding`.
    pub siding: bool,
    /// Out of use (`railway=disused`).
    pub disused: bool,
}

/// OSM coordinate key (1e-7 degrees), as used by `dem-sample`.
pub fn node_key(p: LatLon) -> (i64, i64) {
    ((p.lat * 1e7).round() as i64, (p.lon * 1e7).round() as i64)
}

#[derive(Debug, Default, Clone, Copy)]
pub struct RouteStats {
    pub pairs_routed: usize,
    pub pairs_failed: usize,
}

fn cell(p: LatLon) -> (i32, i32) {
    (
        (p.lat / CELL_DEG).floor() as i32,
        (p.lon / CELL_DEG).floor() as i32,
    )
}

/// Dijkstra label for `set_heights`: distance from portal `src`.
#[derive(Debug, PartialEq)]
struct Label {
    d: f64,
    node: u32,
    src: u32,
}
impl Eq for Label {}
impl Ord for Label {
    fn cmp(&self, o: &Self) -> Ordering {
        o.d.total_cmp(&self.d)
    }
}
impl PartialOrd for Label {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

#[derive(Debug, PartialEq)]
struct Item {
    f: f64,
    node: u32,
}
impl Eq for Item {}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        o.f.total_cmp(&self.f) // min-heap
    }
}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl RailGraph {
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn nodes(&self) -> &[LatLon] {
        &self.nodes
    }

    /// Set node heights from terrain heights (`dem::read_heights`), then
    /// replace the heights inside tunnels and on bridges by interpolating
    /// between the nearest two ends ("portals"). Returns (nodes with a
    /// terrain height, nodes interpolated).
    pub fn set_heights(&mut self, terrain: &HashMap<(i64, i64), f32>) -> (usize, usize) {
        self.elev = self
            .nodes
            .iter()
            .map(|&p| terrain.get(&node_key(p)).copied().unwrap_or(f32::NAN))
            .collect();
        let known = self.elev.iter().filter(|h| !h.is_nan()).count();
        // A node is inside a structure when every track through it is one;
        // a portal has both kinds, or ends the line on a structure.
        let n = self.nodes.len();
        let inside: Vec<bool> = (0..n)
            .map(|i| !self.adj[i].is_empty() && self.adj[i].iter().all(|e| e.structure))
            .collect();
        // Two nearest distinct portals per inside node, by track distance
        // through the structure (multi-source Dijkstra keeping two labels).
        let mut labels: Vec<Vec<(u32, f64)>> = vec![Vec::new(); n];
        let mut heap = BinaryHeap::new();
        for (i, adj) in self.adj.iter().enumerate() {
            if !inside[i] && adj.iter().any(|e| e.structure) && !self.elev[i].is_nan() {
                heap.push(Label {
                    d: 0.0,
                    node: i as u32,
                    src: i as u32,
                });
            }
        }
        while let Some(Label { d, node, src }) = heap.pop() {
            let l = &mut labels[node as usize];
            if l.len() >= 2 || l.iter().any(|x| x.0 == src) {
                continue;
            }
            l.push((src, d));
            if node != src && !inside[node as usize] {
                continue; // reached another portal: don't leave the structure
            }
            for e in &self.adj[node as usize] {
                if e.structure && inside[e.to as usize] {
                    heap.push(Label {
                        d: d + f64::from(e.len_m),
                        node: e.to,
                        src,
                    });
                }
            }
        }
        let mut filled = 0;
        for i in 0..n {
            if !inside[i] {
                continue;
            }
            let h = |s: u32| f64::from(self.elev[s as usize]);
            let v = match labels[i][..] {
                [(a, da), (b, db)] if da + db > 0.0 => (h(a) * db + h(b) * da) / (da + db),
                [(a, _), ..] => h(a),
                [] => continue, // no portal with a height: keep the terrain
            };
            self.elev[i] = v as f32;
            filled += 1;
        }
        (known, filled)
    }

    /// Read GeoJSON-sequence lines (an optional leading RS byte is ignored).
    pub fn from_geojsonseq(r: impl BufRead) -> Result<Self> {
        let mut g = Self::default();
        let mut ids: HashMap<(i64, i64), u32> = HashMap::new();
        for line in r.lines() {
            let line = line?;
            let line = line.trim_start_matches('\u{1e}').trim();
            if line.is_empty() {
                continue;
            }
            let f: serde_json::Value = serde_json::from_str(line)?;
            let props = &f["properties"];
            let geom = &f["geometry"];
            let lines: Vec<&serde_json::Value> = match geom["type"].as_str() {
                Some("LineString") => vec![&geom["coordinates"]],
                Some("MultiLineString") => geom["coordinates"]
                    .as_array()
                    .map(|a| a.iter().collect())
                    .unwrap_or_default(),
                _ => continue,
            };
            let mut class = None;
            for coords in lines {
                let pts: Vec<LatLon> = coords
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| Some(LatLon::new(c.get(1)?.as_f64()?, c.get(0)?.as_f64()?)))
                    .collect();
                let Some(&first) = pts.first() else { continue };
                let c = match class {
                    Some(c) => c,
                    None => match classify(props, first) {
                        Ok(c) => *class.insert(c),
                        Err(why) => {
                            *g.skipped.entry(why).or_default() += 1;
                            break;
                        }
                    },
                };
                g.add_line(
                    &pts,
                    &mut ids,
                    gauge_of(props),
                    maxspeed_of(props),
                    is_structure(props),
                    c,
                );
            }
            if let Some(c) = class {
                *g.kept.entry(c.kind).or_default() += 1;
            }
        }
        Ok(g)
    }

    /// Add a polyline; points with identical coordinates (shared OSM nodes) join.
    fn add_line(
        &mut self,
        pts: &[LatLon],
        ids: &mut HashMap<(i64, i64), u32>,
        gauge_mm: u16,
        max_kmh: u16,
        structure: bool,
        class: WayClass,
    ) {
        let mut prev: Option<u32> = None;
        for &p in pts {
            let id = *ids.entry(node_key(p)).or_insert_with(|| {
                self.nodes.push(p);
                self.adj.push(Vec::new());
                let id = (self.nodes.len() - 1) as u32;
                self.grid.entry(cell(p)).or_default().push(id);
                id
            });
            if let Some(q) = prev.filter(|&q| q != id) {
                let len_m = haversine_m(self.nodes[q as usize], p) as f32;
                let e = Edge {
                    to: id,
                    len_m,
                    gauge_mm,
                    max_kmh,
                    structure,
                    kind: class.kind,
                    mixed: class.mixed,
                    drawn: class.drawn,
                    siding: class.siding,
                    disused: class.disused,
                };
                self.adj[q as usize].push(e);
                self.adj[id as usize].push(Edge { to: q, ..e });
            }
            prev = Some(id);
        }
    }

    /// Nearest track node within [`MAX_SNAP_M`].
    pub fn snap(&self, p: LatLon) -> Option<(u32, f64)> {
        let (r, c) = cell(p);
        let mut best: Option<(u32, f64)> = None;
        for dr in -1..=1 {
            for dc in -1..=1 {
                for &n in self.grid.get(&(r + dr, c + dc)).into_iter().flatten() {
                    let d = haversine_m(p, self.nodes[n as usize]);
                    if d <= MAX_SNAP_M && best.is_none_or(|b| d < b.1) {
                        best = Some((n, d));
                    }
                }
            }
        }
        best
    }

    /// Track path from near `a` to near `b`, or `None` if they aren't
    /// connected without a large detour.
    #[cfg(test)]
    pub fn route(&self, a: LatLon, b: LatLon) -> Option<RoutedLeg> {
        let (sa, _) = self.snap(a)?;
        let (sb, _) = self.snap(b)?;
        let limit = DETOUR_FACTOR * haversine_m(a, b) + DETOUR_SLACK_M;
        self.route_nodes(&[sa], &[sb], limit, None)
    }

    /// Shortest track path from any of `starts` to any of `goals`, no longer
    /// than `limit_m`. With `prefer`, track of other kinds costs
    /// [`OFF_KIND_COST`] times its length in the search.
    pub fn route_nodes(
        &self,
        starts: &[u32],
        goals: &[u32],
        limit_m: f64,
        prefer: Option<Kind>,
    ) -> Option<RoutedLeg> {
        let (ids, _) = self.search(starts, goals, limit_m, prefer)?;
        let mut gauge: HashMap<u16, f64> = HashMap::new();
        let mut speed: HashMap<u16, f64> = HashMap::new();
        for w in ids.windows(2) {
            if let Some(e) = self.edge(w[0], w[1]) {
                *gauge.entry(e.gauge_mm).or_default() += f64::from(e.len_m);
                *speed.entry(e.max_kmh).or_default() += f64::from(e.len_m);
            }
        }
        let info = LegInfo {
            gauge_mm: most_common(&gauge),
            max_kmh: most_common(&speed),
            ..LegInfo::default()
        };
        let path = ids.iter().map(|&i| self.nodes[i as usize]).collect();
        let heights = ids
            .iter()
            .map(|&i| self.elev.get(i as usize).copied().unwrap_or(f32::NAN))
            .collect();
        Some((path, info, heights))
    }

    /// A* behind [`Self::route_nodes`]: the node path and its length in metres.
    pub fn search(
        &self,
        starts: &[u32],
        goals: &[u32],
        limit_m: f64,
        prefer: Option<Kind>,
    ) -> Option<(Vec<u32>, f64)> {
        let &g0 = goals.first()?;
        if let Some(&s) = starts.iter().find(|s| goals.contains(s)) {
            return Some((vec![s], 0.0));
        }
        // Aim at the first goal; the others are near it (one station), so
        // allow for them to keep the estimate from overshooting.
        let goal = self.nodes[g0 as usize];
        let spread = goals
            .iter()
            .map(|&g| haversine_m(goal, self.nodes[g as usize]))
            .fold(0.0, f64::max);
        let h = |n: u32| (haversine_m(self.nodes[n as usize], goal) - spread).max(0.0);
        // Costs are lengths times the factors above; only prune what can't
        // be within the length limit.
        let cost_limit = limit_m * SERVICE_COST * OFF_KIND_COST;
        let mut dist: HashMap<u32, f64> = HashMap::new();
        let mut prev: HashMap<u32, u32> = HashMap::new();
        let mut heap = BinaryHeap::new();
        for &s in starts {
            dist.insert(s, 0.0);
            heap.push(Item { f: h(s), node: s });
        }
        while let Some(Item { f, node }) = heap.pop() {
            if goals.contains(&node) {
                let mut ids = vec![node];
                let mut len = 0.0;
                let mut n = node;
                while let Some(&p) = prev.get(&n) {
                    if let Some(e) = self.edge(p, n) {
                        len += f64::from(e.len_m);
                    }
                    ids.push(p);
                    n = p;
                }
                if len > limit_m {
                    return None;
                }
                ids.reverse();
                return Some((ids, len));
            }
            if f > cost_limit {
                return None; // the best remaining estimate is already too long
            }
            let g = dist[&node];
            for e in &self.adj[node as usize] {
                let mut k = if prefer.is_some_and(|p| p != e.kind) {
                    OFF_KIND_COST
                } else {
                    1.0
                };
                if !e.drawn {
                    k *= SERVICE_COST;
                }
                let ng = g + f64::from(e.len_m) * k;
                if dist.get(&e.to).is_none_or(|&d| ng < d) {
                    dist.insert(e.to, ng);
                    prev.insert(e.to, node);
                    heap.push(Item {
                        f: ng + h(e.to),
                        node: e.to,
                    });
                }
            }
        }
        None
    }

    /// Edges leaving node `i`.
    pub fn adj_of(&self, i: u32) -> impl Iterator<Item = &Edge> {
        self.adj[i as usize].iter()
    }

    /// The edge from `a` to `b`, if any.
    pub fn edge(&self, a: u32, b: u32) -> Option<&Edge> {
        self.adj[a as usize].iter().find(|e| e.to == b)
    }

    /// Every drawn edge once, as (a, b) with a < b.
    pub fn edge_pairs(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        self.adj.iter().enumerate().flat_map(|(a, v)| {
            v.iter()
                .filter(move |e| e.drawn && (a as u32) < e.to)
                .map(move |e| (a as u32, e.to))
        })
    }

    /// Cut edge `a`–`b` at the fractions `ts` (ascending, along a→b): returns
    /// the node at each cut (an end node when the cut is within a metre of it).
    pub fn cut_edge(&mut self, a: u32, b: u32, ts: &[f64]) -> Vec<u32> {
        let Some(e) = self.edge(a, b).copied() else {
            return vec![a; ts.len()];
        };
        let (pa, pb) = (self.nodes[a as usize], self.nodes[b as usize]);
        let len = f64::from(e.len_m);
        let mut out = Vec::with_capacity(ts.len());
        let mut chain = vec![a];
        for &t in ts {
            let p = lerp(pa, pb, t);
            let last = *chain.last().unwrap_or(&a);
            let n = if t * len < 1.0 {
                a
            } else if (1.0 - t) * len < 1.0 {
                b
            } else if last != a && haversine_m(self.nodes[last as usize], p) < 1.0 {
                last
            } else {
                self.nodes.push(p);
                self.adj.push(Vec::new());
                if !self.elev.is_empty() {
                    let (ha, hb) = (self.elev[a as usize], self.elev[b as usize]);
                    self.elev.push(ha + (hb - ha) * t as f32);
                }
                let id = (self.nodes.len() - 1) as u32;
                self.grid.entry(cell(p)).or_default().push(id);
                chain.push(id);
                id
            };
            out.push(n);
        }
        if chain.len() == 1 {
            return out;
        }
        chain.push(b);
        // Replace a–b by a–n1–…–b, with the same track facts.
        if let Some(i) = self.adj[a as usize].iter().position(|x| x.to == b) {
            self.adj[a as usize].remove(i);
        }
        if let Some(i) = self.adj[b as usize].iter().position(|x| x.to == a) {
            self.adj[b as usize].remove(i);
        }
        for w in chain.windows(2) {
            let (x, y) = (w[0], w[1]);
            let len_m = haversine_m(self.nodes[x as usize], self.nodes[y as usize]) as f32;
            self.adj[x as usize].push(Edge { to: y, len_m, ..e });
            self.adj[y as usize].push(Edge { to: x, len_m, ..e });
        }
        out
    }

    /// Nodes within `r_m` of `p`.
    pub fn nodes_near(&self, p: LatLon, r_m: f64) -> Vec<u32> {
        let (r, c) = cell(p);
        let k = (r_m / 111_000.0 / CELL_DEG).ceil() as i32;
        let mut out = Vec::new();
        for dr in -k..=k {
            for dc in -k..=k {
                for &n in self.grid.get(&(r + dr, c + dc)).into_iter().flatten() {
                    if haversine_m(p, self.nodes[n as usize]) <= r_m {
                        out.push(n);
                    }
                }
            }
        }
        out
    }

    /// Draw the siding edges at node `i` (both directions); returns how many.
    pub fn draw_sidings_at(&mut self, i: u32) -> usize {
        let mut ends = Vec::new();
        for e in &mut self.adj[i as usize] {
            if e.siding && !e.drawn {
                e.drawn = true;
                ends.push(e.to);
            }
        }
        for &j in &ends {
            for e in &mut self.adj[j as usize] {
                if e.to == i && e.siding {
                    e.drawn = true;
                }
            }
        }
        ends.len()
    }

    /// Set the station anchors used by [`Router::route_stops`].
    pub fn set_anchors(&mut self, anchors: HashMap<String, Vec<u32>>) {
        self.anchors = anchors;
    }

    /// Nodes where some station sits.
    pub fn anchor_nodes(&self) -> impl Iterator<Item = u32> + '_ {
        self.anchors.values().flatten().copied()
    }

    /// A station's nodes on the track, if it was anchored.
    pub fn anchors_of(&self, code: &str) -> Option<&[u32]> {
        self.anchors
            .get(code)
            .map(Vec::as_slice)
            .filter(|v| !v.is_empty())
    }
}

fn lerp(a: LatLon, b: LatLon, t: f64) -> LatLon {
    LatLon::new(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)
}

/// Tunnels, bridges and covered track (OSM `tunnel`, `bridge`, `covered`).
fn is_structure(props: &serde_json::Value) -> bool {
    ["tunnel", "bridge", "covered"]
        .iter()
        .any(|k| props[*k].as_str().is_some_and(|v| v != "no"))
}

/// OSM `gauge` in mm; dual/mixed gauge ("1668;1435") becomes 1, unknown 0.
fn gauge_of(props: &serde_json::Value) -> u16 {
    match props["gauge"].as_str() {
        Some(g) if g.contains(';') => 1,
        Some(g) => g.trim().parse().unwrap_or(0),
        None => 0,
    }
}

/// OSM `maxspeed` in km/h ("300", "160 km/h"); unknown 0.
fn maxspeed_of(props: &serde_json::Value) -> u16 {
    props["maxspeed"].as_str().map_or(0, |s| {
        s.chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse()
            .unwrap_or(0)
    })
}

/// The value covering the most length, ignoring unknown (0) if anything is known.
pub(crate) fn most_common(by_len: &HashMap<u16, f64>) -> u16 {
    by_len
        .iter()
        .filter(|(k, _)| **k != 0)
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map_or(0, |(k, _)| *k)
}

/// A routed track section, its OSM facts, and the track height at each
/// point (NaN where unknown).
pub type RoutedLeg = (Vec<LatLon>, LegInfo, Vec<f32>);

/// Routes stop sequences along the rail graph, caching each stop pair.
///
/// The cache is shared by every feed (AV/LD/MD, Cercanías, OUIGO), so it's
/// keyed by the stops' coordinates, never by a feed's own stop numbers:
/// stop 5 of one feed is a different place from stop 5 of another.
#[derive(Debug)]
pub struct Router<'g> {
    graph: &'g RailGraph,
    cache: HashMap<([i64; 4], Option<Kind>), Option<RoutedLeg>>,
    pub stats: RouteStats,
}

impl<'g> Router<'g> {
    pub fn new(graph: &'g RailGraph) -> Self {
        Self {
            graph,
            cache: HashMap::new(),
            stats: RouteStats::default(),
        }
    }

    /// Track path between two stops (cached per pair of places), with at
    /// least two points, or `None` if they can't be routed.
    #[cfg(test)]
    pub fn route_pair(&mut self, a: LatLon, b: LatLon) -> Option<RoutedLeg> {
        self.route_stops(("", a), ("", b), None)
    }

    /// Like [`Self::route_pair`], but from and to the stations' anchors on
    /// the track when the stop ids are anchored Renfe stations (else the
    /// nearest track node), preferring track of kind `prefer`.
    pub fn route_stops(
        &mut self,
        (a_id, a): (&str, LatLon),
        (b_id, b): (&str, LatLon),
        prefer: Option<Kind>,
    ) -> Option<RoutedLeg> {
        let (ka, kb) = (node_key(a), node_key(b));
        let graph = self.graph;
        let stats = &mut self.stats;
        self.cache
            .entry(([ka.0, ka.1, kb.0, kb.1], prefer))
            .or_insert_with(|| {
                let ends = |id: &str, p: LatLon| -> Option<Vec<u32>> {
                    match graph.anchors_of(id) {
                        Some(v) => Some(v.to_vec()),
                        None => Some(vec![graph.snap(p)?.0]),
                    }
                };
                let limit = DETOUR_FACTOR * haversine_m(a, b) + DETOUR_SLACK_M;
                let r = ends(a_id, a)
                    .zip(ends(b_id, b))
                    .and_then(|(s, g)| graph.route_nodes(&s, &g, limit, prefer))
                    .filter(|p| p.0.len() >= 2);
                if r.is_some() {
                    stats.pairs_routed += 1;
                } else {
                    stats.pairs_failed += 1;
                }
                r
            })
            .clone()
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// Two parallel east–west lines joined at the east end, plus an
    /// industrial branch (left out). Line 1 runs along lat 40.000 and line 2
    /// along lat 40.020 (~2.2 km apart).
    pub const SAMPLE: &str = concat!(
        "\u{1e}{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.70,40.00],[-3.65,40.00],[-3.60,40.00]]},\"properties\":{\"railway\":\"rail\",\"gauge\":\"1668\",\"maxspeed\":\"160\"}}\n",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.60,40.00],[-3.60,40.02],[-3.70,40.02]]},\"properties\":{\"railway\":\"rail\"}}\n",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.70,40.00],[-3.70,40.02]]},\"properties\":{\"railway\":\"rail\",\"usage\":\"industrial\"}}\n",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.70,40.00],[-3.70,40.02]]},\"properties\":{\"railway\":\"abandoned\"}}\n",
    );

    pub fn sample_graph() -> RailGraph {
        RailGraph::from_geojsonseq(SAMPLE.as_bytes()).unwrap()
    }

    #[test]
    fn builds_graph_joining_shared_nodes() {
        let g = sample_graph();
        assert_eq!(g.node_count(), 5, "shared node at -3.60,40.00 counted once");
    }

    #[test]
    fn routes_along_track_not_through_industrial_branch() {
        let g = sample_graph();
        // West ends of both lines: the branch would be 2.2 km, but it's left
        // out, so the route goes east, up, and back west (~19 km).
        let a = LatLon::new(40.0005, -3.7);
        let b = LatLon::new(40.0195, -3.7);
        let (path, info, _) = g.route(a, b).unwrap();
        assert_eq!(path.len(), 5);
        assert_eq!(info.gauge_mm, 1668, "line 1 tagged Iberian gauge");
        assert_eq!(info.max_kmh, 160);
        let len: f64 = path.windows(2).map(|w| haversine_m(w[0], w[1])).sum();
        assert!((18_000.0..20_000.0).contains(&len), "{len}");
    }

    #[test]
    fn service_track_joins_lines_only_when_needed() {
        // A 1 km gap in the main line bridged by a siding; and a 300 m
        // yard shortcut beside 400 m of main line.
        let text = concat!(
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.70,40.0],[-3.69,40.0]]},\"properties\":{\"railway\":\"rail\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.69,40.0],[-3.68,40.0]]},\"properties\":{\"railway\":\"rail\",\"service\":\"siding\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.68,40.0],[-3.678,40.0016],[-3.676,40.0]]},\"properties\":{\"railway\":\"rail\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.68,40.0],[-3.676,40.0]]},\"properties\":{\"railway\":\"rail\",\"service\":\"yard\"}}\n",
        );
        let g = RailGraph::from_geojsonseq(text.as_bytes()).unwrap();
        let (path, _, _) = g
            .route(LatLon::new(40.0, -3.70), LatLon::new(40.0, -3.676))
            .unwrap();
        assert_eq!(
            path.len(),
            5,
            "through the siding, round the main line: {path:?}"
        );
    }

    #[test]
    fn tunnel_heights_follow_portals_not_terrain() {
        // Portal at 600 m, a 2 km tunnel under a 900 m hill, portal at 700 m.
        let line = concat!(
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.70,40.0],[-3.69,40.0]]},\"properties\":{\"railway\":\"rail\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.69,40.0],[-3.68,40.0],[-3.67,40.0]]},\"properties\":{\"railway\":\"rail\",\"tunnel\":\"yes\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.67,40.0],[-3.66,40.0]]},\"properties\":{\"railway\":\"rail\"}}\n",
        );
        let mut g = RailGraph::from_geojsonseq(line.as_bytes()).unwrap();
        let terrain: HashMap<_, _> = [
            (-3.70, 590.0),
            (-3.69, 600.0),
            (-3.68, 900.0),
            (-3.67, 700.0),
        ]
        .into_iter()
        .map(|(lon, h)| (node_key(LatLon::new(40.0, lon)), h))
        .collect();
        assert_eq!(g.set_heights(&terrain), (4, 1));
        let (_, _, h) = g
            .route(LatLon::new(40.0, -3.70), LatLon::new(40.0, -3.66))
            .unwrap();
        assert_eq!(h[..4], [590.0, 600.0, 650.0, 700.0]);
        assert!(h[4].is_nan(), "no terrain height for the last node");
    }

    #[test]
    fn rejects_far_stops_and_big_detours() {
        let g = sample_graph();
        assert!(g.snap(LatLon::new(41.0, -3.7)).is_none());
        let far = LatLon::new(41.0, -3.7);
        assert!(g.route(LatLon::new(40.0, -3.7), far).is_none());
    }

    #[test]
    fn router_caches_pairs() {
        let g = sample_graph();
        let mut r = Router::new(&g);
        let (a, b) = (LatLon::new(40.0, -3.70), LatLon::new(40.0, -3.65));
        let off = LatLon::new(41.0, -3.65);
        assert_eq!(r.route_pair(a, b).unwrap().0, vec![a, b]);
        assert!(r.route_pair(b, off).is_none());
        assert_eq!((r.stats.pairs_routed, r.stats.pairs_failed), (1, 1));
        r.route_pair(a, b);
        assert_eq!(r.stats.pairs_routed, 1, "cached");
        // Another feed's pair (in another feed it could be "stops 0 and 1"
        // too) is a different place: routed afresh, never the cached path.
        let (c, d) = (LatLon::new(40.02, -3.60), LatLon::new(40.02, -3.70));
        let p = r.route_pair(c, d).unwrap().0;
        assert_eq!((p[0], p[p.len() - 1]), (c, d));
        assert_eq!(r.stats.pairs_routed, 2);
    }
}
