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
/// M3/M5: Switzerland (long distance, then regional and S-Bahn), Sweden,
/// Poland (long distance, then regional).
pub const CH: &str = "ch";
pub const CH_REGIONAL: &str = "ch-r";
pub const SE: &str = "se";
pub const PL: &str = "pl";
pub const PL_REGIONAL: &str = "pl-r";
/// Austria (M4): by timetable.
pub const AT: &str = "at";
/// Czechia: by timetable, long distance and regional.
pub const CZ: &str = "cz";
pub const CZ_REGIONAL: &str = "cz-r";
/// Italy, by timetable: Trenitalia's long-distance and regional trains
/// (the national access point's NeTEx), and Trenord's in Lombardy.
pub const IT: &str = "it";
pub const IT_REGIONAL: &str = "it-r";
pub const IT_LOMBARDY: &str = "it-lom";
/// Denmark: Rejseplanen's NeTEx, every train operator; live from SIRI-ET.
pub const DK: &str = "dk";
/// Hungary, by timetable: MÁV-START's and GYSEV's long-distance trains,
/// then the rest (MÁV's GTFS, which needs a login).
pub const HU: &str = "hu";
pub const HU_REGIONAL: &str = "hu-r";
/// Germany: DELFI's national GTFS, cut to trains. Long-distance trains in
/// one region; the rest by the Land of their first stop (its DHID's first
/// two digits: "de:05315:11201" is North Rhine-Westphalia), Bremen with
/// Lower Saxony and Hamburg with Schleswig-Holstein, as their networks are
/// one; live delays from DB's OpenBoards.
pub const DE: &str = "de";
const GERMAN_LANDS: [(&str, &str, &str); 16] = [
    ("01", "de-sh", "Germany (Schleswig-Holstein, Hamburg)"),
    ("02", "de-sh", "Germany (Schleswig-Holstein, Hamburg)"),
    ("03", "de-ni", "Germany (Lower Saxony, Bremen)"),
    ("04", "de-ni", "Germany (Lower Saxony, Bremen)"),
    ("05", "de-nw", "Germany (North Rhine-Westphalia)"),
    ("06", "de-he", "Germany (Hesse)"),
    ("07", "de-rp", "Germany (Rhineland-Palatinate, Saarland)"),
    ("10", "de-rp", "Germany (Rhineland-Palatinate, Saarland)"),
    ("08", "de-bw", "Germany (Baden-Württemberg)"),
    ("09", "de-by", "Germany (Bavaria)"),
    ("11", "de-bb", "Germany (Berlin, Brandenburg)"),
    ("12", "de-bb", "Germany (Berlin, Brandenburg)"),
    ("13", "de-mv", "Germany (Mecklenburg-Vorpommern)"),
    ("14", "de-sn", "Germany (Saxony)"),
    ("15", "de-st", "Germany (Saxony-Anhalt)"),
    ("16", "de-th", "Germany (Thuringia)"),
];
/// Belgium: SNCB's GTFS (the Belgian Mobility Company's gateway), cut to
/// trains; live trip updates and alerts from its GTFS-Realtime.
pub const BE: &str = "be";
/// New South Wales: Transport for NSW's GTFS (Sydney Trains, NSW TrainLink,
/// Sydney Metro), cut to trains; on Sydney time.
pub const AU_NSW: &str = "au-nsw";
/// Victoria: Transport Victoria's GTFS (V/Line, Metro Trains); Melbourne
/// time (the same rules as Sydney's).
pub const AU_VIC: &str = "au-vic";
/// Wellington: Metlink's GTFS (Greater Wellington Regional Council), cut to
/// trains; New Zealand time.
pub const NZ_WLG: &str = "nz-wlg";
/// Auckland: Auckland Transport's GTFS, cut to trains; New Zealand time.
pub const NZ_AKL: &str = "nz-akl";
/// Singapore: the MRT and LRT, an estimated timetable (OSM routes and
/// published frequencies; LTA publishes none).
pub const SG: &str = "sg";
/// Portugal: CP's national timetable (only with CP's permission).
pub const PT: &str = "pt";
/// Lisbon: Fertagus and Lisbon Metro.
pub const PT_LIS: &str = "pt-lis";
/// Tokyo: Toei's subway, Toden Arakawa tram and Nippori-Toneri Liner.
pub const JP_TYO: &str = "jp-tyo";
/// Kōchi: Tosaden's trams.
pub const JP_KCH: &str = "jp-kch";
/// A German stop whose DHID names no Land (none seen in DELFI).
pub const DE_OTHER: &str = "de-x";

