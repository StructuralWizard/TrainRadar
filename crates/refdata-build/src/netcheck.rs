//! `refdata-build validate-net`: does the track network join every pair of
//! consecutive stops that real trains run between?
//!
//! Pairs come from Renfe's live map (`trenesConEstacionesLD.json` snapshots
//! accumulated by `tools/collect-renfe-ld.py`) and, with `--ld`, from the
//! AV/LD/MD timetable. For each pair we look for the shortest path on the
//! track graph between the stations' anchors and flag it when there is none
//! or it is longer than [`MAX_RATIO`] × the straight-line distance.

use crate::osm::RailGraph;
use crate::railnet::{Kind, RenfeStation};
use std::collections::{BTreeMap, HashMap};
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;

/// A path may be at most this many times the straight distance...
pub const MAX_RATIO: f64 = 1.5;
/// ...or this much longer, for short hops where the stations' offsets from
/// the track (up to a few hundred metres) dominate.
pub const MIN_SLACK_M: f64 = 1_000.0;
/// We search up to this far (× straight + 30 km) to tell a detour from no path.
const SEARCH_RATIO: f64 = 3.0;
const SEARCH_SLACK_M: f64 = 30_000.0;

/// Where a pair was seen.
#[derive(Debug, Default, Clone)]
pub struct Seen {
    /// Live snapshots in which a train ran between the two (either way).
    pub live: u32,
    /// In the timetable (GTFS) window.
    pub timetable: bool,
    /// A few train numbers, for looking them up.
    pub trains: Vec<String>,
}

/// Unordered pair of station codes.
pub type PairKey = (String, String);

pub fn key(a: &str, b: &str) -> PairKey {
    if a <= b {
        (a.to_owned(), b.to_owned())
    } else {
        (b.to_owned(), a.to_owned())
    }
}

