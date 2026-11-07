//! Station-centred queries for "Use my location": nearest stations, a
//! departures/arrivals board with live delays, and trains approaching.

use crate::live::Live;
use crate::network::{Network, TripRef};
use std::collections::HashMap;
use trainradar_proto::LatLon;
use trainradar_proto::refdata::StationRec;
use trainradar_proto::time::{madrid_day, service_day_base};

/// A station near the user.
#[derive(Debug, Clone, PartialEq)]
pub struct NearStation<'a> {
    pub station: &'a StationRec,
    pub distance_m: f64,
}

pub fn nearest_stations(net: &Network, p: LatLon, k: usize, max_m: f64) -> Vec<NearStation<'_>> {
    let Some(st) = &net.stations else {
        return Vec::new();
    };
    st.grid
        .nearest(&st.stations, StationRec::coord, p, k, max_m)
        .into_iter()
        .map(|(i, d)| NearStation {
            station: &st.stations[i],
            distance_m: d,
        })
        .collect()
}

/// One row of a station board.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRow {
    pub trip: TripRef,
    pub trip_id: String,
    pub route: String,
    pub number: String,
    /// Final destination, or origin for terminating trains.
    pub other_end: String,
    pub terminates: bool,
    /// Scheduled arrival and departure at this station (unix seconds).
    pub sched_arr: i64,
    pub sched_dep: i64,
    pub delay: Option<i32>,
    pub canceled: bool,
    /// The train is on the map right now.
    pub live: bool,
}

impl BoardRow {
    /// Expected time it leaves (or arrives, if it terminates here).
    pub fn expected(&self) -> i64 {
        let t = if self.terminates {
            self.sched_arr
        } else {
            self.sched_dep
        };
        t + i64::from(self.delay.unwrap_or(0))
    }
}

/// Trains calling at a station from now until `horizon_secs` ahead, in
/// timetable order (only those not yet gone, counting their delay). Uses loaded timetables only (the web app loads the
/// Cercanías núcleo around the user first).
pub fn board(
    net: &Network,
    live: &Live,
    station_id: &str,
    now: i64,
    horizon_secs: i64,
    limit: usize,
) -> Vec<BoardRow> {
    // Delays of trains currently on the map, by (trip, service day).
    let on_map: HashMap<(TripRef, i64), Option<i32>> = live
        .trains
        .iter()
        .filter_map(|t| Some(((t.matched?.trip, t.matched?.day), t.delay)))
        .collect();
    let today = madrid_day(now);
    let mut rows = Vec::new();
    for (ri, r) in net.regions.iter().enumerate() {
        let Some(calls) = r.calls.get(station_id) else {
            continue;
        };
        for &(pi, pos) in calls {
            let st = &r.sched[pi as usize];
            let pos = pos as usize;
            let last = pos + 1 == st.len();
            for &ti in &r.pattern_trips[pi as usize] {
                let trip = &r.tt.trips[ti as usize];
                for day in [today - 1, today] {
                    let bit = day - i64::from(r.tt.header.window_start_day);
                    if !(0..16).contains(&bit) || trip.days & (1 << bit) == 0 {
                        continue;
                    }
                    let start = service_day_base(day) + i64::from(trip.start);
                    let sched_arr = start + i64::from(st[pos].arrival);
                    let sched_dep = start + i64::from(st[pos].departure);
                    let sched = if last { sched_arr } else { sched_dep };
                    // Cheap pre-filter before looking up delays.
                    if sched > now + horizon_secs || sched < now - 6 * 3_600 {
                        continue;
                    }
                    let tref = TripRef {
                        region: ri as u16,
                        trip: ti,
                    };
                    let trip_id = r.tt.trip_id(trip);
                    let live_delay = on_map.get(&(tref, day));
                    let tu = live.trip_update(&trip_id);
                    let delay = live_delay.copied().flatten().or(tu.and_then(|u| u.delay));
                    let row = BoardRow {
                        trip: tref,
                        route: r.tt.routes[trip.route as usize].short_name.clone(),
                        number: crate::network::train_number(trip),
                        other_end: if last {
                            net.stop_name(tref, 0).to_owned()
                        } else {
                            net.stop_name(tref, st.len() - 1).to_owned()
                        },
                        terminates: last,
                        sched_arr,
                        sched_dep,
                        delay,
                        canceled: tu.is_some_and(|u| u.canceled),
                        live: live_delay.is_some(),
                        trip_id,
                    };
                    // Keep trains that haven't left yet (with their delay).
                    if row.expected() >= now - 60 {
                        rows.push(row);
                    }
                }
            }
        }
    }
    // Like a station board: in timetable order (delays shown alongside).
    rows.sort_by_key(|r| {
        if r.terminates {
            r.sched_arr
        } else {
            r.sched_dep
        }
    });
    rows.truncate(limit);
    rows
}

