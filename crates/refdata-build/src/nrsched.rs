//! Network Rail SCHEDULE (JSON, one record per line) + NaPTAN rail stations
//! → the same in-memory [`Feed`] the GTFS loader builds, so the UK goes
//! through the same timetable build as Renfe (plan 3, phase 3b).
//!
//! Only what the app needs is kept: passenger trains (status P or 1) running
//! in the window, at the locations where they call for passengers (public
//! times), at stations NaPTAN places. For each train (UID) and day the
//! schedule with the highest short-term-planning priority wins: C
//! (cancelled that day) over N over O over P. Formats: docs/data-sources-uk.md.

use crate::calendar::{Window, parse_date, weekday};
use crate::load::{Feed, Route, Stop, Trip};
use std::collections::HashMap;
use std::io::BufRead;
use trainradar_proto::LatLon;

/// Prefix of a rail station's NaPTAN ATCO code; the rest is its TIPLOC.
const RAIL_ATCO_PREFIX: &str = "9100";

#[derive(Debug, Default)]
pub struct NrStats {
    pub schedules: usize,
    pub in_window: usize,
    pub passenger_trips: usize,
    pub cancelled_days: usize,
    pub calls: usize,
    pub calls_unplaced: usize,
    pub unplaced_tiplocs: usize,
    pub stations: usize,
}

/// NaPTAN rail stations: TIPLOC → (name, coordinates). `csv` is NaPTAN's
/// access-nodes CSV (all stops; only `StopType` RLY rows are kept).
pub fn read_naptan<R: std::io::Read>(csv: R) -> Result<HashMap<String, (String, LatLon)>, String> {
    let mut rdr = csv::ReaderBuilder::new().flexible(true).from_reader(csv);
    let h = rdr.headers().map_err(|e| e.to_string())?.clone();
    let col = |n: &str| {
        h.iter()
            .position(|x| x == n)
            .ok_or(format!("NaPTAN: no column {n}"))
    };
    let (atco, name, typ, lat, lon) = (
        col("ATCOCode")?,
        col("CommonName")?,
        col("StopType")?,
        col("Latitude")?,
        col("Longitude")?,
    );
    let status = h.iter().position(|x| x == "Status");
    let mut out = HashMap::new();
    let mut rec = csv::StringRecord::new();
    while rdr.read_record(&mut rec).map_err(|e| e.to_string())? {
        if &rec[typ] != "RLY" || status.is_some_and(|s| rec.get(s).is_some_and(|v| v == "inactive"))
        {
            continue;
        }
        let Some(tiploc) = rec[atco].strip_prefix(RAIL_ATCO_PREFIX) else {
            continue;
        };
        let (Ok(la), Ok(lo)) = (rec[lat].parse::<f64>(), rec[lon].parse::<f64>()) else {
            continue;
        };
        if !(49.0..61.5).contains(&la) || !(-9.0..2.5).contains(&lo) {
            continue;
        }
        out.insert(
            tiploc.to_owned(),
            (station_name(&rec[name]), LatLon::new(la, lo)),
        );
    }
    Ok(out)
}

/// "Aberdare Rail Station" → "Aberdare".
pub fn station_name(s: &str) -> String {
    let s = s.trim();
    for suffix in [" Rail Station", " Railway Station", " Station"] {
        if let Some(x) = s.strip_suffix(suffix) {
            return x.to_owned();
        }
    }
    s.to_owned()
}

/// "0907" or "0908H" → seconds after midnight (H = half a minute).
pub fn parse_hhmm(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    if b.len() < 4 || !b[..4].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let h = u32::from(b[0] - b'0') * 10 + u32::from(b[1] - b'0');
    let m = u32::from(b[2] - b'0') * 10 + u32::from(b[3] - b'0');
    (h < 24 && m < 60).then(|| h * 3600 + m * 60 + if b.get(4) == Some(&b'H') { 30 } else { 0 })
}

/// A public call: TIPLOC, public arrival and departure (seconds, same day).
#[derive(Debug, Clone, PartialEq)]
struct Call {
    tiploc: String,
    arr: Option<u32>,
    dep: Option<u32>,
}

#[derive(Debug)]
struct Cand {
    uid: String,
    stp: u8,
    start: String,
    /// Days of the window it applies to, before STP resolution.
    mask: u16,
    passenger: bool,
    atoc: String,
    headcode: String,
    calls: Vec<Call>,
}