pub const ATTRIBUTION_FI: &str = "Data: Fintraffic / digitraffic.fi, CC BY 4.0. \
Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_NO: &str = "Data: contains data under the NLOD made available by Entur AS. \
Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_SK: &str = "Data: Železnice Slovenskej republiky (data.slovensko.sk), \
CC BY. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_EE: &str = "Data: Regionaal- ja Põllumajandusministeerium, public transport \
register open data. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_CH: &str = "Data: opentransportdata.swiss (Open Data Platform Mobility \
Switzerland). Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_SE: &str = "Data: Samtrafiken / Trafiklab.se (GTFS Sweden 3), CC0 1.0. \
Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_PL: &str = "Data: PKP Polskie Linie Kolejowe S.A., Otwarte Dane Kolejowe \
(pdp-api.plk-sa.pl). Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_AT: &str = "Data source: Mobilitätsverbünde Österreich OG - \
data.mobilitaetsverbuende.at. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_CZ: &str = "Data: Ministry of Transport of the Czech Republic, CIS JŘ \
(portal.cisjr.cz). Track and stations: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_IT: &str = "Data: Trenitalia and Italo, via Italy's national access point (CCISS, \
cciss.it); Trenord, Regione Lombardia open data (dati.lombardia.it), CC BY 4.0. Track: © \
OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_HU: &str = "Data: MÁV Csoport GTFS (mavcsoport.hu), MÁV-START and GYSEV \
timetables. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_DE: &str = "Data: DELFI e.V. (www.delfi.de), via opendata-oepnv.de, CC BY 4.0; \
live: DB InfraGO AG, OpenBoards. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_BE: &str = "Data: SNCB/NMBS, via the Belgian Mobility Company's open data \
gateway (non-commercial use). Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_AU_NSW: &str = "Data: Transport for NSW (opendata.transport.nsw.gov.au), \
CC BY 4.0. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_AU_VIC: &str = "Data: Transport Victoria (opendata.transport.vic.gov.au), \
CC BY 4.0. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_NZ_WLG: &str = "Data: Metlink, Greater Wellington Regional Council \
(opendata.metlink.org.nz), CC BY 4.0. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_NZ_AKL: &str = "Data: Auckland Transport (at.govt.nz), CC BY 4.0. \
Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_NZ: &str = "Data: Metlink (Greater Wellington Regional Council) and \
Auckland Transport open data, CC BY 4.0. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_SG: &str = "Estimated timetable from OpenStreetMap (© OpenStreetMap \
contributors, ODbL 1.0) and published frequencies; alerts: LTA DataMall (Singapore Open Data \
Licence).";
pub const ATTRIBUTION_PT: &str = "Data: Fertagus (CC BY 4.0) and Metropolitano de Lisboa \
(dados.gov.pt, CC BY). Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_JP: &str = "Data: Tokyo Metropolitan Bureau of Transportation (Toei) and \
Tosaden Traffic / 公共交通オープンデータセンター (ODPT), CC BY 4.0.";
pub const ATTRIBUTION_AU: &str = "Data: Transport for NSW and Transport Victoria open data, CC BY \
4.0. Track: © OpenStreetMap contributors, ODbL 1.0.";
pub const ATTRIBUTION_DK: &str = "Data: Rejsekort & Rejseplan A/S, via Dataudveksleren \
(Vejdirektoratet). Track: © OpenStreetMap contributors, ODbL 1.0.";
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
        CH | CH_REGIONAL => "Europe/Zurich",
        SE => "Europe/Stockholm",
        PL | PL_REGIONAL => "Europe/Warsaw",
        AT => "Europe/Vienna",
        CZ | CZ_REGIONAL => "Europe/Prague",
        IT | IT_REGIONAL | IT_LOMBARDY => "Europe/Rome",
        DK => "Europe/Copenhagen",
        HU | HU_REGIONAL => "Europe/Budapest",
        BE => "Europe/Brussels",
        c if c == DE || c.starts_with("de-") => "Europe/Berlin",
        AU_NSW => "Australia/Sydney",
        AU_VIC => "Australia/Melbourne",
        NZ_WLG | NZ_AKL => "Pacific/Auckland",
        SG => "Asia/Singapore",
        PT | PT_LIS => "Europe/Lisbon",
        JP_TYO | JP_KCH => "Asia/Tokyo",
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
        CH => "Switzerland (long distance)",
        CH_REGIONAL => "Switzerland (regional, S-Bahn)",
        SE => "Sweden",
        PL => "Poland (long distance)",
        PL_REGIONAL => "Poland (regional)",
        AT => "Austria",
        CZ => "Czechia (long distance)",
        CZ_REGIONAL => "Czechia (regional)",
        IT => "Italy (long distance)",
        IT_REGIONAL => "Italy (regional)",
        IT_LOMBARDY => "Italy (Lombardy, Trenord)",
        DK => "Denmark",
        HU => "Hungary (long distance)",
        HU_REGIONAL => "Hungary (regional)",
        DE => "Germany (long distance)",
        BE => "Belgium",
        AU_NSW => "New South Wales",
        AU_VIC => "Victoria",
        NZ_WLG => "Wellington",
        NZ_AKL => "Auckland",
        SG => "Singapore (estimated)",
        PT => "Portugal (CP)",
        PT_LIS => "Lisboa",
        JP_TYO => "Tokyo (Toei)",
        JP_KCH => "Kōchi (Tosaden)",
        DE_OTHER => "Germany (regional, cross-border)",
        c if c.starts_with("de-") => GERMAN_LANDS.iter().find(|l| l.1 == c).map_or("", |l| l.2),
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

