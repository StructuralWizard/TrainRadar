//! Journeys with changes: from one set of stations to another, by the
//! loaded timetables and the live delays, with up to `max_changes` changes
//! of train. Changes are at the same station or a short walk to a nearby
//! one (Madrid-Puerta de Atocha's AVE platforms → Atocha Cercanías).
//!
//! The search is round-based (RAPTOR): round k finds the earliest arrival
//! at every station with k trains. The answers are the Pareto set over
//! (arrival, changes) for one departure time; the caller asks again from a
//! later time for the next options.

use crate::live::Live;
use crate::network::{Network, TripRef};
use std::collections::{HashMap, HashSet};
use trainradar_proto::LatLon;
use trainradar_proto::time::{madrid_day, service_day_base};

/// Minimum change time at one station, in seconds.
pub const CHANGE_SECS: i64 = 5 * 60;
/// Minimum change time when the next train is long distance (region `ld`):
/// AVE and Alvia close boarding before departure.
pub const CHANGE_LD_SECS: i64 = 10 * 60;
/// Walks between stations no further apart than this (straight line).
pub const WALK_MAX_M: f64 = 700.0;
/// In Great Britain: London's terminals are further apart (Euston ↔ King's
/// Cross and St Pancras, ~800 m). The Underground isn't in the data.
pub const WALK_MAX_UK_M: f64 = 1_000.0;
/// Walking: straight-line distance × 1.3 at 1.1 m/s, plus 3 minutes.
fn walk_secs(m: f64) -> i64 {
    (m * 1.3 / 1.1).round() as i64 + 180
}
/// Faster than any train, straight line (m/s): 330 km/h in Spain (AVE at
/// 310), 250 km/h in the UK (HS1 at 225). For a lower bound on the time
/// left to the destination, so the search skips stations that can't help.
const VMAX_MS: f64 = 330.0 / 3.6;
const VMAX_UK_MS: f64 = 250.0 / 3.6;
/// A train is caught only if it leaves within this time of being ready.
const WAIT_MAX_SECS: i64 = 6 * 3_600;
/// Trains scheduled up to this long before being ready are still checked
/// (running late, they may yet be caught).
const LATE_MAX_SECS: i64 = 90 * 60;

/// One train of a journey.
#[derive(Debug, Clone, PartialEq)]
pub struct Ride {
    pub trip: TripRef,
    pub trip_id: String,
    pub route: String,
    pub number: String,
    /// The train's last stop (its destination, for the sign).
    pub headsign: String,
    pub from: String,
    pub to: String,
    pub from_pos: u16,
    pub to_pos: u16,
    pub sched_dep: i64,
    pub sched_arr: i64,
    pub delay: Option<i32>,
    /// On the map now (its delay is from its position).
    pub live: bool,
}

impl Ride {
    pub fn expected_dep(&self) -> i64 {
        self.sched_dep + i64::from(self.delay.unwrap_or(0))
    }
    pub fn expected_arr(&self) -> i64 {
        self.sched_arr + i64::from(self.delay.unwrap_or(0))
    }
}