/// A train from one station to another (commute mode, TrainRadar Pro).
#[derive(Debug, Clone, PartialEq)]
pub struct CommuteRow {
    pub board: BoardRow,
    /// Scheduled arrival at the destination (unix seconds).
    pub sched_arr_to: i64,
}

impl CommuteRow {
    pub fn expected_arr(&self) -> i64 {
        self.sched_arr_to + i64::from(self.board.delay.unwrap_or(0))
    }
}

/// Next trains leaving `from` that later call at `to`, with live delays.
/// Whether `trip` calls at `from` and later at `to`: the position of its
/// call at `to` in the trip's schedule, else `None`.
pub fn serves(net: &Network, trip: TripRef, from: &str, to: &str) -> Option<usize> {
    if from == to {
        return None;
    }
    let r = &net.regions[trip.region as usize];
    let pi = r.tt.trips[trip.trip as usize].pattern;
    let pf = r.calls.get(from)?.iter().find(|&&(p, _)| p == pi)?.1;
    r.calls
        .get(to)?
        .iter()
        .find(|&&(p, pos)| p == pi && pos > pf)
        .map(|&(_, pos)| usize::from(pos))
}

/// Every station a train passes on its way from `from` to `to` (both
/// included), over all timetabled patterns that call at both in that order;
/// sorted. For filtering notices by a commute.
pub fn between_stations(net: &Network, from: &str, to: &str) -> Vec<String> {
    let mut out = std::collections::BTreeSet::new();
    if from == to {
        return Vec::new();
    }
    for r in &net.regions {
        let (Some(fc), Some(tc)) = (r.calls.get(from), r.calls.get(to)) else {
            continue;
        };
        for &(p, pf) in fc {
            for &(_, pt) in tc.iter().filter(|&&(q, pos)| q == p && pos > pf) {
                let stops = &r.tt.patterns[p as usize].stops;
                for &s in &stops[usize::from(pf)..=usize::from(pt)] {
                    out.insert(r.tt.stops[s as usize].id.clone());
                }
            }
        }
    }
    out.into_iter().collect()
}