/// Switzerland: the product is the route's `route_desc` ("IC", "IR", "RE",
/// "S"…); the route keeps its line when it has one ("S10", "IC1", "RE12"),
/// not the timetable's internal names ("IC121A", "001A"). Trains are
/// numbered (`trip_short_name`).
pub fn swiss_line(desc: &str, short: &str) -> String {
    let desc = desc.trim();
    let rest = short.trim().strip_prefix(desc).unwrap_or("");
    if !desc.is_empty()
        && !rest.is_empty()
        && rest.len() <= 2
        && rest.chars().all(|c| c.is_ascii_digit())
    {
        format!("{desc}{rest}")
    } else if desc.is_empty() {
        short.trim().to_owned()
    } else {
        desc.to_owned()
    }
}

/// Long-distance Swiss routes (and foreign ones): TGV, ICE, IC, EC, IR,
/// night trains, panorama trains. The rest (RE, R, S, rack railways,
/// specials) is the regional file.
fn swiss_long(route_type: &str) -> bool {
    matches!(
        route_type,
        "100" | "101" | "102" | "103" | "104" | "105" | "107"
    )
}

pub fn normalise_swiss(feed: &mut Feed) -> Stats {
    let mut st = Stats::default();
    for r in &mut feed.routes {
        r.short_name = swiss_line(&r.desc, &r.short_name);
    }
    for t in &mut feed.trips {
        if !t.short_name.chars().all(|c| c.is_ascii_digit()) {
            t.short_name.clear();
        }
        let r = &feed.routes[t.route];
        *st.by_product
            .entry(if r.desc.is_empty() {
                r.short_name.clone()
            } else {
                r.desc.clone()
            })
            .or_default() += 1;
    }
    st
}

pub fn split_swiss(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let code = if swiss_long(&feed.routes[t.route].route_type) {
            CH
        } else {
            CH_REGIONAL
        };
        out.entry(code.to_owned()).or_default().push(t);
    }
    out
}