/// A walk between two stations (a change, or to or from the ends).
#[derive(Debug, Clone, PartialEq)]
pub struct Walk {
    pub from: String,
    pub to: String,
    pub secs: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Ride(Ride),
    Walk(Walk),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Journey {
    pub steps: Vec<Step>,
}

impl Journey {
    pub fn rides(&self) -> impl Iterator<Item = &Ride> {
        self.steps.iter().filter_map(|s| match s {
            Step::Ride(r) => Some(r),
            Step::Walk(_) => None,
        })
    }
    pub fn changes(&self) -> usize {
        self.rides().count().saturating_sub(1)
    }
    /// Expected departure of the first train.
    pub fn dep(&self) -> i64 {
        self.rides().next().map_or(0, Ride::expected_dep)
    }
    /// Expected arrival at the end (after a final walk, if any).
    pub fn arr(&self) -> i64 {
        let mut t = 0;
        for s in &self.steps {
            match s {
                Step::Ride(r) => t = r.expected_arr(),
                Step::Walk(w) => t += w.secs,
            }
        }
        t
    }
    /// The shortest margin of any change (expected arrival → expected
    /// departure, after walking), in seconds: below the minimum change
    /// time, the connection is at risk.
    pub fn tightest_change(&self) -> Option<i64> {
        let mut out: Option<i64> = None;
        let mut prev_arr: Option<i64> = None;
        let mut walked = 0;
        for s in &self.steps {
            match s {
                Step::Walk(w) => walked += w.secs,
                Step::Ride(r) => {
                    if let Some(a) = prev_arr {
                        let m = r.expected_dep() - a - walked;
                        out = Some(out.map_or(m, |o| o.min(m)));
                    }
                    prev_arr = Some(r.expected_arr());
                    walked = 0;
                }
            }
        }
        out
    }
    fn key(&self) -> String {
        self.rides()
            .map(|r| format!("{}@{}", r.trip_id, r.sched_dep))
            .collect::<Vec<_>>()
            .join(">")
    }
}

/// How a station was reached in a round.
#[derive(Debug, Clone)]
enum Label {
    Start,
    Ride {
        trip: TripRef,
        start: i64,
        delay: Option<i32>,
        live: bool,
        board: u32,
        board_pos: u16,
        alight_pos: u16,
    },
    Walk {
        from: u32,
        secs: i64,
    },
}

/// Station ids ↔ dense indexes, and walks between nearby stations.
struct Stations<'a> {
    ids: Vec<&'a str>,
    index: HashMap<&'a str, u32>,
    coord: Vec<Option<LatLon>>,
    /// Per region, per timetable stop: its dense index (no string lookups
    /// in the search's inner loop).
    of_stop: Vec<Vec<u32>>,
}

impl<'a> Stations<'a> {
    fn new(net: &'a Network) -> Self {
        let mut s = Stations {
            ids: Vec::new(),
            index: HashMap::new(),
            coord: Vec::new(),
            of_stop: Vec::new(),
        };
        let file: HashMap<&str, LatLon> = net
            .stations
            .as_ref()
            .map(|f| {
                f.stations
                    .iter()
                    .map(|x| (x.id.as_str(), x.coord()))
                    .collect()
            })
            .unwrap_or_default();
        for r in &net.regions {
            let mut of = Vec::with_capacity(r.tt.stops.len());
            for st in &r.tt.stops {
                let id = st.id.as_str();
                if let Some(&i) = s.index.get(id) {
                    of.push(i);
                    continue;
                }
                let i = s.ids.len() as u32;
                s.index.insert(id, i);
                s.ids.push(id);
                s.coord
                    .push(Some(file.get(id).copied().unwrap_or_else(|| st.coord())));
                of.push(i);
            }
            s.of_stop.push(of);
        }
        s
    }

    fn get(&self, id: &str) -> Option<u32> {
        self.index.get(id).copied()
    }

    /// Walks from each station to the others within `max_m`.
    fn walks(&self, max_m: f64) -> Vec<Vec<(u32, i64)>> {
        // A grid of cells at least `max_m` wide up to 60° north (a degree of
        // longitude is ≥ 55.5 km there), neighbours in the 3 × 3 cells around.
        let per_deg = 55_500.0 / max_m;
        let cell = |p: LatLon| {
            (
                (p.lat * per_deg).floor() as i32,
                (p.lon * per_deg).floor() as i32,
            )
        };
        let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (i, c) in self.coord.iter().enumerate() {
            if let Some(p) = c {
                grid.entry(cell(*p)).or_default().push(i as u32);
            }
        }
        let mut out = vec![Vec::new(); self.ids.len()];
        for (i, c) in self.coord.iter().enumerate() {
            let Some(p) = c else { continue };
            let (y, x) = cell(*p);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    for &j in grid.get(&(y + dy, x + dx)).map_or(&[][..], Vec::as_slice) {
                        if j as usize == i {
                            continue;
                        }
                        let d =
                            trainradar_proto::geo::haversine_m(*p, self.coord[j as usize].unwrap());
                        if d <= max_m {
                            out[i].push((j, walk_secs(d)));
                        }
                    }
                }
            }
        }
        out
    }
}

/// Journeys from any of `from` to any of `to` leaving at or after `after`
/// (unix seconds), with at most `max_changes` changes: the fastest for each
/// number of changes, then the same again from later departures, until
/// `limit` journeys are found or `window_secs` after `after` is passed.
/// Sorted by departure, then arrival.
#[derive(Debug, Clone, Copy)]
pub struct Query<'q> {
    pub from: &'q [&'q str],
    pub to: &'q [&'q str],
    /// Unix seconds.
    pub after: i64,
    pub max_changes: usize,
    pub limit: usize,
    pub window_secs: i64,
}

