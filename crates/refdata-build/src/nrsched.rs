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
    /// Calls placed through a sibling TIPLOC (same STANOX in CORPUS).
    pub calls_via_corpus: usize,
    /// Calls placed by station name (CORPUS name → NaPTAN, rail or metro).
    pub calls_via_name: usize,
    /// The unplaced TIPLOCs with the most calls: (TIPLOC, CORPUS name, calls).
    pub top_unplaced: Vec<(String, String, usize)>,
    pub stations: usize,
}

/// NaPTAN rail stations: TIPLOC → (name, coordinates). `csv` is NaPTAN's
/// access-nodes CSV (all stops; only `StopType` RLY rows are kept).
/// NaPTAN, as the UK build uses it: rail stations by TIPLOC, and rail and
/// Underground/metro stations by normalised name ([`norm_name`]) for calls
/// at TIPLOCs NaPTAN doesn't list (the Elizabeth line's core, stations
/// shared with the Underground).
#[derive(Debug, Default)]
pub struct Naptan {
    pub stations: HashMap<String, (String, LatLon)>,
    /// Normalised name → (the rail station's TIPLOC if one, name, coordinates).
    /// Rail stations win over metro ones; a name two rail stations share
    /// (e.g. two Newports) is left out.
    pub names: HashMap<String, (Option<String>, String, LatLon)>,
}

/// A station name for matching: upper case, "&" as "AND", without
/// "London " in front or a kind of station (" Rail Station", " EL", " LT"…)
/// behind. "London Liverpool Street Rail Station" and CORPUS's
/// "LIVERPOOL STREET EL" both give "LIVERPOOL STREET".
pub fn norm_name(s: &str) -> String {
    let mut n: String = s
        .to_uppercase()
        .replace('&', " AND ")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(x) = n.strip_prefix("LONDON ") {
        n = x.to_owned();
    }
    for suffix in [
        " RAIL STATION",
        " RAILWAY STATION",
        " UNDERGROUND STATION",
        " DLR STATION",
        " STATION",
        " ELL",
        " EL",
        " LT",
        " LUL",
        " DLR",
    ] {
        if let Some(x) = n.strip_suffix(suffix) {
            n = x.to_owned();
            break;
        }
    }
    n
}

pub fn read_naptan<R: std::io::Read>(csv: R) -> Result<Naptan, String> {
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
    let mut out = Naptan::default();
    let mut rail_names: HashMap<String, Option<String>> = HashMap::new();
    let mut metro: HashMap<String, (String, LatLon)> = HashMap::new();
    let mut rec = csv::StringRecord::new();
    while rdr.read_record(&mut rec).map_err(|e| e.to_string())? {
        let kind = &rec[typ];
        if !matches!(kind, "RLY" | "MET")
            || status.is_some_and(|s| rec.get(s).is_some_and(|v| v == "inactive"))
        {
            continue;
        }
        let (Ok(la), Ok(lo)) = (rec[lat].parse::<f64>(), rec[lon].parse::<f64>()) else {
            continue;
        };
        if !(49.0..61.5).contains(&la) || !(-9.0..2.5).contains(&lo) {
            continue;
        }
        let shown = station_name(&rec[name]);
        let key = norm_name(&rec[name]);
        if kind == "MET" {
            metro.entry(key).or_insert((shown, LatLon::new(la, lo)));
            continue;
        }
        let Some(tiploc) = rec[atco].strip_prefix(RAIL_ATCO_PREFIX) else {
            continue;
        };
        rail_names
            .entry(key)
            .and_modify(|t| {
                if t.as_deref() != Some(tiploc) {
                    *t = None; // two rail stations with this name: ambiguous
                }
            })
            .or_insert_with(|| Some(tiploc.to_owned()));
        out.stations
            .insert(tiploc.to_owned(), (shown, LatLon::new(la, lo)));
    }
    for (key, tiploc) in rail_names {
        if let Some(t) = tiploc {
            let (n, c) = out.stations[&t].clone();
            out.names.insert(key, (Some(t), n, c));
        }
    }
    for (key, (n, c)) in metro {
        out.names.entry(key).or_insert((None, n, c));
    }
    Ok(out)
}

/// "Aberdare Rail Station" → "Aberdare".
pub fn station_name(s: &str) -> String {
    let s = s.trim();
    for suffix in [
        " Rail Station",
        " Railway Station",
        " Underground Station",
        " Station",
    ] {
        if let Some(x) = s.strip_suffix(suffix) {
            return x.to_owned();
        }
    }
    s.to_owned()
}

