//! NI Railways' timetable (Translink, OpenDataNI dataset `nir20160126v2`,
//! OGL) in TransXChange 2.4 → a [`Feed`] (plan 4b). Read from the real file
//! (NI feed check, Nov 2026):
//!
//! - `StopPoints/StopPoint`: one per platform (`AtcoCode` `9000BR4`,
//!   `Descriptor/CommonName` "Bangor Train Station", `Place/Location`
//!   longitude/latitude). Platforms of a station share its name: they become
//!   one stop, id the ATCO code without the platform digits (`9000BR`).
//! - `Services/Service`: `Lines/Line/LineName` ("Bangor Line"),
//!   `OperatingPeriod` (start/end dates), its `OperatingProfile` and
//!   `JourneyPattern`s (each → `JourneyPatternSectionRefs`).
//! - `JourneyPatternSections/JourneyPatternSection`: timing links, each
//!   `From`/`To` with `StopPointRef`, optional `WaitTime` (ISO duration) and
//!   a `RunTime`.
//! - `VehicleJourneys/VehicleJourney`: `PrivateCode` (`rai-…-67-TA`),
//!   `OperatingProfile` (days of week, `SpecialDaysOperation` date ranges of
//!   (non-)operation), `ServiceRef`, `LineRef`, `JourneyPatternRef`,
//!   `DepartureTime`.
//!
//! No train numbers: each trip gets one from its line's initial and its
//! journey number ("B67"). The file is windows-1252.

use crate::calendar::{Window, parse_date, weekday};
use crate::load::{Feed, Route, Stop, Trip};
use roxmltree::{Document, Node};
use std::collections::{BTreeMap, HashMap};
use trainradar_proto::LatLon;

#[derive(Debug, Default)]
pub struct TxcStats {
    pub stop_points: usize,
    pub stations: usize,
    pub journeys: usize,
    pub in_window: usize,
    pub lines: Vec<String>,
    /// Journeys dropped: unknown pattern or stops, or under two calls.
    pub unusable: usize,
    /// The last day any service runs (the file must be replaced before).
    pub last_day: Option<i64>,
}

/// windows-1252 → UTF-8 (the file's declared encoding).
pub fn decode_cp1252(b: &[u8]) -> String {
    const HI: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    b.iter()
        .map(|&c| match c {
            0x80..=0x9f => HI[usize::from(c - 0x80)],
            _ => char::from(c),
        })
        .collect()
}

fn child<'a, 'i>(n: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    n.children().find(|c| c.has_tag_name(name))
}
fn path<'a, 'i>(n: Node<'a, 'i>, names: &[&str]) -> Option<Node<'a, 'i>> {
    names.iter().try_fold(n, |n, name| child(n, name))
}
fn text<'a>(n: Node<'a, '_>, names: &[&str]) -> &'a str {
    path(n, names).and_then(|x| x.text()).unwrap_or("").trim()
}

/// ISO 8601 duration as TransXChange uses it (`PT2M`, `PT1H5M30S`, `PT0S`).
pub fn duration_secs(s: &str) -> Option<u32> {
    let t = s.trim().strip_prefix("PT")?;
    let (mut total, mut num) = (0u32, String::new());
    for c in t.chars() {
        if c.is_ascii_digit() {
            num.push(c);
            continue;
        }
        let v: u32 = num.parse().ok()?;
        num.clear();
        total += match c {
            'H' => v * 3600,
            'M' => v * 60,
            'S' => v,
            _ => return None,
        };
    }
    num.is_empty().then_some(total)
}

/// "Bangor Train Station" → "Bangor".
pub fn station_name(s: &str) -> String {
    let t = s.trim();
    for suffix in [
        " Train Station",
        " Railway Station",
        " Rail Station",
        " Station",
    ] {
        if let Some(x) = t.strip_suffix(suffix) {
            return x.trim().to_owned();
        }
    }
    t.to_owned()
}

