//! Track geometry from OpenStreetMap, for trips whose GTFS has no shape
//! (all of AV/LD/MD, and the few Cercanías trips whose shape doesn't fit).
//!
//! Input: OSM `railway=rail` ways exported by `osmium export -f geojsonseq`
//! (see `tools/fetch-osm-rail.sh`). We build a graph where ways that share an
//! OSM node connect, then route each pair of consecutive stops with A*.
//!
//! OSM data © OpenStreetMap contributors, ODbL 1.0. Shapes derived from it are
//! published under the ODbL with the generated files.

use crate::gtfs_io::Result;
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

/// Track kinds that aren't through running lines.
const SKIP_SERVICE: &[&str] = &["yard", "siding", "spur"];

/// Snapping grid cell in degrees (~1.1 km).
const CELL_DEG: f64 = 0.01;

#[derive(Debug, Default)]
pub struct RailGraph {
    nodes: Vec<LatLon>,
    /// (neighbour, length m, gauge mm, max km/h)
    adj: Vec<Vec<(u32, f32, u16, u16)>>,
    grid: HashMap<(i32, i32), Vec<u32>>,
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
            if props["railway"] != "rail" {
                continue;
            }
            if props["service"]
                .as_str()
                .is_some_and(|s| SKIP_SERVICE.contains(&s))
            {
                continue;
            }
            let geom = &f["geometry"];
            let lines: Vec<&serde_json::Value> = match geom["type"].as_str() {
                Some("LineString") => vec![&geom["coordinates"]],
                Some("MultiLineString") => geom["coordinates"]
                    .as_array()
                    .map(|a| a.iter().collect())
                    .unwrap_or_default(),
                _ => continue,
            };
            for coords in lines {
                let pts: Vec<LatLon> = coords
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| Some(LatLon::new(c.get(1)?.as_f64()?, c.get(0)?.as_f64()?)))
                    .collect();
                g.add_line(&pts, &mut ids, gauge_of(props), maxspeed_of(props));
            }
        }
        Ok(g)
    }

    /// Add a polyline; points with identical coordinates (shared OSM nodes) join.
    fn add_line(
        &mut self,
        pts: &[LatLon],
        ids: &mut HashMap<(i64, i64), u32>,
        gauge: u16,
        maxspeed: u16,
    ) {
        let mut prev: Option<u32> = None;
        for &p in pts {
            let key = ((p.lat * 1e7).round() as i64, (p.lon * 1e7).round() as i64);
            let id = *ids.entry(key).or_insert_with(|| {
                self.nodes.push(p);
                self.adj.push(Vec::new());
                let id = (self.nodes.len() - 1) as u32;
                self.grid.entry(cell(p)).or_default().push(id);
                id
            });
            if let Some(q) = prev.filter(|&q| q != id) {
                let d = haversine_m(self.nodes[q as usize], p) as f32;
                self.adj[q as usize].push((id, d, gauge, maxspeed));
                self.adj[id as usize].push((q, d, gauge, maxspeed));
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
    pub fn route(&self, a: LatLon, b: LatLon) -> Option<RoutedLeg> {
        let (sa, _) = self.snap(a)?;
        let (sb, _) = self.snap(b)?;
        if sa == sb {
            return Some((vec![self.nodes[sa as usize]], LegInfo::default()));
        }
        let goal = self.nodes[sb as usize];
        let limit = DETOUR_FACTOR * haversine_m(a, b) + DETOUR_SLACK_M;
        let mut dist: HashMap<u32, f64> = HashMap::new();
        let mut prev: HashMap<u32, u32> = HashMap::new();
        let mut heap = BinaryHeap::new();
        dist.insert(sa, 0.0);
        heap.push(Item {
            f: haversine_m(self.nodes[sa as usize], goal),
            node: sa,
        });
        while let Some(Item { f, node }) = heap.pop() {
            if node == sb {
                let mut path = vec![self.nodes[sb as usize]];
                let mut gauge: HashMap<u16, f64> = HashMap::new();
                let mut speed: HashMap<u16, f64> = HashMap::new();
                let mut n = sb;
                while let Some(&p) = prev.get(&n) {
                    if let Some(e) = self.adj[p as usize].iter().find(|e| e.0 == n) {
                        *gauge.entry(e.2).or_default() += f64::from(e.1);
                        *speed.entry(e.3).or_default() += f64::from(e.1);
                    }
                    path.push(self.nodes[p as usize]);
                    n = p;
                }
                path.reverse();
                let info = LegInfo {
                    gauge_mm: most_common(&gauge),
                    max_kmh: most_common(&speed),
                };
                return Some((path, info));
            }
            if f > limit {
                return None; // the best remaining estimate is already too long
            }
            let g = dist[&node];
            for &(next, len, _, _) in &self.adj[node as usize] {
                let ng = g + f64::from(len);
                if dist.get(&next).is_none_or(|&d| ng < d) {
                    dist.insert(next, ng);
                    prev.insert(next, node);
                    heap.push(Item {
                        f: ng + haversine_m(self.nodes[next as usize], goal),
                        node: next,
                    });
                }
            }
        }
        None
    }
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
fn most_common(by_len: &HashMap<u16, f64>) -> u16 {
    by_len
        .iter()
        .filter(|(k, _)| **k != 0)
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map_or(0, |(k, _)| *k)
}

/// A routed track section and its OSM facts.
pub type RoutedLeg = (Vec<LatLon>, LegInfo);

/// Routes stop sequences along the rail graph, caching each stop pair.
#[derive(Debug)]
pub struct Router<'g> {
    graph: &'g RailGraph,
    cache: HashMap<(usize, usize), Option<RoutedLeg>>,
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

    /// Track path between two stops (cached per stop pair), with at least two
    /// points, or `None` if they can't be routed.
    pub fn route_pair(
        &mut self,
        a_id: usize,
        b_id: usize,
        a: LatLon,
        b: LatLon,
    ) -> Option<RoutedLeg> {
        let graph = self.graph;
        let stats = &mut self.stats;
        self.cache
            .entry((a_id, b_id))
            .or_insert_with(|| {
                let r = graph.route(a, b).filter(|p| p.0.len() >= 2);
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

    /// Two parallel east–west lines joined at the east end, plus a siding.
    /// Line 1 runs along lat 40.000 and line 2 along lat 40.020 (~2.2 km apart).
    pub const SAMPLE: &str = concat!(
        "\u{1e}{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.70,40.00],[-3.65,40.00],[-3.60,40.00]]},\"properties\":{\"railway\":\"rail\",\"gauge\":\"1668\",\"maxspeed\":\"160\"}}\n",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.60,40.00],[-3.60,40.02],[-3.70,40.02]]},\"properties\":{\"railway\":\"rail\"}}\n",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
        "[[-3.70,40.00],[-3.70,40.02]]},\"properties\":{\"railway\":\"rail\",\"service\":\"siding\"}}\n",
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
    fn routes_along_track_not_through_siding() {
        let g = sample_graph();
        // West ends of both lines: the siding would be 2.2 km, but it's skipped,
        // so the route goes east, up, and back west (~19 km).
        let a = LatLon::new(40.0005, -3.7);
        let b = LatLon::new(40.0195, -3.7);
        let (path, info) = g.route(a, b).unwrap();
        assert_eq!(path.len(), 5);
        assert_eq!(info.gauge_mm, 1668, "line 1 tagged Iberian gauge");
        assert_eq!(info.max_kmh, 160);
        let len: f64 = path.windows(2).map(|w| haversine_m(w[0], w[1])).sum();
        assert!((18_000.0..20_000.0).contains(&len), "{len}");
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
        assert_eq!(r.route_pair(0, 1, a, b).unwrap().0, vec![a, b]);
        assert!(r.route_pair(1, 2, b, off).is_none());
        assert_eq!((r.stats.pairs_routed, r.stats.pairs_failed), (1, 1));
        r.route_pair(0, 1, a, b);
        assert_eq!(r.stats.pairs_routed, 1, "cached");
    }
}