/// Poland (tools/plk-gtfs.py): routes are an operator and a commercial
/// category ("IC:TLK", "PR:R"). PKP Intercity's trains and the
/// international ones are long distance; the rest regional.
const POLISH_LONG: [&str; 9] = ["EIP", "EIC", "IC", "TLK", "EC", "EN", "MP", "RJ", "NJ"];

pub fn split_poland(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let r = &feed.routes[t.route];
        let agency = r.id.split(':').next().unwrap_or("");
        let long = agency == "IC" || POLISH_LONG.contains(&r.short_name.as_str());
        out.entry(if long { PL } else { PL_REGIONAL }.to_owned())
            .or_default()
            .push(t);
    }
    out
}

/// Italy (Trenord): routes are lines ("RE11", "S5", "R7"), kept as they
/// are; Trenord's trips have no `trip_short_name`, but their ids start with
/// the train number ("10512A-…" → 10512).
pub fn normalise_italy(feed: &mut Feed) -> Stats {
    for t in &mut feed.trips {
        if !t.short_name.chars().all(|c| c.is_ascii_digit()) || t.short_name.is_empty() {
            t.short_name = t.id.chars().take_while(char::is_ascii_digit).collect();
        }
    }
    normalise_simple(feed)
}

/// Italy (tools/netex-gtfs.py --profile it): routes are Trenitalia's
/// categories. Frecce, Intercity, EuroCity and night trains are long
/// distance, as are Italo's (ITA); Regionale, Regionale Veloce and the
/// suburban services regional.
const ITALIAN_LONG: [&str; 9] = ["FR", "FA", "FB", "IC", "ICN", "EC", "EN", "EXP", "ITA"];

pub fn split_italy(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let long = ITALIAN_LONG.contains(&feed.routes[t.route].short_name.as_str());
        out.entry(if long { IT } else { IT_REGIONAL }.to_owned())
            .or_default()
            .push(t);
    }
    out
}

/// Czechia (tools/cisjr-gtfs.py): routes are an operator and a commercial
/// category ("Ceskedrahyas:R"). Fast and international trains are long
/// distance; Os, Sp, Rx and the like regional.
const CZECH_LONG: [&str; 13] = [
    "EC", "IC", "Ex", "EN", "SC", "R", "rj", "LE", "RJ", "AEx", "NJ", "ES", "TLX",
];

pub fn split_czechia(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let long = CZECH_LONG.contains(&feed.routes[t.route].short_name.as_str());
        out.entry(if long { CZ } else { CZ_REGIONAL }.to_owned())
            .or_default()
            .push(t);
    }
    out
}

/// Hungary (MÁV's GTFS): a route per train, its category and number in the
/// long name ("IC 702 NAPFÉNY", "Sz 36617", "347 DACIA - RUTHENIA"), or a
/// Budapest suburban line in the short name ("S10", "Z72", "G43", "IR85"),
/// whose trains carry no number. Named trains without a category are fast
/// trains (gyorsvonat, "Gy"), bare numbers stopping trains ("Sz").
pub fn normalise_hungary(feed: &mut Feed) -> Stats {
    let mut numbers = Vec::with_capacity(feed.routes.len());
    for r in &mut feed.routes {
        let (product, number) = hungarian_product(&r.short_name, &r.long_name);
        r.short_name = product;
        numbers.push(number);
    }
    for t in &mut feed.trips {
        t.short_name = numbers[t.route].clone();
    }
    normalise_simple(feed)
}

/// (product, train number) of one of MÁV's routes.
pub fn hungarian_product(short: &str, long: &str) -> (String, String) {
    let short = short.trim();
    if !short.is_empty() {
        return (short.to_owned(), String::new());
    }
    let mut words = long.split_whitespace();
    let Some(w) = words.next() else {
        return (String::new(), String::new());
    };
    let (category, number) = if w.chars().all(|c| c.is_ascii_digit()) {
        (None, w)
    } else {
        (Some(w), words.next().unwrap_or(""))
    };
    if !number.chars().all(|c| c.is_ascii_digit()) {
        return (category.unwrap_or("").to_owned(), String::new());
    }
    let named = words.next().is_some();
    let product = match category {
        Some(c) => c.to_owned(),
        None if named => "Gy".to_owned(),
        None => "Sz".to_owned(),
    };
    (product, number.to_owned())
}