/// Days of the week an `OperatingProfile` runs (bit 0 = Monday), or None
/// when it has no `RegularDayType` (then the service's applies).
fn week_mask(profile: Node) -> Option<u8> {
    let days = path(profile, &["RegularDayType", "DaysOfWeek"])?;
    let mut m = 0u8;
    for d in days.children().filter(Node::is_element) {
        m |= match d.tag_name().name() {
            "Monday" => 1,
            "Tuesday" => 2,
            "Wednesday" => 4,
            "Thursday" => 8,
            "Friday" => 16,
            "Saturday" => 32,
            "Sunday" => 64,
            "MondayToFriday" => 31,
            "MondayToSaturday" => 63,
            "MondayToSunday" => 127,
            "Weekend" => 96,
            "NotMonday" => 126,
            "NotTuesday" => 125,
            "NotWednesday" => 123,
            "NotThursday" => 119,
            "NotFriday" => 111,
            "NotSaturday" => 95,
            "NotSunday" => 63,
            _ => 0,
        };
    }
    Some(m)
}

/// Date ranges under `SpecialDaysOperation/<which>`, inclusive.
fn ranges(profile: Node, which: &str) -> Vec<(i64, i64)> {
    path(profile, &["SpecialDaysOperation", which])
        .map(|n| {
            n.children()
                .filter(|c| c.has_tag_name("DateRange"))
                .filter_map(|r| {
                    let s = parse_date(text(r, &["StartDate"]))?;
                    let e = parse_date(text(r, &["EndDate"])).unwrap_or(s);
                    Some((s, e))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Days in the window a journey runs: its (or its service's) weekdays,
/// within the service's period, minus days of non-operation, plus days of
/// operation.
fn day_mask(
    window: &Window,
    week: u8,
    period: (i64, Option<i64>),
    off: &[(i64, i64)],
    on: &[(i64, i64)],
) -> u64 {
    let mut mask = 0u64;
    for n in 0..window.days {
        let day = window.start + i64::from(n);
        let in_period = day >= period.0 && period.1.is_none_or(|e| day <= e);
        let in_range = |rs: &[(i64, i64)]| rs.iter().any(|&(s, e)| day >= s && day <= e);
        let runs = (in_period && week & (1 << weekday(day)) != 0 && !in_range(off)) || in_range(on);
        if runs {
            mask |= 1 << n;
        }
    }
    mask
}

/// A line's letter for train numbers: "Bangor Line" → B, the Enterprise → E.
fn line_letter(name: &str) -> char {
    if name.contains("Enterprise") {
        return 'E';
    }
    name.chars()
        .find(char::is_ascii_alphabetic)
        .map_or('N', |c| c.to_ascii_uppercase())
}

/// The journey number in a `PrivateCode` like `rai-90-1-_-r13-1-67-TA`.
fn journey_number(code: &str) -> Option<&str> {
    code.rsplit('-')
        .find(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

pub fn load(xml: &str, window: &Window) -> Result<(Feed, TxcStats), String> {
    let doc = Document::parse(xml).map_err(|e| format!("TransXChange: {e}"))?;
    let root = doc.root_element();
    let mut st = TxcStats::default();
    let mut feed = Feed::default();

    // Stations: platforms grouped by name; coordinates averaged.
    struct Station {
        id: String,
        name: String,
        lat: f64,
        lon: f64,
        n: f64,
    }
    let mut stations: BTreeMap<String, Station> = BTreeMap::new();
    let mut station_of: HashMap<String, String> = HashMap::new(); // ATCO → name key
    for sp in path(root, &["StopPoints"])
        .into_iter()
        .flat_map(|n| n.children())
        .filter(|c| c.has_tag_name("StopPoint"))
    {
        let atco = text(sp, &["AtcoCode"]);
        let name = station_name(text(sp, &["Descriptor", "CommonName"]));
        let lat: Option<f64> = text(sp, &["Place", "Location", "Latitude"]).parse().ok();
        let lon: Option<f64> = text(sp, &["Place", "Location", "Longitude"]).parse().ok();
        let (Some(lat), Some(lon)) = (lat, lon) else {
            continue;
        };
        if atco.is_empty()
            || name.is_empty()
            || !(-90.0..=90.0).contains(&lat)
            || !(-180.0..=180.0).contains(&lon)
        {
            continue;
        }
        st.stop_points += 1;
        let id = atco
            .trim_end_matches(|c: char| c.is_ascii_digit())
            .to_owned();
        let e = stations.entry(name.clone()).or_insert(Station {
            id: id.clone(),
            name: name.clone(),
            lat: 0.0,
            lon: 0.0,
            n: 0.0,
        });
        if id < e.id {
            e.id = id; // stable: the smallest code
        }
        e.lat += lat;
        e.lon += lon;
        e.n += 1.0;
        station_of.insert(atco.to_owned(), name);
    }
    let mut stop_idx: HashMap<String, usize> = HashMap::new();
    for (key, s) in &stations {
        stop_idx.insert(key.clone(), feed.stops.len());
        feed.stops.push(Stop {
            id: s.id.clone(),
            name: s.name.clone(),
            coord: LatLon::new(s.lat / s.n, s.lon / s.n),
        });
    }
    st.stations = feed.stops.len();

    // Journey pattern sections → calls: (stop, arrival offset, departure offset).
    type Calls = Vec<(usize, u32, u32)>;
    let mut sections: HashMap<&str, Calls> = HashMap::new();
    for sec in root
        .descendants()
        .filter(|n| n.has_tag_name("JourneyPatternSection"))
    {
        let Some(id) = sec.attribute("id") else {
            continue;
        };
        let mut calls: Calls = Vec::new();
        let mut t = 0u32;
        let mut ok = true;
        for link in sec
            .children()
            .filter(|c| c.has_tag_name("JourneyPatternTimingLink"))
        {
            let stop = |end: &str| -> Option<usize> {
                let atco = text(link, &[end, "StopPointRef"]);
                stop_idx.get(station_of.get(atco)?).copied()
            };
            let wait = |end: &str| duration_secs(text(link, &[end, "WaitTime"])).unwrap_or(0);
            let (Some(from), Some(to), Some(run)) = (
                stop("From"),
                stop("To"),
                duration_secs(text(link, &["RunTime"])),
            ) else {
                ok = false;
                break;
            };
            if calls.is_empty() {
                calls.push((from, t, t + wait("From")));
            } else if let Some(last) = calls.last_mut() {
                // A wait at the previous call (its "To") or before this link.
                last.2 = last.1 + (last.2 - last.1).max(wait("From"));
            }
            t = calls.last().map_or(t, |c| c.2) + run;
            let w = wait("To");
            calls.push((to, t, t + w));
        }
        if ok && calls.len() >= 2 {
            sections.insert(id, calls);
        }
    }
    // Journey patterns → their sections' calls joined.
    let mut patterns: HashMap<&str, Calls> = HashMap::new();
    // Services: line names, operating period, default profile.
    struct Svc<'a> {
        line: String,
        period: (i64, Option<i64>),
        profile: Option<Node<'a, 'a>>,
    }
    let mut services: HashMap<&str, Svc> = HashMap::new();
    let mut line_names: HashMap<&str, String> = HashMap::new();
    for svc in root.descendants().filter(|n| n.has_tag_name("Service")) {
        let code = text(svc, &["ServiceCode"]);
        for l in svc.descendants().filter(|n| n.has_tag_name("Line")) {
            if let Some(id) = l.attribute("id") {
                line_names.insert(id, text(l, &["LineName"]).to_owned());
            }
        }
        let line = svc
            .descendants()
            .find(|n| n.has_tag_name("LineName"))
            .and_then(|n| n.text())
            .unwrap_or("")
            .trim()
            .to_owned();
        let start = parse_date(text(svc, &["OperatingPeriod", "StartDate"])).unwrap_or(i64::MIN);
        let end = parse_date(text(svc, &["OperatingPeriod", "EndDate"]));
        if let Some(e) = end {
            st.last_day = Some(st.last_day.map_or(e, |d| d.max(e)));
        }
        services.insert(
            code,
            Svc {
                line,
                period: (start, end),
                profile: child(svc, "OperatingProfile"),
            },
        );
        for jp in svc
            .descendants()
            .filter(|n| n.has_tag_name("JourneyPattern"))
        {
            let Some(id) = jp.attribute("id") else {
                continue;
            };
            let mut calls: Calls = Vec::new();
            for r in jp
                .children()
                .filter(|c| c.has_tag_name("JourneyPatternSectionRefs"))
            {
                let Some(sec) = r.text().and_then(|s| sections.get(s.trim())) else {
                    calls.clear();
                    break;
                };
                let base = calls.last().map_or(0, |c| c.2);
                let skip = usize::from(!calls.is_empty()); // the joint stop appears twice
                calls.extend(
                    sec.iter()
                        .skip(skip)
                        .map(|&(s, a, d)| (s, a + base, d + base)),
                );
            }
            if calls.len() >= 2 {
                patterns.insert(id, calls);
            }
        }
    }

    // Routes: one per line name.
    let mut route_of: HashMap<String, usize> = HashMap::new();
    let mut used: HashMap<String, usize> = HashMap::new();
    for vj in root
        .descendants()
        .filter(|n| n.has_tag_name("VehicleJourney"))
    {
        st.journeys += 1;
        let svc = services.get(text(vj, &["ServiceRef"]));
        let jp = patterns.get(text(vj, &["JourneyPatternRef"]));
        let dep = crate::calendar::parse_time(text(vj, &["DepartureTime"]));
        let (Some(svc), Some(calls), Some(dep)) = (svc, jp, dep) else {
            st.unusable += 1;
            continue;
        };
        let profile = child(vj, "OperatingProfile").or(svc.profile);
        let week = profile
            .and_then(week_mask)
            .or_else(|| svc.profile.and_then(week_mask))
            .unwrap_or(0);
        let off = profile
            .map(|p| ranges(p, "DaysOfNonOperation"))
            .unwrap_or_default();
        let on = profile
            .map(|p| ranges(p, "DaysOfOperation"))
            .unwrap_or_default();
        let days = day_mask(window, week, svc.period, &off, &on);
        if days == 0 {
            continue;
        }
        st.in_window += 1;
        let line = line_names
            .get(text(vj, &["LineRef"]))
            .filter(|n| !n.is_empty() && n.chars().any(|c| c.is_ascii_alphabetic()))
            .cloned()
            .unwrap_or_else(|| svc.line.clone());
        let route = *route_of.entry(line.clone()).or_insert_with(|| {
            feed.routes.push(Route {
                id: line.clone(),
                short_name: line.trim_end_matches(" Line").to_owned(),
                long_name: line.clone(),
                color: None,
                text_color: None,
                route_type: "2".into(),
            });
            feed.routes.len() - 1
        });
        let code = text(vj, &["PrivateCode"]);
        let base = format!(
            "{}{}",
            line_letter(&line),
            journey_number(code).unwrap_or("0")
        );
        let n = used.entry(base.clone()).or_insert(0);
        *n += 1;
        let number = if *n == 1 {
            base
        } else {
            format!("{base}{}", char::from(b'a' + (*n as u8 - 2).min(25)))
        };
        let last = calls.last().map_or(0, |c| c.0);
        feed.trips.push(Trip {
            id: format!("NI{number}"),
            route,
            service: text(vj, &["ServiceRef"]).to_owned(),
            headsign: feed.stops[last].name.clone(),
            short_name: number,
            shape_id: String::new(),
            days,
            stop_times: calls
                .iter()
                .map(|&(s, a, d)| (s, a + dep, d + dep))
                .collect(),
        });
    }
    let mut lines: Vec<String> = route_of.into_keys().collect();
    lines.sort();
    st.lines = lines;
    feed.stats.trips_total = st.journeys;
    Ok((feed, st))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::days_from_civil;

    /// The real file's shape (NI feed check, Nov 2026), cut down: Bangor →
    /// Bangor West → Carnalea, weekday and Sunday journeys, two platforms at
    /// Bangor, a week without Sunday trains.
    const XML: &str = r#"<?xml version="1.0" encoding="windows-1252"?>
<TransXChange xmlns="http://www.transxchange.org.uk/" SchemaVersion="2.4">
  <StopPoints>
    <StopPoint CreationDateTime="2026-09-04T00:00:00"><AtcoCode>9000BR4</AtcoCode><Descriptor><CommonName>Bangor Train Station</CommonName></Descriptor>
      <Place><Location><Longitude>-5.673075</Longitude><Latitude>54.658215</Latitude></Location></Place></StopPoint>
    <StopPoint CreationDateTime="2026-09-04T00:00:00"><AtcoCode>9000BR6</AtcoCode><Descriptor><CommonName>Bangor Train Station</CommonName></Descriptor>
      <Place><Location><Longitude>-5.672517</Longitude><Latitude>54.658483</Latitude></Location></Place></StopPoint>
    <StopPoint><AtcoCode>9000BW4</AtcoCode><Descriptor><CommonName>Bangor West Train Station</CommonName></Descriptor>
      <Place><Location><Longitude>-5.69</Longitude><Latitude>54.66</Latitude></Location></Place></StopPoint>
    <StopPoint><AtcoCode>9000CA4</AtcoCode><Descriptor><CommonName>Carnalea Train Station</CommonName></Descriptor>
      <Place><Location><Longitude>-5.71</Longitude><Latitude>54.66</Latitude></Location></Place></StopPoint>
  </StopPoints>
  <JourneyPatternSections>
    <JourneyPatternSection id="JPS_1">
      <JourneyPatternTimingLink id="L1"><From SequenceNumber="1"><Activity>pickUp</Activity><StopPointRef>9000BR6</StopPointRef></From>
        <To SequenceNumber="4"><WaitTime>PT1M</WaitTime><StopPointRef>9000BW4</StopPointRef></To><RunTime>PT2M</RunTime></JourneyPatternTimingLink>
      <JourneyPatternTimingLink id="L2"><From SequenceNumber="4"><StopPointRef>9000BW4</StopPointRef></From>
        <To SequenceNumber="5"><StopPointRef>9000CA4</StopPointRef></To><RunTime>PT2M</RunTime></JourneyPatternTimingLink>
    </JourneyPatternSection>
  </JourneyPatternSections>
  <Services>
    <Service><ServiceCode>90-1-_-r13-1</ServiceCode>
      <Lines><Line id="90-1-_-r13-1"><LineName>Bangor Line</LineName></Line></Lines>
      <OperatingPeriod><StartDate>2026-09-10</StartDate><EndDate>2026-12-13</EndDate></OperatingPeriod>
      <OperatingProfile><RegularDayType><DaysOfWeek><MondayToSunday /></DaysOfWeek></RegularDayType></OperatingProfile>
      <StandardService>
        <JourneyPattern id="JP_1"><Direction>outbound</Direction><JourneyPatternSectionRefs>JPS_1</JourneyPatternSectionRefs></JourneyPattern>
      </StandardService>
    </Service>
  </Services>
  <VehicleJourneys>
    <VehicleJourney><PrivateCode>rai-90-1-_-r13-1-1-TA</PrivateCode>
      <OperatingProfile><RegularDayType><DaysOfWeek><MondayToFriday /></DaysOfWeek></RegularDayType></OperatingProfile>
      <VehicleJourneyCode>VJ_1</VehicleJourneyCode><ServiceRef>90-1-_-r13-1</ServiceRef><LineRef>90-1-_-r13-1</LineRef>
      <JourneyPatternRef>JP_1</JourneyPatternRef><DepartureTime>07:17:00</DepartureTime></VehicleJourney>
    <VehicleJourney><PrivateCode>rai-90-1-_-r13-1-67-TA</PrivateCode>
      <OperatingProfile><RegularDayType><DaysOfWeek><Sunday /></DaysOfWeek></RegularDayType>
        <SpecialDaysOperation><DaysOfNonOperation><DateRange><StartDate>2026-12-07</StartDate><EndDate>2026-12-13</EndDate></DateRange></DaysOfNonOperation></SpecialDaysOperation></OperatingProfile>
      <VehicleJourneyCode>VJ_67</VehicleJourneyCode><ServiceRef>90-1-_-r13-1</ServiceRef><LineRef>90-1-_-r13-1</LineRef>
      <JourneyPatternRef>JP_1</JourneyPatternRef><DepartureTime>23:58:00</DepartureTime></VehicleJourney>
    <VehicleJourney><PrivateCode>rai-x-9-TA</PrivateCode><ServiceRef>90-1-_-r13-1</ServiceRef><JourneyPatternRef>JP_missing</JourneyPatternRef><DepartureTime>08:00:00</DepartureTime></VehicleJourney>
  </VehicleJourneys>
</TransXChange>"#;

    #[test]
    fn durations_names_and_encoding() {
        assert_eq!(duration_secs("PT2M"), Some(120));
        assert_eq!(duration_secs("PT1H5M30S"), Some(3930));
        assert_eq!(duration_secs("PT0S"), Some(0));
        assert_eq!(duration_secs("2M"), None);
        assert_eq!(station_name("Bangor Train Station"), "Bangor");
        assert_eq!(station_name("Grand Central Station"), "Grand Central");
        assert_eq!(decode_cp1252(b"caf\xe9 \x80"), "café €");
        assert_eq!(journey_number("rai-90-1-_-r13-1-67-TA"), Some("67"));
        assert_eq!(line_letter("Belfast - Dublin (Enterprise)"), 'E');
        assert_eq!(line_letter("Derry/Londonderry Line"), 'D');
    }

    #[test]
    fn stations_trips_times_and_days() {
        // Mon 30 Nov – Tue 15 Dec 2026: two Sundays (6th runs, 13th doesn't).
        let window = Window {
            start: days_from_civil(2026, 11, 30),
            days: 16,
        };
        let (feed, st) = load(XML, &window).unwrap();
        assert_eq!(st.stop_points, 4);
        assert_eq!(
            feed.stops.len(),
            3,
            "Bangor's two platforms are one station"
        );
        let bangor = feed.stops.iter().find(|s| s.name == "Bangor").unwrap();
        assert_eq!(bangor.id, "9000BR");
        assert!((bangor.coord.lat - 54.658349).abs() < 1e-5);
        assert_eq!(st.journeys, 3);
        assert_eq!(st.unusable, 1, "unknown journey pattern");
        assert_eq!(st.last_day, Some(days_from_civil(2026, 12, 13)));
        assert_eq!(feed.routes[0].short_name, "Bangor");
        let wk = feed.trips.iter().find(|t| t.short_name == "B1").unwrap();
        // Weekdays only, and the service ends on Sun 13 Dec: Mon 30 Nov – Fri 11 Dec.
        assert_eq!(wk.days, 0b1111_1001_1111, "days 0–4 and 7–11 of the window");
        assert_eq!(wk.headsign, "Carnalea");
        // 07:17 from Bangor; Bangor West 07:19, waits a minute; Carnalea 07:22.
        let t = |h: u32, m: u32| h * 3600 + m * 60;
        let times: Vec<_> = wk.stop_times.iter().map(|&(_, a, d)| (a, d)).collect();
        assert_eq!(
            times,
            [
                (t(7, 17), t(7, 17)),
                (t(7, 19), t(7, 20)),
                (t(7, 22), t(7, 22))
            ]
        );
        let sun = feed.trips.iter().find(|t| t.short_name == "B67").unwrap();
        assert_eq!(
            sun.days,
            1 << 6,
            "Sunday 6 Dec only (not the week of 7–13 Dec)"
        );
        assert_eq!(
            sun.stop_times.last().unwrap().1,
            t(24, 3),
            "times past midnight keep counting"
        );
        assert_eq!(sun.id, "NIB67");
    }
}