pub fn commute(
    net: &Network,
    live: &Live,
    from: &str,
    to: &str,
    now: i64,
    horizon_secs: i64,
    limit: usize,
) -> Vec<CommuteRow> {
    if from == to {
        return Vec::new();
    }
    let mut out = Vec::new();
    for row in board(net, live, from, now, horizon_secs, usize::MAX) {
        if row.terminates {
            continue;
        }
        let r = &net.regions[row.trip.region as usize];
        let pi = r.tt.trips[row.trip.trip as usize].pattern;
        let (Some(fc), Some(tc)) = (r.calls.get(from), r.calls.get(to)) else {
            continue;
        };
        let st = &r.sched[pi as usize];
        // Its call at `from` (patterns visit a station once in practice),
        // then a later call at `to` on the same pattern.
        let Some(&(_, pf)) = fc.iter().find(|&&(p, _)| p == pi) else {
            continue;
        };
        let start = row.sched_dep - i64::from(st[pf as usize].departure);
        if let Some(&(_, pt)) = tc.iter().find(|&&(p, pos)| p == pi && pos > pf) {
            out.push(CommuteRow {
                sched_arr_to: start + i64::from(st[pt as usize].arrival),
                board: row,
            });
        }
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// A train on the map heading for a station.
#[derive(Debug, Clone, PartialEq)]
pub struct Approaching {
    /// Index into `Live::trains` (as in `Engine::positions`).
    pub index: usize,
    pub eta: i64,
    pub distance_m: f64,
    pub delay: Option<i32>,
}

pub fn approaching(
    net: &Network,
    live: &Live,
    station_id: &str,
    now: i64,
    horizon_secs: i64,
) -> Vec<Approaching> {
    let mut out = Vec::new();
    for v in live.views(net, now, false) {
        let t = &live.trains[v.index];
        let (Some(m), Some(along)) = (t.matched, v.along) else {
            continue;
        };
        let r = &net.regions[m.trip.region as usize];
        let trip = &r.tt.trips[m.trip.trip as usize];
        let pattern = &r.tt.patterns[trip.pattern as usize];
        let st = net.schedule(m.trip);
        let Some(pos) = pattern.stops.iter().enumerate().position(|(i, &s)| {
            r.tt.stops[s as usize].id == station_id && f64::from(st[i].dist_m) > along + 30.0
        }) else {
            continue;
        };
        let eta = m.start_utc + i64::from(st[pos].arrival) + i64::from(t.delay.unwrap_or(0));
        if eta - now > horizon_secs {
            continue;
        }
        out.push(Approaching {
            index: v.index,
            eta: eta.max(now),
            distance_m: f64::from(st[pos].dist_m) - along,
            delay: t.delay,
        });
    }
    out.sort_by_key(|a| a.eta);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::tests::{local, sample_network, sample_timetable};
    use crate::source::{FeedData, RtTripUpdate, RtVehicle};
    use trainradar_proto::encode;
    use trainradar_proto::refdata::{GridIndex, Header, RegionRec, SERVICE_COMMUTER, StationsFile};

    fn with_stations() -> Network {
        let mut net = sample_network();
        let mut stations: Vec<StationRec> = sample_timetable()
            .stops
            .iter()
            .map(|s| StationRec {
                id: s.id.clone(),
                name: s.name.clone(),
                lat_e5: s.lat_e5,
                lon_e5: s.lon_e5,
                services: SERVICE_COMMUTER,
                regions: vec![0],
            })
            .collect();
        let grid = GridIndex::build(&mut stations, |s| (s.lat_e5, s.lon_e5), 10_000);
        let f = StationsFile {
            header: Header::new(0, 8, 0),
            regions: vec![RegionRec {
                code: "10".into(),
                name: "Madrid".into(),
                bbox_e5: [0; 4],
            }],
            stations,
            grid,
        };
        net.load_stations(&encode(&f).unwrap()).unwrap();
        net
    }

    #[test]
    fn nearest_stations_by_distance() {
        let net = with_stations();
        let near = nearest_stations(&net, LatLon::new(40.31, -3.70), 2, 50_000.0);
        assert_eq!(near[0].station.id, "B");
        assert!((near[0].distance_m - 1_112.0).abs() < 10.0);
        assert_eq!(near[1].station.id, "A", "A is ~10 km away, C ~12 km");
        assert!(nearest_stations(&net, LatLon::new(43.0, -8.0), 2, 5_000.0).is_empty());
    }

    #[test]
    fn board_lists_next_trains_with_delays() {
        let net = with_stations();
        let mut live = Live::default();
        let now = local(8, 5);
        live.ingest(
            &net,
            "tu_cer",
            FeedData::TripUpdates(vec![RtTripUpdate {
                trip_id: "1004D102C3".into(),
                accessible: None,
                delay: Some(240),
                canceled: false,
                stops: vec![],
            }]),
            now,
        );
        // At B: trip 100 departs 08:11, trip 102 08:21 (+4 min), 190 at 09:11.
        let rows = board(&net, &live, "B", now, 2 * 3_600, 10);
        let ids: Vec<_> = rows.iter().map(|r| r.trip_id.as_str()).collect();
        assert_eq!(ids, ["1004D100C3", "1004D102C3", "0019012026-10-31"]);
        assert_eq!(rows[0].sched_dep, local(8, 11));
        assert_eq!(rows[1].delay, Some(240));
        assert_eq!(rows[1].expected(), local(8, 25));
        assert_eq!(rows[0].other_end, "Stop C");
        assert!(!rows[0].terminates);

        // At the terminus C, trains are arrivals from A.
        let c = board(&net, &live, "C", now, 3_600, 10);
        assert!(c[0].terminates);
        assert_eq!(c[0].other_end, "Stop A");

        // Departed trains drop off; the horizon limits the far end.
        let later = board(&net, &live, "B", local(8, 30), 15 * 60, 10);
        assert!(later.is_empty(), "{later:?}");
    }

    #[test]
    fn serves_needs_both_stations_in_order() {
        let net = with_stations();
        let live = Live::default();
        let row = &board(&net, &live, "A", local(7, 55), 30 * 60, 1)[0];
        assert_eq!(serves(&net, row.trip, "A", "C"), Some(2));
        assert_eq!(serves(&net, row.trip, "B", "C"), Some(2));
        assert_eq!(serves(&net, row.trip, "C", "A"), None, "wrong way");
        assert_eq!(serves(&net, row.trip, "A", "A"), None);
        assert_eq!(serves(&net, row.trip, "A", "Z"), None, "not on it");
    }

    #[test]
    fn stations_between_two_stations() {
        let net = with_stations();
        assert_eq!(between_stations(&net, "A", "C"), ["A", "B", "C"]);
        assert_eq!(between_stations(&net, "B", "C"), ["B", "C"]);
        assert!(between_stations(&net, "C", "A").is_empty(), "wrong way");
        assert!(between_stations(&net, "A", "A").is_empty());
    }

    #[test]
    fn commute_lists_trains_from_one_station_to_another() {
        let net = with_stations();
        let live = Live::default();
        let now = local(7, 55);
        // A→C: trips at 08:00 and 08:10 (arrive 08:21, 08:31); not the
        // id-less 09:00 trip beyond the horizon.
        let rows = commute(&net, &live, "A", "C", now, 30 * 60, 10);
        let deps: Vec<_> = rows.iter().map(|r| r.board.sched_dep).collect();
        assert_eq!(deps, [local(8, 0), local(8, 10)]);
        assert_eq!(rows[0].sched_arr_to, local(8, 21));
        assert_eq!(rows[1].expected_arr(), local(8, 31));
        assert!(
            commute(&net, &live, "C", "A", now, 3_600, 10).is_empty(),
            "wrong way"
        );
        assert!(commute(&net, &live, "A", "A", now, 3_600, 10).is_empty());
        assert_eq!(
            commute(&net, &live, "B", "C", now, 3_600, 1).len(),
            1,
            "limit"
        );
    }

    #[test]
    fn approaching_trains_with_eta() {
        let net = with_stations();
        let mut live = Live::default();
        let now = local(8, 5);
        let v = RtVehicle {
            trip_id: "1004D100C3".into(),
            train_number: "100".into(),
            line: "C3".into(),
            platform: None,
            lat: 40.35,
            lon: -3.70,
            bearing: None,
            speed: None,
            timestamp: Some(now),
            stop_id: None,
            status: None,
        };
        live.ingest(&net, "vp_cer", FeedData::Vehicles(vec![v]), now);
        let a = approaching(&net, &live, "B", now, 1_800);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].eta, local(8, 10), "on time: 08:10 at B");
        assert!((a[0].distance_m - 5_560.0).abs() < 50.0);
        assert!(
            approaching(&net, &live, "A", now, 1_800).is_empty(),
            "already passed A"
        );
    }
}