/// InterCity, EuroCity, EuroNight, railjet xpress and fast trains are long
/// distance; stopping trains and the suburban lines regional.
const HUNGARIAN_LONG: [&str; 7] = ["IC", "ICB", "EC", "EN", "rjx", "RJX", "Gy"];

pub fn split_hungary(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let long = HUNGARIAN_LONG.contains(&feed.routes[t.route].short_name.as_str());
        out.entry(if long { HU } else { HU_REGIONAL }.to_owned())
            .or_default()
            .push(t);
    }
    out
}

/// Germany (DELFI): routes of GTFS type 101 (high speed) and 102 (long
/// distance) carry a line number ("21") or a brand ("RJ", "THA", "NJ"):
/// the product is the brand, else "ICE" or "IC"; other routes keep their
/// line ("RE1", "S3"). The train number is the trip's short name without
/// its leading zeros ("008230" → 8230).
pub fn normalise_germany(feed: &mut Feed) -> Stats {
    for r in &mut feed.routes {
        r.short_name = german_product(&r.route_type, r.short_name.trim(), r.long_name.trim());
    }
    for t in &mut feed.trips {
        t.short_name = german_number(&t.short_name);
    }
    normalise_simple(feed)
}

pub fn german_product(route_type: &str, short: &str, long: &str) -> String {
    let short = if short.is_empty() {
        long.split_whitespace().next().unwrap_or("")
    } else {
        short
    };
    let brand = !short.is_empty() && short.chars().all(|c| c.is_ascii_alphabetic());
    match route_type.trim() {
        "101" if !brand => "ICE".into(),
        "102" | "105" if !brand => "IC".into(),
        _ => short.to_owned(),
    }
}

/// The train number in a trip's short name: its last all-digit word,
/// without leading zeros.
pub fn german_number(short: &str) -> String {
    let n = short
        .split_whitespace()
        .rev()
        .find(|w| w.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or("")
        .trim_start_matches('0');
    n.to_owned()
}

/// Long-distance products: ICE, Intercity, EuroCity, the night trains,
/// FlixTrain, railjet, TGV, Eurostar and the like.
const GERMAN_LONG: [&str; 16] = [
    "ICE", "IC", "EC", "ECE", "EN", "NJ", "FLX", "RJ", "RJX", "TGV", "EST", "ES", "D", "IR", "ICN",
    "WB",
];

pub fn german_long(product: &str) -> bool {
    let first: String = product
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    GERMAN_LONG.contains(&first.to_ascii_uppercase().as_str())
}

/// The region of a German regional train from its first stop's DHID.
pub fn german_land(stop_id: &str) -> &'static str {
    let land = stop_id.strip_prefix("de:").and_then(|r| r.get(..2));
    land.and_then(|l| GERMAN_LANDS.iter().find(|x| x.0 == l))
        .map_or(DE_OTHER, |x| x.1)
}

pub fn split_germany(feed: &Feed) -> BTreeMap<String, Vec<&crate::load::Trip>> {
    let mut out: BTreeMap<String, Vec<&crate::load::Trip>> = BTreeMap::new();
    for t in &feed.trips {
        // DELFI also has trains that never enter Germany (Swiss, Czech and
        // Austrian local trains near the border): left out. The others go
        // by their first German stop.
        let Some(first_de) = t
            .stop_times
            .iter()
            .map(|s| feed.stops[s.0].id.as_str())
            .find(|id| id.starts_with("de:"))
        else {
            continue;
        };
        let r = &feed.routes[t.route];
        let code =
            if matches!(r.route_type.trim(), "101" | "102" | "105") || german_long(&r.short_name) {
                DE
            } else {
                german_land(first_de)
            };
        out.entry(code.to_owned()).or_default().push(t);
    }
    out
}