/// Network Rail CORPUS: which TIPLOCs share a STANOX (one station often has
/// several TIPLOCs, e.g. for different platforms or lines), and their names.
#[derive(Debug, Default)]
pub struct Corpus {
    pub stanox: HashMap<String, String>,
    pub name: HashMap<String, String>,
}

/// CORPUS JSON (`{"TIPLOCDATA": [{"TIPLOC", "STANOX", "NLCDESC", …}]}`;
/// empty values are a single space).
pub fn read_corpus<R: std::io::Read>(json: R) -> Result<Corpus, String> {
    let v: serde_json::Value = serde_json::from_reader(json).map_err(|e| format!("CORPUS: {e}"))?;
    let mut c = Corpus::default();
    for r in v["TIPLOCDATA"].as_array().ok_or("CORPUS: no TIPLOCDATA")? {
        let f = |k: &str| r[k].as_str().unwrap_or("").trim().to_owned();
        let tiploc = f("TIPLOC");
        if tiploc.is_empty() {
            continue;
        }
        let stanox = f("STANOX");
        if !stanox.is_empty() {
            c.stanox.insert(tiploc.clone(), stanox);
        }
        c.name.insert(tiploc, f("NLCDESC"));
    }
    Ok(c)
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
    naptan: &Naptan,
    corpus: Option<&Corpus>,
    window: &Window,
) -> Result<(Feed, NrStats), String> {
    // A TIPLOC NaPTAN doesn't place may share its STANOX with one it does.
    let mut placed_by_stanox: HashMap<&str, &str> = HashMap::new();
    if let Some(c) = corpus {
        let mut placed: Vec<&String> = naptan.stations.keys().collect();
        placed.sort();
        for t in placed {
            if let Some(sx) = c.stanox.get(t) {
                placed_by_stanox.entry(sx.as_str()).or_insert(t.as_str());
            }
        }
    }
    // → (stop id, name, coordinates, how): 0 NaPTAN, 1 CORPUS sibling, 2 by name.
    let resolve = |tiploc: &str| -> Option<(String, String, LatLon, u8)> {
        if let Some((n, c)) = naptan.stations.get(tiploc) {
            return Some((tiploc.to_owned(), n.clone(), *c, 0));
        }
        let corpus = corpus?;
        if let Some(t) = corpus
            .stanox
            .get(tiploc)
            .and_then(|sx| placed_by_stanox.get(sx.as_str()))
        {
            let (n, c) = &naptan.stations[*t];
            return Some(((*t).to_owned(), n.clone(), *c, 1));
        }
        // By name: a rail station's TIPLOC if NaPTAN has one (same stop),
        // else an Underground/metro station under this TIPLOC.
        let (t, n, c) = naptan.names.get(&norm_name(corpus.name.get(tiploc)?))?;
        Some((
            t.clone().unwrap_or_else(|| tiploc.to_owned()),
            n.clone(),
            *c,
            2,
        ))
    };
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
    let mut unplaced: HashMap<String, usize> = HashMap::new();
    for (c, &days) in cands.iter().zip(&final_mask) {
        if days == 0 || !c.passenger {
            continue;
        }
        let mut st: Vec<(usize, u32, u32)> = Vec::new();
        let mut last = 0u32;
        let mut offset = 0u32; // after midnight: times keep counting past 24:00
        for call in &c.calls {
            stats.calls += 1;
            let Some((tiploc, name, coord, how)) = resolve(&call.tiploc) else {
                stats.calls_unplaced += 1;
                *unplaced.entry(call.tiploc.clone()).or_default() += 1;
                continue;
            };
            stats.calls_via_corpus += usize::from(how == 1);
            stats.calls_via_name += usize::from(how == 2);
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
            let s = *stop_idx.entry(tiploc.clone()).or_insert_with(|| {
                feed.stops.push(Stop {
                    id: tiploc.clone(),
                    name: name.clone(),
                    coord,
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
    let mut top: Vec<(String, usize)> = unplaced.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    stats.top_unplaced = top
        .into_iter()
        .take(15)
        .map(|(t, n)| {
            let name = corpus
                .and_then(|c| c.name.get(&t))
                .cloned()
                .unwrap_or_default();
            (t, name, n)
        })
        .collect();
    stats.stations = feed.stops.len();
    feed.stats.trips_total = stats.schedules;
    feed.stats.trips_outside_window = stats.schedules - stats.in_window;
    Ok((feed, stats))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::parse_date;

    fn naptan() -> Naptan {
        let csv = "ATCOCode,CommonName,StopType,Longitude,Latitude,Status\n\
                   9100EDINBUR,Edinburgh Rail Station,RLY,-3.1891,55.9521,active\n\
                   9100HAYMRKT,Haymarket Rail Station,RLY,-3.2183,55.9458,active\n\
                   9100UPHALL,Uphall Rail Station,RLY,-3.5016,55.9189,active\n\
                   9100XXXX,Old Rail Station,RLY,-3.5,55.9,inactive\n\
                   490000001,Some bus stop,BCT,-0.1,51.5,active\n\
                   9100LIVST,London Liverpool Street Rail Station,RLY,-0.0814,51.5178,active\n\
                   940GZZLUBST,Bond Street Underground Station,MET,-0.1494,51.5142,active\n\
                   9100NWPTRTG,Newport (South Wales) Rail Station,RLY,-2.9993,51.5888,active\n\
                   9100NEWPORT,Newport (Essex) Rail Station,RLY,0.2163,51.9800,active\n";
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
        assert_eq!(n.stations.len(), 6, "rail stations only, active only");
        assert_eq!(n.stations["EDINBUR"].0, "Edinburgh");
        assert_eq!(
            norm_name("London Liverpool Street Rail Station"),
            "LIVERPOOL STREET"
        );
        assert_eq!(norm_name("LIVERPOOL STREET EL"), "LIVERPOOL STREET");
        assert_eq!(
            norm_name("HIGHBURY AND ISLINGTON ELL"),
            norm_name("Highbury & Islington Rail Station")
        );
        assert_eq!(norm_name("Bond Street Underground Station"), "BOND STREET");
        assert_eq!(n.names["LIVERPOOL STREET"].0.as_deref(), Some("LIVST"));
        assert_eq!(n.names["BOND STREET"].0, None, "a metro station");
        assert_eq!(n.names["BOND STREET"].1, "Bond Street");
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
        let (feed, st) = load(text.as_bytes(), &naptan(), None, &w).unwrap();
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
        assert_eq!(st.top_unplaced[0].0, "NOWHERE");
        // After midnight: times keep increasing past 24:00.
        let l = feed
            .trips
            .iter()
            .find(|t| t.id.starts_with("L00001"))
            .unwrap();
        assert_eq!(l.stop_times[0].1, 23 * 3600 + 50 * 60);
        assert!(l.stop_times[1].1 > 86_400 && l.stop_times.windows(2).all(|w| w[1].1 >= w[0].2));
    }

    #[test]
    fn corpus_places_sibling_tiplocs() {
        let corpus = read_corpus(
            r#"{"TIPLOCDATA":[
            {"TIPLOC":"HAYMRKT","STANOX":"62006","NLCDESC":"HAYMARKET"},
            {"TIPLOC":"NOWHERE","STANOX":"62006","NLCDESC":"HAYMARKET (PLATFORM 4)"},
            {"TIPLOC":" ","STANOX":" ","NLCDESC":"AN OFFICE"}]}"#
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(corpus.stanox.len(), 2);
        let w = Window {
            start: parse_date("2026-11-09").unwrap(),
            days: 7,
        };
        let text = sched(
            "C15016",
            "P",
            "2026-05-17",
            "2026-12-06",
            "1111111",
            "P",
            "0907",
        );
        let (feed, st) = load(text.as_bytes(), &naptan(), Some(&corpus), &w).unwrap();
        // NOWHERE shares Haymarket's STANOX: placed there, as the same station.
        assert_eq!(st.calls_unplaced, 0);
        assert_eq!(st.calls_via_corpus, 1);
        let t = &feed.trips[0];
        assert_eq!(t.stop_times.len(), 4);
        assert_eq!(t.stop_times[1].0, t.stop_times[2].0, "one stop, two calls");
        assert_eq!(feed.stops.len(), 3);
    }

    #[test]
    fn places_elizabeth_line_calls_by_name() {
        let corpus = read_corpus(
            r#"{"TIPLOCDATA":[
            {"TIPLOC":"HAYMRKT","STANOX":"62006","NLCDESC":"HAYMARKET"},
            {"TIPLOC":"NOWHERE","STANOX":"99999","NLCDESC":"BOND STREET EL"}]}"#
                .as_bytes(),
        )
        .unwrap();
        let w = Window {
            start: parse_date("2026-11-09").unwrap(),
            days: 7,
        };
        let text = sched(
            "C15016",
            "P",
            "2026-05-17",
            "2026-12-06",
            "1111111",
            "P",
            "0907",
        );
        let (feed, st) = load(text.as_bytes(), &naptan(), Some(&corpus), &w).unwrap();
        assert_eq!(st.calls_unplaced, 0);
        assert_eq!(st.calls_via_name, 1);
        let bond = feed.stops.iter().find(|s| s.name == "Bond Street").unwrap();
        assert_eq!(
            bond.id, "NOWHERE",
            "a metro station keeps the call's TIPLOC"
        );
    }
}
