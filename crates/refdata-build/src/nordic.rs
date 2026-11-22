//! M2 countries (docs/europe/south-north.md, west-central.md): Finland
//! (Digitraffic's GTFS, VR), Norway (Entur's per-operator GTFS, merged and
//! cut to trains by tools/gtfs-rail.py) and the Netherlands (OVapi's
//! national GTFS, cut to trains the same way). Each feed is made to look
//! like the others: product as the route's short name, the train number as
//! the trip's.

use crate::load::Feed;
use std::collections::BTreeMap;

pub const FI: &str = "fi";
/// Finland's commuter trains (lähijunat: Helsinki, Tampere, Kouvola…).
pub const FI_LOCAL: &str = "fi-l";
pub const NO: &str = "no";
pub const NL: &str = "nl";
/// M4, timetable only: Slovakia (ŽSR) and Estonia (Elron).
pub const SK: &str = "sk";
pub const EE: &str = "ee";

pub const ATTRIBUTION_FI: &str = "Data: Fintraffic / digitraffic.fi, CC BY 4.0. \
Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_NO: &str = "Data: contains data under the NLOD made available by Entur AS. \
Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_SK: &str = "Data: Železnice Slovenskej republiky (data.slovensko.sk), \
CC BY. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_EE: &str = "Data: Regionaal- ja Põllumajandusministeerium, public transport \
register open data. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_NL: &str = "Data: OVapi (gtfs.ovapi.nl), from the NDOV national data, CC0; \
shapes ODbL. Track: © OpenStreetMap contributors, ODbL 1.0.";

/// The time zone of each M2 region.
pub fn tz(code: &str) -> Option<&'static str> {
    Some(match code {
        FI | FI_LOCAL => "Europe/Helsinki",
        NO => "Europe/Oslo",
        NL => "Europe/Amsterdam",
        SK => "Europe/Bratislava",
        EE => "Europe/Tallinn",
        _ => return None,
    })
}

pub fn region_name(code: &str) -> &'static str {
    match code {
        FI => "Finland (InterCity, Pendolino)",
        FI_LOCAL => "Finland (commuter trains)",
        NO => "Norway",
        NL => "Netherlands",
        SK => "Slovakia",
        EE => "Estonia",
        _ => "",
    }
}

/// VR's product codes as the app shows them.
pub fn finnish_product(code: &str) -> &str {
    match code {
        "S" => "Pendolino",
        "IC" => "InterCity",
        "PYO" => "Night train",
        "HDM" | "H" => "Regional",
        other => other,
    }
}

#[derive(Debug, Default)]
pub struct Stats {
    pub dropped: usize,
    pub by_product: BTreeMap<String, usize>,
}

/// Finland: routes are per train ("IC 1", "S 45") or a commuter line with
/// the train number in brackets ("A (HL 8192)"). Museum trains (`MUS`) are
/// dropped: they have no live data and run a few days a year.
pub fn normalise_finland(feed: &mut Feed) -> Stats {
    let mut st = Stats::default();
    let before = feed.trips.len();
    let routes = &feed.routes;
    feed.trips.retain(|t| {
        !routes[t.route]
            .short_name
            .split_whitespace()
            .next()
            .is_some_and(|p| p == "MUS")
    });
    st.dropped = before - feed.trips.len();
    for t in &mut feed.trips {
        let name = if t.short_name.is_empty() {
            feed.routes[t.route].short_name.clone()
        } else {
            t.short_name.clone()
        };
        // "A (HL 8192)" → line A, train 8192; "IC 1" → InterCity, train 1.
        if let Some((_, rest)) = name.split_once(" (") {
            t.short_name = rest
                .trim_end_matches(')')
                .rsplit(' ')
                .next()
                .unwrap_or("")
                .to_owned();
        } else if let Some((_, n)) = name.split_once(' ') {
            t.short_name = n.trim().to_owned();
        }
    }
    for r in &mut feed.routes {
        let first = r
            .short_name
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_owned();
        let commuter = r.route_type == "109";
        r.short_name = if commuter {
            first
        } else {
            finnish_product(&first).to_owned()
        };
    }
    for t in &feed.trips {
        *st.by_product
            .entry(feed.routes[t.route].short_name.clone())
            .or_default() += 1;
    }
    st
}

/// Finland's split: long-distance (route type 102) and commuter (109).
pub fn split_finland(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let code = if feed.routes[t.route].route_type == "109" {
            FI_LOCAL
        } else {
            FI
        };
        out.entry(code.to_owned()).or_default().push(t);
    }
    out
}

/// Norway's train number, from Entur's trip id: Vy, Go-Ahead and SJ Norge
/// start the local part with it (`VYG:ServiceJourney:1913_819010-R`),
/// Flytoget puts it third (`FLT:ServiceJourney:1-2614-3736-20261122`).
pub fn norwegian_number(trip_id: &str) -> String {
    let local = trip_id.rsplit(':').next().unwrap_or("");
    if trip_id.starts_with("FLT:") {
        return local.split('-').nth(2).unwrap_or("").to_owned();
    }
    // Only when the digits stand alone: some of Vy's ids are UUIDs.
    let n: String = local.chars().take_while(char::is_ascii_digit).collect();
    match local[n.len()..].chars().next() {
        None | Some('_' | '-') => n,
        _ => String::new(),
    }
}