/// Sweden (GTFS Sweden 3, cut to trains): the product from the route's
/// short name, else its long name ("SJ Snabbtåg", "Pågatåg"); the train
/// number only when it is one.
pub fn normalise_sweden(feed: &mut Feed) -> Stats {
    for r in &mut feed.routes {
        if r.short_name.trim().is_empty() {
            r.short_name = r.long_name.trim().to_owned();
        }
    }
    normalise_simple(feed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn german_routes() {
        assert_eq!(german_number("ICE 123"), "123");
        assert_eq!(german_number("4711"), "4711");
        assert_eq!(german_number("008230"), "8230");
        assert_eq!(german_product("101", "21", ""), "ICE");
        assert_eq!(german_product("101", "RJ", ""), "RJ");
        assert_eq!(german_product("102", "20N", ""), "IC");
        assert_eq!(german_product("109", "S2", ""), "S2");
        assert_eq!(german_number("RE1"), "");
        assert!(
            german_long("ICE") && german_long("IC") && german_long("FLX10") && german_long("ec")
        );
        assert!(!german_long("RE1") && !german_long("S3") && !german_long("RB"));
        assert_eq!(german_land("de:05315:11201"), "de-nw");
        assert_eq!(german_land("de:02000:10950"), "de-sh");
        assert_eq!(german_land("at:49:1234"), DE_OTHER);
        assert_eq!(region_name("de-by"), "Germany (Bavaria)");
        assert_eq!(tz("de-by"), Some("Europe/Berlin"));
        assert_eq!(tz(AU_NSW), Some("Australia/Sydney"));
    }

    #[test]
    fn hungarian_routes() {
        let p = |s: &str, l: &str| {
            let (a, b) = hungarian_product(s, l);
            (a, b)
        };
        assert_eq!(p("", "IC 702 NAPFÉNY"), ("IC".into(), "702".into()));
        assert_eq!(p("", "Sz 36617 "), ("Sz".into(), "36617".into()));
        assert_eq!(p("", "rjx 19915 "), ("rjx".into(), "19915".into()));
        assert_eq!(p("", "347 DACIA - RUTHENIA"), ("Gy".into(), "347".into()));
        assert_eq!(p("", "9440 "), ("Sz".into(), "9440".into()));
        assert_eq!(p("S10", ""), ("S10".into(), String::new()));
        assert_eq!(p("", "MÁTRA"), ("MÁTRA".into(), String::new()));
        assert_eq!(p("", ""), (String::new(), String::new()));
    }

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
            desc: String::new(),
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

        // Trenord: the line kept, the train number from the trip id.
        let mut it = Feed {
            routes: vec![route("RE11")],
            trips: vec![trip(0, "10512A-2c54408d"), trip(0, "x")],
            ..Feed::default()
        };
        it.trips[0].short_name.clear();
        normalise_italy(&mut it);
        assert_eq!(it.routes[0].short_name, "RE11");
        assert_eq!(it.trips[0].short_name, "10512");
        assert_eq!(it.trips[1].short_name, "");
    }

    #[test]
    fn swiss_lines() {
        assert_eq!(swiss_line("S", "S10"), "S10");
        assert_eq!(swiss_line("IC", "IC1"), "IC1");
        assert_eq!(swiss_line("IC", "IC121A"), "IC");
        assert_eq!(swiss_line("TGV", "001A"), "TGV");
        assert_eq!(swiss_line("RE", "RE"), "RE");
        assert_eq!(swiss_line("", "E2"), "E2");
        assert!(swiss_long("102") && !swiss_long("109"));
        assert_eq!(tz(CH_REGIONAL), Some("Europe/Zurich"));
        assert_eq!(tz(PL_REGIONAL), Some("Europe/Warsaw"));
        assert_eq!(tz(CZ_REGIONAL), Some("Europe/Prague"));
        assert_eq!(tz(IT), Some("Europe/Rome"));
        assert_eq!(tz(IT_LOMBARDY), Some("Europe/Rome"));
        assert_eq!(tz(DK), Some("Europe/Copenhagen"));
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