pub fn journeys(net: &Network, live: &Live, q: &Query) -> Vec<Journey> {
    let Query {
        from,
        to,
        after,
        max_changes,
        limit,
        window_secs,
    } = *q;
    let st = Stations::new(net);
    // Great Britain's, Northern Ireland's and Ireland's timetables: longer
    // walks (London's and Dublin's terminals are a walk apart).
    let uk = net.regions.iter().any(|r| {
        matches!(
            r.tt.region.as_str(),
            "uk" | crate::networkrail::NI_REGION | crate::networkrail::IE_REGION
        )
    });
    // Paris's terminals too (Gare du Nord and Gare de l'Est); France keeps
    // the high-speed bound below.
    let fr = net
        .regions
        .iter()
        .any(|r| crate::france::is_french_region(&r.tt.region));
    let walks = st.walks(if uk || fr { WALK_MAX_UK_M } else { WALK_MAX_M });
    let src: Vec<u32> = from.iter().filter_map(|s| st.get(s)).collect();
    let dst: HashSet<u32> = to.iter().filter_map(|s| st.get(s)).collect();
    if src.is_empty() || dst.is_empty() || src.iter().any(|s| dst.contains(s)) {
        return Vec::new();
    }
    // Lower bound on the time from each station to the destination.
    let vmax = if uk { VMAX_UK_MS } else { VMAX_MS };
    let ends: Vec<LatLon> = dst.iter().filter_map(|&d| st.coord[d as usize]).collect();
    let lb: Vec<i64> = st
        .coord
        .iter()
        .map(|c| match c {
            Some(p) if !ends.is_empty() => ends
                .iter()
                .map(|e| (trainradar_proto::geo::haversine_m(*p, *e) / vmax) as i64)
                .min()
                .unwrap_or(0),
            _ => 0,
        })
        .collect();
    let delays = Delays::new(net, live);
    let mut out: Vec<Journey> = Vec::new();
    let mut seen = HashSet::new();
    let mut t = after;
    // Each pass finds the best journeys leaving at or after `t`; the next
    // pass starts a minute after the earliest of them.
    // Several passes can give the same last train (leaving earlier only to
    // wait longer): those are dropped below, so allow more passes.
    for _ in 0..limit.max(1) * 6 {
        let arrivals: HashSet<i64> = out.iter().map(Journey::arr).collect();
        if arrivals.len() >= limit || t > after + window_secs {
            break;
        }
        let found = search(
            net,
            &Ctx {
                st: &st,
                walks: &walks,
                delays: &delays,
                lb: &lb,
            },
            &src,
            &dst,
            t,
            max_changes,
        );
        let Some(first) = found.iter().map(Journey::dep).min() else {
            break;
        };
        for j in found {
            if seen.insert(j.key()) {
                out.push(j);
            }
        }
        t = t.max(first + 60);
    }
    // Keep a journey only if no other leaves later (or as late), arrives
    // sooner (or as soon) with no more changes, and is better in one.
    let dominated = |j: &Journey| {
        out.iter().any(|k| {
            k.dep() >= j.dep()
                && k.arr() <= j.arr()
                && k.changes() <= j.changes()
                && (k.dep() > j.dep() || k.arr() < j.arr() || k.changes() < j.changes())
        })
    };
    let mut kept: Vec<Journey> = out.iter().filter(|j| !dominated(j)).cloned().collect();
    kept.sort_by_key(|j| (j.dep(), j.arr()));
    kept.truncate(limit);
    kept
}

/// Live delays and cancellations, looked up once per trip run.
struct Delays<'a> {
    live: &'a Live,
    on_map: HashMap<(TripRef, i64), Option<i32>>,
}

impl<'a> Delays<'a> {
    fn new(_net: &Network, live: &'a Live) -> Self {
        let on_map = live
            .trains
            .iter()
            .filter_map(|t| Some(((t.matched?.trip, t.matched?.day), t.delay)))
            .collect();
        Delays { live, on_map }
    }
    /// (delay, canceled, on the map) of a trip run.
    fn of(&self, trip_id: &str, tref: TripRef, day: i64) -> (Option<i32>, bool, bool) {
        let on = self.on_map.get(&(tref, day));
        let tu = self.live.trip_update(trip_id);
        let delay = on.copied().flatten().or(tu.and_then(|u| u.delay));
        (delay, tu.is_some_and(|u| u.canceled), on.is_some())
    }
}