pub fn normalise_norway(feed: &mut Feed) -> Stats {
    let mut st = Stats::default();
    for t in &mut feed.trips {
        if t.short_name.is_empty() {
            t.short_name = norwegian_number(&t.id);
        }
        *st.by_product
            .entry(feed.routes[t.route].short_name.clone())
            .or_default() += 1;
    }
    for s in &mut feed.stops {
        // "Solbråtan stasjon" → "Solbråtan": every stop here is a station.
        if let Some(n) = s.name.strip_suffix(" stasjon") {
            s.name = n.to_owned();
        }
    }
    st
}

/// The Netherlands: NS's routes are named by product ("Sprinter",
/// "Intercity") or by line ("IC31", "S75", "RS18"); keep the product when
/// the name is a line code, from the line's letters.
pub fn dutch_product(name: &str) -> &str {
    let letters: String = name.chars().take_while(char::is_ascii_alphabetic).collect();
    let is_code = name.len() <= 5 && name.chars().any(|c| c.is_ascii_digit());
    if !is_code {
        return name;
    }
    match letters.as_str() {
        "IC" => "Intercity",
        "S" | "SPR" => "Sprinter",
        "RS" | "ST" => "Stoptrein",
        "RE" => "Regional Express",
        _ => name,
    }
}

pub fn normalise_netherlands(feed: &mut Feed) -> Stats {
    let mut st = Stats::default();
    for r in &mut feed.routes {
        r.short_name = dutch_product(&r.short_name).to_owned();
    }
    for t in &feed.trips {
        *st.by_product
            .entry(feed.routes[t.route].short_name.clone())
            .or_default() += 1;
    }
    st
}

/// Slovakia and Estonia (timetable only): the product from the route's
/// first word ("EC 120" → "EC", "Os 7210" → "Os"); a train number only
/// where the trip has one (Elron's trips are named by their ends instead).
pub fn normalise_simple(feed: &mut Feed) -> Stats {
    let mut st = Stats::default();
    for r in &mut feed.routes {
        let first = r
            .short_name
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_owned();
        if r.short_name.contains(' ') && !first.is_empty() {
            r.short_name = first;
        }
    }
    for t in &mut feed.trips {
        if !t.short_name.chars().all(|c| c.is_ascii_digit()) {
            t.short_name.clear();
        }
        *st.by_product
            .entry(feed.routes[t.route].short_name.clone())
            .or_default() += 1;
    }
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finnish_products() {
        assert_eq!(finnish_product("S"), "Pendolino");
        assert_eq!(finnish_product("IC"), "InterCity");
        assert_eq!(finnish_product("PYO"), "Night train");
        assert_eq!(tz(FI_LOCAL), Some("Europe/Helsinki"));
    }

    #[test]
    fn norwegian_train_numbers() {
        assert_eq!(norwegian_number("VYG:ServiceJourney:1913_819010-R"), "1913");
        assert_eq!(
            norwegian_number("VYG:ServiceJourney:300-803-HHS_1041489-R"),
            "300"
        );
        assert_eq!(
            norwegian_number("GOA:ServiceJourney:711-LOD_63241-R"),
            "711"
        );
        assert_eq!(
            norwegian_number("FLT:ServiceJourney:1-2614-3736-20261122"),
            "3736"
        );
        assert_eq!(norwegian_number("VYG:ServiceJourney:530d38d0-929a"), "");
    }

    #[test]
    fn simple_countries_keep_products_and_numbers() {
        use crate::load::{Route, Trip};
        let route = |n: &str| Route {
            id: n.into(),
            short_name: n.into(),
            long_name: String::new(),
            color: None,
            text_color: None,
            route_type: "106".into(),
        };
        let trip = |r: usize, n: &str| Trip {
            id: n.into(),
            route: r,
            service: String::new(),
            headsign: String::new(),
            short_name: n.into(),
            shape_id: String::new(),
            days: 1,
            stop_times: vec![],
        };
        let mut feed = Feed {
            routes: vec![route("EC 120"), route("E33")],
            trips: vec![trip(0, "120"), trip(1, "Tallinn -Turba")],
            ..Feed::default()
        };
        normalise_simple(&mut feed);
        assert_eq!(feed.routes[0].short_name, "EC");
        assert_eq!(feed.routes[1].short_name, "E33");
        assert_eq!(feed.trips[0].short_name, "120");
        assert_eq!(feed.trips[1].short_name, "");
        assert_eq!(tz(EE), Some("Europe/Tallinn"));
    }

    #[test]
    fn dutch_products() {
        assert_eq!(dutch_product("IC31"), "Intercity");
        assert_eq!(dutch_product("S75"), "Sprinter");
        assert_eq!(dutch_product("RS18"), "Stoptrein");
        assert_eq!(dutch_product("Intercity direct"), "Intercity direct");
        assert_eq!(dutch_product("Sprinter"), "Sprinter");
    }
}