fn public(v: &serde_json::Value) -> Option<u32> {
    // CIF writes "0000" for "no public time"; JSON usually has null.
    v.as_str().filter(|s| *s != "0000").and_then(parse_hhmm)
}

fn candidate(o: &serde_json::Value, window: &Window) -> Option<Cand> {
    let s = o.get("JsonScheduleV1")?;
    if s.get("transaction_type").and_then(|v| v.as_str()) == Some("Delete") {
        return None;
    }
    let str_of = |k: &str| {
        s.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    let start = parse_date(&str_of("schedule_start_date"))?;
    let end = parse_date(&str_of("schedule_end_date"))?;
    let runs: Vec<bool> = str_of("schedule_days_runs")
        .chars()
        .map(|c| c == '1')
        .collect();
    let mut mask = 0u16;
    for n in 0..window.days {
        let day = window.start + i64::from(n);
        if day >= start && day <= end && runs.get(weekday(day)).copied().unwrap_or(false) {
            mask |= 1 << n;
        }
    }
    if mask == 0 {
        return None;
    }
    let stp = str_of("CIF_stp_indicator").bytes().next().unwrap_or(b'P');
    let status = str_of("train_status");
    let passenger = matches!(status.as_str(), "P" | "1") && stp != b'C';
    let seg = s.get("schedule_segment");
    let mut calls = Vec::new();
    if passenger {
        for l in seg
            .and_then(|g| g.get("schedule_location"))
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let (arr, dep) = (public(&l["public_arrival"]), public(&l["public_departure"]));
            if arr.is_none() && dep.is_none() {
                continue; // passes, or calls not open to passengers
            }
            let tiploc = l["tiploc_code"].as_str().unwrap_or("").trim().to_owned();
            if !tiploc.is_empty() {
                calls.push(Call { tiploc, arr, dep });
            }
        }
    }
    Some(Cand {
        uid: str_of("CIF_train_uid"),
        stp,
        start: str_of("schedule_start_date"),
        mask,
        passenger,
        atoc: str_of("atoc_code"),
        headcode: seg
            .and_then(|g| g.get("signalling_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned(),
        calls,
    })
}

/// Train operators by ATOC code, for the route names.
fn operator_name(atoc: &str) -> &'static str {
    match atoc {
        "AW" => "Transport for Wales",
        "CC" => "c2c",
        "CH" => "Chiltern Railways",
        "CS" => "Caledonian Sleeper",
        "EM" => "East Midlands Railway",
        "ES" => "Eurostar",
        "GC" => "Grand Central",
        "GN" => "Great Northern",
        "GR" => "LNER",
        "GW" => "Great Western Railway",
        "GX" => "Gatwick Express",
        "HC" => "Heathrow Connect",
        "HT" => "Hull Trains",
        "HX" => "Heathrow Express",
        "IL" => "Island Line",
        "LD" => "Lumo",
        "LE" => "Greater Anglia",
        "LM" => "West Midlands Trains",
        "LO" => "London Overground",
        "ME" => "Merseyrail",
        "NT" => "Northern",
        "SE" => "Southeastern",
        "SN" => "Southern",
        "SR" => "ScotRail",
        "SW" => "South Western Railway",
        "TL" => "Thameslink",
        "TP" => "TransPennine Express",
        "VT" => "Avanti West Coast",
        "XC" => "CrossCountry",
        "XR" => "Elizabeth line",
        _ => "",
    }
}

/// Read a SCHEDULE extract (decompressed JSON lines) into a [`Feed`].
pub fn load<R: BufRead>(
    schedule: R,
    naptan: &HashMap<String, (String, LatLon)>,
    window: &Window,
) -> Result<(Feed, NrStats), String> {
    let mut stats = NrStats::default();
    let mut cands: Vec<Cand> = Vec::new();
    for line in schedule.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if !line.starts_with("{\"JsonScheduleV1\"") {
            continue;
        }
        stats.schedules += 1;
        let Ok(o) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(c) = candidate(&o, window) {
            cands.push(c);
        }
    }
    stats.in_window = cands.len();

    // STP resolution, day by day: the lowest indicator letter wins (C < N < O < P).
    let mut by_uid: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, c) in cands.iter().enumerate() {
        by_uid.entry(c.uid.as_str()).or_default().push(i);
    }
    let mut final_mask = vec![0u16; cands.len()];
    for idx in by_uid.values() {
        for n in 0..window.days {
            let bit = 1u16 << n;
            if let Some(&w) = idx
                .iter()
                .filter(|&&i| cands[i].mask & bit != 0)
                .min_by_key(|&&i| cands[i].stp)
            {
                if cands[w].stp == b'C' {
                    stats.cancelled_days += 1;
                } else {
                    final_mask[w] |= bit;
                }
            }
        }
    }

    let mut feed = Feed::default();
    let mut stop_idx: HashMap<String, usize> = HashMap::new();
    let mut route_idx: HashMap<String, usize> = HashMap::new();
    let mut unplaced: std::collections::HashSet<String> = Default::default();
    for (c, &days) in cands.iter().zip(&final_mask) {
        if days == 0 || !c.passenger {
            continue;
        }
        let mut st: Vec<(usize, u32, u32)> = Vec::new();
        let mut last = 0u32;
        let mut offset = 0u32; // after midnight: times keep counting past 24:00
        for call in &c.calls {
            stats.calls += 1;
            let Some((name, coord)) = naptan.get(&call.tiploc) else {
                stats.calls_unplaced += 1;
                unplaced.insert(call.tiploc.clone());
                continue;
            };
            let raw_a = call.arr.or(call.dep).unwrap_or(0);
            let raw_d = call.dep.or(call.arr).unwrap_or(raw_a);
            let mut a = raw_a + offset;
            if a < last {
                offset += 86_400;
                a += 86_400;
            }
            let mut d = raw_d + offset;
            if d < a {
                offset += 86_400;
                d += 86_400;
            }
            last = d;
            let s = *stop_idx.entry(call.tiploc.clone()).or_insert_with(|| {
                feed.stops.push(Stop {
                    id: call.tiploc.clone(),
                    name: name.clone(),
                    coord: *coord,
                });
                feed.stops.len() - 1
            });
            st.push((s, a, d));
        }
        if st.len() < 2 {
            continue;
        }
        let route = *route_idx.entry(c.atoc.clone()).or_insert_with(|| {
            feed.routes.push(Route {
                id: c.atoc.clone(),
                short_name: c.atoc.clone(),
                long_name: operator_name(&c.atoc).to_owned(),
                color: None,
                text_color: None,
                route_type: "2".into(),
            });
            feed.routes.len() - 1
        });
        let headsign = feed.stops[st.last().map_or(0, |x| x.0)].name.clone();
        feed.trips.push(Trip {
            // The TRUST activation names a schedule by UID, start date and STP indicator.
            id: format!("{}:{}:{}", c.uid, c.start, c.stp as char),
            route,
            service: String::new(),
            headsign,
            short_name: c.headcode.clone(),
            shape_id: String::new(),
            days,
            stop_times: st,
        });
    }
    stats.passenger_trips = feed.trips.len();
    stats.unplaced_tiplocs = unplaced.len();
    stats.stations = feed.stops.len();
    feed.stats.trips_total = stats.schedules;
    feed.stats.trips_outside_window = stats.schedules - stats.in_window;
    Ok((feed, stats))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::parse_date;

    fn naptan() -> HashMap<String, (String, LatLon)> {
        let csv = "ATCOCode,CommonName,StopType,Longitude,Latitude,Status\n\
                   9100EDINBUR,Edinburgh Rail Station,RLY,-3.1891,55.9521,active\n\
                   9100HAYMRKT,Haymarket Rail Station,RLY,-3.2183,55.9458,active\n\
                   9100UPHALL,Uphall Rail Station,RLY,-3.5016,55.9189,active\n\
                   9100XXXX,Old Rail Station,RLY,-3.5,55.9,inactive\n\
                   490000001,Some bus stop,BCT,-0.1,51.5,active\n";
        read_naptan(csv.as_bytes()).unwrap()
    }

    /// A schedule line in Network Rail's shape (from the feed check's samples).
    fn sched(
        uid: &str,
        stp: &str,
        start: &str,
        end: &str,
        runs: &str,
        status: &str,
        dep0: &str,
    ) -> String {
        format!(
            r#"{{"JsonScheduleV1":{{"CIF_stp_indicator":"{stp}","CIF_train_uid":"{uid}","atoc_code":"SR","schedule_days_runs":"{runs}","schedule_end_date":"{end}","schedule_start_date":"{start}","train_status":"{status}","transaction_type":"Create","schedule_segment":{{"signalling_id":"2H09","schedule_location":[
{{"location_type":"LO","tiploc_code":"EDINBUR","departure":"{dep0}","public_departure":"{dep0}"}},
{{"location_type":"LI","tiploc_code":"PRNCSTG","pass":"0908H","public_arrival":null,"public_departure":null}},
{{"location_type":"LI","tiploc_code":"HAYMRKT","arrival":"0910H","departure":"0911H","public_arrival":"0911","public_departure":"0911"}},
{{"location_type":"LI","tiploc_code":"NOWHERE","arrival":"0914","departure":"0915","public_arrival":"0914","public_departure":"0915"}},
{{"location_type":"LT","tiploc_code":"UPHALL","arrival":"0929H","public_arrival":"0930"}}]}}}}}}"#
        )
        .replace('\n', "")
    }

    #[test]
    fn naptan_and_times() {
        let n = naptan();
        assert_eq!(n.len(), 3, "rail stations only, active only");
        assert_eq!(n["EDINBUR"].0, "Edinburgh");
        assert_eq!(parse_hhmm("0908H"), Some(9 * 3600 + 8 * 60 + 30));
        assert_eq!(parse_hhmm("2359"), Some(86_340));
        assert_eq!(parse_hhmm("x"), None);
        assert_eq!(station_name("Ashley Down"), "Ashley Down");
    }

    #[test]
    fn passenger_calls_stp_and_midnight() {
        // Window: Monday 2026-11-09 for 7 days.
        let start = parse_date("2026-11-09").unwrap();
        let w = Window { start, days: 7 };
        let lines = [
            // Permanent, every day.
            sched("C15016", "P", "2026-05-17", "2026-12-06", "1111111", "P", "0907"),
            // Overlay on Wednesday: leaves earlier.
            sched("C15016", "O", "2026-11-11", "2026-11-11", "0010000", "P", "0857"),
            // Cancelled on Friday.
            r#"{"JsonScheduleV1":{"CIF_stp_indicator":"C","CIF_train_uid":"C15016","schedule_start_date":"2026-11-13","schedule_end_date":"2026-11-13","schedule_days_runs":"0000100","transaction_type":"Create"}}"#.to_owned(),
            // A bus (status 5) and a freight train (F): dropped.
            sched("B00001", "N", "2026-11-09", "2026-11-15", "1111111", "5", "1000"),
            sched("F00001", "P", "2026-11-09", "2026-11-15", "1111111", "F", "1000"),
            // A late train crossing midnight.
            sched("L00001", "P", "2026-11-09", "2026-11-15", "1000000", "1", "2350"),
            // Outside the window.
            sched("Z00001", "P", "2027-01-01", "2027-02-01", "1111111", "P", "0800"),
        ];
        let text = lines.join("\n");
        let (feed, st) = load(text.as_bytes(), &naptan(), &w).unwrap();
        assert_eq!(st.schedules, 7);
        assert_eq!(st.cancelled_days, 1);
        let p = feed
            .trips
            .iter()
            .find(|t| t.id == "C15016:2026-05-17:P")
            .unwrap();
        // Mon, Tue, Thu, Sat, Sun (not Wed: overlay; not Fri: cancelled).
        assert_eq!(p.days, 0b1101011);
        let o = feed
            .trips
            .iter()
            .find(|t| t.id == "C15016:2026-11-11:O")
            .unwrap();
        assert_eq!(o.days, 0b0000100);
        assert_eq!(o.stop_times[0].1, 8 * 3600 + 57 * 60);
        // Calls: Edinburgh, Haymarket, Uphall (the pass and the unknown station dropped).
        assert_eq!(p.stop_times.len(), 3);
        assert_eq!(feed.stops[p.stop_times[1].0].name, "Haymarket");
        assert_eq!(p.headsign, "Uphall");
        assert_eq!(p.short_name, "2H09");
        assert_eq!(feed.routes[p.route].long_name, "ScotRail");
        assert!(
            !feed
                .trips
                .iter()
                .any(|t| t.id.starts_with('B') || t.id.starts_with('F') || t.id.starts_with('Z'))
        );
        assert_eq!(st.unplaced_tiplocs, 1);
        // After midnight: times keep increasing past 24:00.
        let l = feed
            .trips
            .iter()
            .find(|t| t.id.starts_with("L00001"))
            .unwrap();
        assert_eq!(l.stop_times[0].1, 23 * 3600 + 50 * 60);
        assert!(l.stop_times[1].1 > 86_400 && l.stop_times.windows(2).all(|w| w[1].1 >= w[0].2));
    }
}