#[allow(clippy::too_many_arguments)]
/// What every pass of one query shares.
struct Ctx<'c> {
    st: &'c Stations<'c>,
    walks: &'c [Vec<(u32, i64)>],
    delays: &'c Delays<'c>,
    /// Lower bound (s) from each station to the destination.
    lb: &'c [i64],
}

fn search(
    net: &Network,
    ctx: &Ctx,
    src: &[u32],
    dst: &HashSet<u32>,
    after: i64,
    max_changes: usize,
) -> Vec<Journey> {
    let Ctx {
        st,
        walks,
        delays,
        lb,
    } = *ctx;
    let n = st.ids.len();
    let rounds = max_changes + 1;
    // best[s]: earliest arrival at s in any round so far (pruning).
    let mut best = vec![i64::MAX; n];
    // arr[k][s] and label[k][s]: round k (k trains).
    let mut arr = vec![vec![i64::MAX; n]; rounds + 1];
    let mut label: Vec<Vec<Option<Label>>> = vec![vec![None; n]; rounds + 1];
    let mut marked: Vec<u32> = Vec::new();
    for &s in src {
        arr[0][s as usize] = after;
        best[s as usize] = after;
        label[0][s as usize] = Some(Label::Start);
        marked.push(s);
    }
    // Walk from the start to nearby stations.
    for &s in src {
        for &(j, w) in &walks[s as usize] {
            let t = after + w;
            if t < arr[0][j as usize] {
                arr[0][j as usize] = t;
                best[j as usize] = t;
                label[0][j as usize] = Some(Label::Walk { from: s, secs: w });
                marked.push(j);
            }
        }
    }
    let best_dst = |best: &[i64]| {
        dst.iter()
            .map(|&d| best[d as usize])
            .min()
            .unwrap_or(i64::MAX)
    };

    for k in 1..=rounds {
        let mut improved: Vec<u32> = Vec::new();
        // Each (region, pattern) once per round, from its earliest boarding.
        let mut boards: HashMap<(usize, u32), (u16, u32, i64)> = HashMap::new();
        marked.sort_unstable();
        marked.dedup();
        for &s in &marked {
            let ready_at = arr[k - 1][s as usize];
            if ready_at == i64::MAX {
                continue;
            }
            let id = st.ids[s as usize];
            for (ri, r) in net.regions.iter().enumerate() {
                let Some(calls) = r.calls.get(id) else {
                    continue;
                };
                for &(pi, pos) in calls {
                    let e = boards.entry((ri, pi)).or_insert((pos, s, ready_at));
                    // Prefer the earlier stop on the pattern (more of the
                    // train to ride), then the earlier ready time.
                    if (pos, ready_at) < (e.0, e.2) {
                        *e = (pos, s, ready_at);
                    }
                }
            }
        }
        for ((ri, pi), (pos0, _, _)) in std::mem::take(&mut boards) {
            let r = &net.regions[ri];
            let sched = &r.sched[pi as usize];
            let pattern = &r.tt.patterns[pi as usize];
            let zone = r.zone;
            let change = if r.tt.region == "ld" {
                CHANGE_LD_SECS
            } else {
                CHANGE_SECS
            };
            // The trip being ridden: (start, delay, live, board stop index, board pos).
            let mut cur: Option<(TripRef, i64, Option<i32>, bool, u32, u16)> = None;
            for pos in pos0 as usize..sched.len() {
                let stop = st.of_stop[ri][pattern.stops[pos] as usize];
                // Alight here?
                if let Some((tref, start, delay, is_live, b, bpos)) = cur {
                    let a = start + i64::from(sched[pos].arrival) + i64::from(delay.unwrap_or(0));
                    if a < best[stop as usize] && a + lb[stop as usize] < best_dst(&best) {
                        arr[k][stop as usize] = a;
                        best[stop as usize] = a;
                        label[k][stop as usize] = Some(Label::Ride {
                            trip: tref,
                            start,
                            delay,
                            live: is_live,
                            board: b,
                            board_pos: bpos,
                            alight_pos: pos as u16,
                        });
                        improved.push(stop);
                    }
                }
                if pos + 1 == sched.len() {
                    break;
                }
                // Board here (or an earlier run of the pattern)?
                let ready = arr[k - 1][stop as usize];
                if ready == i64::MAX || ready + lb[stop as usize] >= best_dst(&best) {
                    continue;
                }
                // A change: the minimum change time (a walk already
                // counts 3 minutes of it).
                let ready = ready
                    + match label[k - 1][stop as usize] {
                        Some(Label::Ride { .. }) if k > 1 => change,
                        Some(Label::Walk { .. }) if k > 1 => change - 180,
                        _ => 0,
                    };
                let cur_dep = cur.map(|(_, start, d, ..)| {
                    start + i64::from(sched[pos].departure) + i64::from(d.unwrap_or(0))
                });
                if cur_dep.is_some_and(|d| d <= ready) {
                    continue; // the train being ridden is no better
                }
                if let Some(c) = earliest_run(net, delays, ri, pi, pos, ready, zone) {
                    let dep = c.1 + i64::from(sched[pos].departure) + i64::from(c.2.unwrap_or(0));
                    if cur_dep.is_none_or(|d| dep < d) {
                        cur = Some((c.0, c.1, c.2, c.3, stop, pos as u16));
                    }
                }
            }
        }
        // Walks after this round's rides (not walk after walk).
        let mut walked = Vec::new();
        for &s in &improved {
            let a = arr[k][s as usize];
            for &(j, w) in &walks[s as usize] {
                let t = a + w;
                if t < best[j as usize] && t + lb[j as usize] < best_dst(&best) {
                    arr[k][j as usize] = t;
                    best[j as usize] = t;
                    label[k][j as usize] = Some(Label::Walk { from: s, secs: w });
                    walked.push(j);
                }
            }
        }
        improved.extend(walked);
        if improved.is_empty() {
            break;
        }
        marked = improved;
    }

    // One journey per round that reaches the destination sooner than fewer
    // trains did.
    let mut out = Vec::new();
    let mut prev = i64::MAX;
    for (k, at) in arr.iter().enumerate().skip(1) {
        let Some(&d) = dst
            .iter()
            .filter(|&&d| at[d as usize] < i64::MAX)
            .min_by_key(|&&d| at[d as usize])
        else {
            continue;
        };
        if at[d as usize] >= prev {
            continue;
        }
        prev = at[d as usize];
        if let Some(j) = rebuild(net, st, &label, k, d) {
            out.push(j);
        }
    }
    out
}