/// Read `tools/collect-renfe-ld.py` output: `a<TAB>b<TAB>snapshots<TAB>trains`.
pub fn read_pairs(text: &str, into: &mut BTreeMap<PairKey, Seen>) {
    for line in text.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 2 || f[0].starts_with('#') || f[0] == f[1] {
            continue;
        }
        let s = into.entry(key(f[0].trim(), f[1].trim())).or_default();
        s.live += f.get(2).and_then(|n| n.trim().parse().ok()).unwrap_or(1);
        for t in f.get(3).into_iter().flat_map(|t| t.split(',')) {
            let t = t.trim();
            if !t.is_empty() && s.trains.len() < 5 && !s.trains.iter().any(|x| x == t) {
                s.trains.push(t.to_owned());
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    Ok,
    /// A station code we have no coordinates for.
    UnknownStation(String),
    /// A station with no track near it.
    NotOnTrack(String),
    /// No path within the search distance.
    NoPath,
    /// A path, but too long.
    Detour,
}

impl Status {
    pub fn label(&self) -> String {
        match self {
            Status::Ok => "ok".into(),
            Status::UnknownStation(c) => format!("unknown station {c}"),
            Status::NotOnTrack(c) => format!("station {c} not on track"),
            Status::NoPath => "no path".into(),
            Status::Detour => "detour".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Checked {
    pub a: String,
    pub b: String,
    pub straight_m: f64,
    /// Path length, when there is a path.
    pub path_m: Option<f64>,
    /// Share of the path on each kind of track (AV, conventional, metre).
    pub kinds: [f64; 3],
    pub status: Status,
    pub seen: Seen,
}

impl Checked {
    pub fn ratio(&self) -> Option<f64> {
        self.path_m.map(|p| p / self.straight_m.max(1.0))
    }
}

/// Check every pair. `extra` gives coordinates for stops that aren't in the
/// Renfe station list (e.g. from the GTFS).
pub fn check(
    g: &RailGraph,
    stations: &[RenfeStation],
    extra: &HashMap<String, LatLon>,
    pairs: &BTreeMap<PairKey, Seen>,
) -> Vec<Checked> {
    let at: HashMap<&str, LatLon> = extra
        .iter()
        .map(|(c, p)| (c.as_str(), *p))
        .chain(stations.iter().map(|s| (s.code.as_str(), s.at)))
        .collect();
    let ends = |code: &str| -> std::result::Result<(LatLon, Vec<u32>), Status> {
        let p = *at
            .get(code)
            .ok_or_else(|| Status::UnknownStation(code.to_owned()))?;
        match g.anchors_of(code) {
            Some(v) => Ok((p, v.to_vec())),
            None => g
                .snap(p)
                .map(|(n, _)| (p, vec![n]))
                .ok_or_else(|| Status::NotOnTrack(code.to_owned())),
        }
    };
    let mut out = Vec::with_capacity(pairs.len());
    for ((a, b), seen) in pairs {
        let mut c = Checked {
            a: a.clone(),
            b: b.clone(),
            straight_m: 0.0,
            path_m: None,
            kinds: [0.0; 3],
            status: Status::Ok,
            seen: seen.clone(),
        };
        match (ends(a), ends(b)) {
            (Err(s), _) | (_, Err(s)) => c.status = s,
            (Ok((pa, sa)), Ok((pb, sb))) => {
                c.straight_m = haversine_m(pa, pb);
                let limit = SEARCH_RATIO * c.straight_m + SEARCH_SLACK_M;
                match g.search(&sa, &sb, limit, None) {
                    None => c.status = Status::NoPath,
                    Some((ids, len)) => {
                        c.path_m = Some(len);
                        let mut by = [0.0; 3];
                        for w in ids.windows(2) {
                            if let Some(e) = g.edge(w[0], w[1]) {
                                by[usize::from(e.kind.code() - 1)] += f64::from(e.len_m);
                            }
                        }
                        let total: f64 = by.iter().sum::<f64>().max(1.0);
                        c.kinds = by.map(|x| x / total);
                        let allowed = (MAX_RATIO * c.straight_m).max(c.straight_m + MIN_SLACK_M);
                        if len > allowed {
                            c.status = Status::Detour;
                        }
                    }
                }
            }
        }
        out.push(c);
    }
    out
}

fn kinds_label(k: &[f64; 3]) -> String {
    Kind::ALL
        .iter()
        .zip(k)
        .filter(|(_, x)| **x >= 0.005)
        .map(|(kind, x)| format!("{} {:.0}%", kind.name(), x * 100.0))
        .collect::<Vec<_>>()
        .join(" + ")
}

/// Markdown report: a summary, then every failing pair (most-seen first).
pub fn markdown(checked: &[Checked], names: &HashMap<String, String>) -> String {
    let name = |c: &str| names.get(c).map_or(c.to_owned(), |n| format!("{n} ({c})"));
    let count = |f: &dyn Fn(&Checked) -> bool| checked.iter().filter(|c| f(c)).count();
    let mut s = String::from("# Track network validation\n\n");
    s.push_str(&format!(
        "Rule: a track path between consecutive stops, at most {MAX_RATIO} × the straight \
         distance (or straight + {:.0} km for short hops).\n\n",
        MIN_SLACK_M / 1000.0
    ));
    s.push_str("| Pairs | Live | Timetable | OK | No path | Detour | Station off track | Unknown station |\n");
    s.push_str("|---:|---:|---:|---:|---:|---:|---:|---:|\n");
    s.push_str(&format!(
        "| {} | {} | {} | {} | {} | {} | {} | {} |\n\n",
        checked.len(),
        count(&|c| c.seen.live > 0),
        count(&|c| c.seen.timetable),
        count(&|c| c.status == Status::Ok),
        count(&|c| c.status == Status::NoPath),
        count(&|c| c.status == Status::Detour),
        count(&|c| matches!(c.status, Status::NotOnTrack(_))),
        count(&|c| matches!(c.status, Status::UnknownStation(_))),
    ));
    let mut bad: Vec<&Checked> = checked.iter().filter(|c| c.status != Status::Ok).collect();
    bad.sort_by(|x, y| {
        (y.seen.live, y.seen.timetable)
            .cmp(&(x.seen.live, x.seen.timetable))
            .then(x.a.cmp(&y.a))
    });
    if bad.is_empty() {
        s.push_str("Every pair passes.\n");
        return s;
    }
    s.push_str("## Failing pairs\n\n");
    s.push_str("| From | To | Straight km | Path km | Ratio | Problem | Seen | Trains |\n");
    s.push_str("|---|---|---:|---:|---:|---|---|---|\n");
    for c in bad {
        s.push_str(&format!(
            "| {} | {} | {:.1} | {} | {} | {} | {} | {} |\n",
            name(&c.a),
            name(&c.b),
            c.straight_m / 1000.0,
            c.path_m
                .map_or("–".into(), |p| format!("{:.1}", p / 1000.0)),
            c.ratio().map_or("–".into(), |r| format!("{r:.2}")),
            c.status.label(),
            match (c.seen.live, c.seen.timetable) {
                (0, _) => "timetable".to_owned(),
                (n, true) => format!("live ×{n}, timetable"),
                (n, false) => format!("live ×{n}"),
            },
            c.seen.trains.join(" "),
        ));
    }
    s
}

/// CSV of every pair checked.
pub fn csv(checked: &[Checked], names: &HashMap<String, String>) -> String {
    let q = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
    let mut s = String::from(
        "from,from_name,to,to_name,straight_km,path_km,ratio,status,kinds,live_snapshots,timetable,trains\n",
    );
    for c in checked {
        let n = |x: &str| q(names.get(x).map_or("", String::as_str));
        s.push_str(&format!(
            "{},{},{},{},{:.2},{},{},{},{},{},{},{}\n",
            c.a,
            n(&c.a),
            c.b,
            n(&c.b),
            c.straight_m / 1000.0,
            c.path_m
                .map_or(String::new(), |p| format!("{:.2}", p / 1000.0)),
            c.ratio().map_or(String::new(), |r| format!("{r:.3}")),
            q(&c.status.label()),
            q(&kinds_label(&c.kinds)),
            c.seen.live,
            c.seen.timetable,
            q(&c.seen.trains.join(" ")),
        ));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph() -> RailGraph {
        // An L: 10 km east, then 10 km north; and a separate line far away.
        let text = concat!(
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.70,40.00],[-3.5826,40.00],[-3.5826,40.0899]]},\"properties\":{\"railway\":\"rail\",\"gauge\":\"1668\"}}\n",
            "{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":",
            "[[-3.00,41.00],[-2.90,41.00]]},\"properties\":{\"railway\":\"rail\",\"gauge\":\"1668\"}}\n",
        );
        RailGraph::from_geojsonseq(text.as_bytes()).unwrap()
    }

    fn st(code: &str, lat: f64, lon: f64) -> RenfeStation {
        RenfeStation {
            code: code.into(),
            name: code.into(),
            level: 2,
            at: LatLon::new(lat, lon),
        }
    }

    #[test]
    fn flags_detours_missing_links_and_unknown_stations() {
        let mut g = graph();
        let stations = [
            st("W", 40.0, -3.70),      // west end of the L
            st("C", 40.0, -3.5826),    // corner
            st("N", 40.0899, -3.5826), // north end
            st("F", 41.0, -2.95),      // on the other line
        ];
        g.anchor_stations(&stations);
        let mut pairs = BTreeMap::new();
        read_pairs(
            "W\tC\t3\t123,456\nC\tN\t1\t789\nW\tN\t1\t1\nN\tF\t2\t9\nW\tZ\t1\t\n",
            &mut pairs,
        );
        let r = check(&g, &stations, &HashMap::new(), &pairs);
        let status = |a: &str, b: &str| {
            r.iter()
                .find(|c| (c.a.as_str(), c.b.as_str()) == (a, b))
                .unwrap()
        };
        assert_eq!(status("C", "W").status, Status::Ok);
        assert_eq!(status("C", "W").seen.trains, ["123", "456"]);
        assert_eq!(status("C", "W").kinds, [0.0, 1.0, 0.0]);
        assert_eq!(status("C", "N").status, Status::Ok);
        // W→N: 20 km of track for ~13.5 km straight: ratio 1.48, just OK.
        assert_eq!(status("N", "W").status, Status::Ok);
        assert_eq!(status("F", "N").status, Status::NoPath);
        assert_eq!(status("W", "Z").status, Status::UnknownStation("Z".into()));
        let md = markdown(&r, &HashMap::new());
        assert!(
            md.contains("no path") && md.contains("unknown station Z"),
            "{md}"
        );
    }
}