/// The earliest run of pattern `pi` (region `ri`) leaving stop position
/// `pos` at or after `ready` (with its delay), not cancelled: (trip,
/// service start, delay, on the map).
fn earliest_run(
    net: &Network,
    delays: &Delays,
    ri: usize,
    pi: u32,
    pos: usize,
    ready: i64,
    zone: trainradar_proto::time::Zone,
) -> Option<(TripRef, i64, Option<i32>, bool)> {
    let r = &net.regions[ri];
    let st = &r.sched[pi as usize];
    let behind = zone.behind_madrid(ready);
    let today = madrid_day(ready - behind);
    // Runs by scheduled departure; live state only for the first few
    // (a late train scheduled before `ready` may still be catchable).
    let mut cands: Vec<(i64, u32, i64, i64)> = Vec::new();
    for &ti in &r.pattern_trips[pi as usize] {
        let trip = &r.tt.trips[ti as usize];
        for day in [today - 1, today, today + 1] {
            if !crate::network::runs_on(&r.tt.header, trip, day) {
                continue;
            }
            let start = service_day_base(day) + behind + i64::from(trip.start);
            let sched_dep = start + i64::from(st[pos].departure);
            if sched_dep >= ready - LATE_MAX_SECS && sched_dep <= ready + WAIT_MAX_SECS {
                cands.push((sched_dep, ti, start, day));
            }
        }
    }
    cands.sort_unstable_by_key(|c| c.0);
    let mut best: Option<(i64, TripRef, i64, Option<i32>, bool)> = None;
    for (sched_dep, ti, start, day) in cands {
        // Later runs leave at or after their timetable (bar a few minutes
        // early): none can beat the one found.
        if best.is_some_and(|b| sched_dep - 300 >= b.0) {
            break;
        }
        let tref = TripRef {
            region: ri as u16,
            trip: ti,
        };
        let (delay, canceled, is_live) =
            delays.of(&r.tt.trip_id(&r.tt.trips[ti as usize]), tref, day);
        if canceled {
            continue;
        }
        let dep = sched_dep + i64::from(delay.unwrap_or(0));
        if dep < ready || dep > ready + WAIT_MAX_SECS {
            continue;
        }
        if best.is_none_or(|b| dep < b.0) {
            best = Some((dep, tref, start, delay, is_live));
        }
    }
    best.map(|(_, t, s, d, l)| (t, s, d, l))
}

fn rebuild(
    net: &Network,
    st: &Stations,
    label: &[Vec<Option<Label>>],
    k: usize,
    d: u32,
) -> Option<Journey> {
    let mut steps = Vec::new();
    let (mut k, mut s) = (k, d);
    loop {
        match label[k][s as usize].as_ref()? {
            Label::Start => break,
            Label::Walk { from, secs } => {
                steps.push(Step::Walk(Walk {
                    from: st.ids[*from as usize].to_owned(),
                    to: st.ids[s as usize].to_owned(),
                    secs: *secs,
                }));
                s = *from;
            }
            Label::Ride {
                trip,
                start,
                delay,
                live,
                board,
                board_pos,
                alight_pos,
            } => {
                let r = &net.regions[trip.region as usize];
                let rec = &r.tt.trips[trip.trip as usize];
                let sched = net.schedule(*trip);
                steps.push(Step::Ride(Ride {
                    trip: *trip,
                    trip_id: r.tt.trip_id(rec),
                    route: r.tt.routes[rec.route as usize].short_name.clone(),
                    number: crate::network::train_number(rec),
                    headsign: net.stop_name(*trip, sched.len() - 1).to_owned(),
                    from: st.ids[*board as usize].to_owned(),
                    to: st.ids[s as usize].to_owned(),
                    from_pos: *board_pos,
                    to_pos: *alight_pos,
                    sched_dep: start + i64::from(sched[*board_pos as usize].departure),
                    sched_arr: start + i64::from(sched[*alight_pos as usize].arrival),
                    delay: *delay,
                    live: *live,
                }));
                s = *board;
                k -= 1;
            }
        }
    }
    steps.reverse();
    Some(Journey { steps })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::tests::{local, sample_timetable, stop};
    use crate::source::{FeedData, RtTripUpdate};
    use trainradar_proto::encode;
    use trainradar_proto::refdata::{PatternRec, RouteRec, TripRec};

    /// Region "10" (A→B→C at 08:00, 08:10, 09:00; 10 + 1 + 10 min) plus a
    /// long-distance region "ld": C→D at 08:35 and 09:35, and E→D at 08:50
    /// (E is ~300 m from C, a walk).
    fn two_regions() -> Network {
        let mut n = Network::default();
        n.load_timetable(&encode(&sample_timetable()).unwrap())
            .unwrap();
        let mut ld = sample_timetable();
        ld.region = "ld".into();
        ld.stops = vec![
            stop("C", 40.20, -3.70),
            stop("D", 40.00, -3.70),
            stop("E", 40.2027, -3.70),
        ];
        ld.routes = vec![RouteRec {
            id: "ld-md".into(),
            short_name: "MD".into(),
            long_name: String::new(),
            color: None,
            text_color: None,
        }];
        ld.shapes = vec![];
        ld.services = vec![];
        ld.patterns = vec![
            PatternRec::from_absolute(vec![0, 1], &[(0, 0), (1800, 1800)], &[0, 22_000], None, 0),
            PatternRec::from_absolute(vec![2, 1], &[(0, 0), (1500, 1500)], &[0, 22_000], None, 0),
        ];
        let trip = |pattern: u32, start: u32, short: &str| TripRec {
            route: 0,
            pattern,
            start,
            days: 0b10,
            service: None,
            id_rest: short.into(),
            headsign: String::new(),
            short_name: short.into(),
        };
        ld.trips = vec![
            trip(0, 8 * 3600 + 35 * 60, "18001"),
            trip(0, 9 * 3600 + 35 * 60, "18003"),
            trip(1, 8 * 3600 + 50 * 60, "18005"),
        ];
        n.load_timetable(&encode(&ld).unwrap()).unwrap();
        n
    }

    fn q<'a>(from: &'a [&'a str], to: &'a [&'a str], after: i64, limit: usize) -> Query<'a> {
        Query {
            from,
            to,
            after,
            max_changes: 2,
            limit,
            window_secs: 3 * 3_600,
        }
    }

    fn numbers(j: &Journey) -> Vec<String> {
        j.rides().map(|r| r.number.clone()).collect()
    }

    #[test]
    fn one_change_at_the_same_station_or_a_walk_away() {
        let net = two_regions();
        let live = Live::default();
        let js = journeys(&net, &live, &q(&["A"], &["D"], local(7, 50), 3));
        assert!(!js.is_empty());
        // 08:00 from A, C at 08:21; the 08:35 MD needs 10 min (long
        // distance): 08:31 ≤ 08:35, so it's caught; D at 09:05.
        let j = &js[0];
        assert_eq!(numbers(j), vec!["100", "18001"], "{j:?}");
        assert_eq!(j.dep(), local(8, 0));
        assert_eq!(j.arr(), local(9, 5));
        assert_eq!(j.changes(), 1);
        assert_eq!(j.tightest_change(), Some(14 * 60));
        // Next: the 08:10 from A reaches C at 08:31: 08:41 misses the 08:35
        // MD, but walking to E (~300 m: 3 min + ~6 min) catches the 08:50.
        let j = &js[1];
        assert_eq!(numbers(j), vec!["102", "18005"], "{j:?}");
        assert!(
            j.steps
                .iter()
                .any(|s| matches!(s, Step::Walk(w) if w.from == "C" && w.to == "E")),
            "{j:?}"
        );
        assert_eq!(j.arr(), local(9, 15));
    }

    #[test]
    fn delays_and_cancellations_change_the_answer() {
        let net = two_regions();
        let mut live = Live::default();
        // The 08:00 runs 10 min late: C at 08:31, too late for the 08:35.
        // And the 08:50 from E is cancelled: next is the 09:35 from C.
        live.ingest(
            &net,
            "trip_updates.pb",
            FeedData::TripUpdates(vec![
                RtTripUpdate {
                    updated: None,
                    trip_id: "1004D100C3".into(),
                    accessible: None,
                    delay: Some(600),
                    canceled: false,
                    stops: vec![],
                },
                RtTripUpdate {
                    updated: None,
                    trip_id: "18005".into(),
                    accessible: None,
                    delay: None,
                    canceled: true,
                    stops: vec![],
                },
            ]),
            local(7, 50),
        );
        let js = journeys(&net, &live, &q(&["A"], &["D"], local(7, 50), 1));
        let j = &js[0];
        assert_eq!(numbers(j), vec!["100", "18003"], "{j:?}");
        assert_eq!(j.dep(), local(8, 10));
        assert_eq!(j.arr(), local(10, 5));
    }

    #[test]
    fn leaving_earlier_only_to_wait_is_dropped() {
        let net = two_regions();
        let live = Live::default();
        // From 07:50 to D: the 08:00 A train + 08:35 MD (D 09:05) and the
        // 08:10 + walk + 08:50 (D 09:15). From B (on the A line, 08:11 and
        // 08:21) the 08:11 isn't worth it if the 08:21 still makes the same
        // MD... here it doesn't (C 08:31 + 10 > 08:35), so both stay; and
        // nothing leaving earlier for the same arrival is listed.
        let js = journeys(&net, &live, &q(&["A"], &["D"], local(7, 50), 5));
        for (i, j) in js.iter().enumerate() {
            for (k, o) in js.iter().enumerate() {
                if i != k {
                    assert!(
                        !(o.dep() >= j.dep()
                            && o.arr() <= j.arr()
                            && o.changes() <= j.changes()
                            && (o.dep() > j.dep() || o.arr() < j.arr())),
                        "{j:?} dominated by {o:?}"
                    );
                }
            }
        }
        assert!(js.len() >= 2);
    }

    #[test]
    fn direct_trains_and_no_route() {
        let net = two_regions();
        let live = Live::default();
        let js = journeys(&net, &live, &q(&["A"], &["C"], local(7, 50), 2));
        assert_eq!(
            js.iter().map(numbers).collect::<Vec<_>>(),
            vec![vec!["100"], vec!["102"]]
        );
        assert!(
            js.iter()
                .all(|j| j.changes() == 0 && j.tightest_change().is_none())
        );
        // D → A: nothing runs that way.
        assert!(journeys(&net, &live, &q(&["D"], &["A"], local(7, 50), 2)).is_empty());
        // Same station both ends.
        assert!(journeys(&net, &live, &q(&["A"], &["A"], local(7, 50), 2)).is_empty());
    }
}
