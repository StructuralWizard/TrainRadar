//! France (docs/europe/fr.md): SNCF's combined GTFS (TGV INOUI, OUIGO,
//! Intercités, TER, Lyria, ICE), turned into one national region and one
//! region per TER area, like Spain's AV/LD/MD and núcleos.
//!
//! SNCF's file names its product in each stop id
//! (`StopPoint:OCETGV INOUI-87686006`, or `StopArea:OCE87686006` for the
//! station), so one station has a stop per product. We key stations by
//! their 8-digit UIC code, which the live feed's stop ids also carry, and
//! read each trip's product from its first stop.

use crate::load::{Feed, Route, Stop, Trip};
use std::collections::{BTreeMap, HashMap};
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;

/// The national region: TGV INOUI, OUIGO, Intercités, Lyria and ICE.
pub const FR: &str = "fr";

/// SNCF's credit: ODbL, with transport.data.gouv.fr's special conditions
/// (docs/europe/fr.md, Licences).
pub const ATTRIBUTION_FR: &str = "Data: SNCF Voyageurs (transport.data.gouv.fr), ODbL 1.0. \
Track: © OpenStreetMap contributors, ODbL 1.0.";

/// `StopPoint:OCE<product>-<uic>` → (product, uic); `StopArea:OCE<uic>` →
/// ("", uic). Anything else comes back whole, with no product.
pub fn split_stop_id(id: &str) -> (&str, &str) {
    if let Some(rest) = id.strip_prefix("StopPoint:OCE")
        && let Some((product, uic)) = rest.rsplit_once('-')
    {
        return (product, uic);
    }
    if let Some(uic) = id.strip_prefix("StopArea:OCE") {
        return ("", uic);
    }
    ("", id)
}

/// SNCF's product as the app shows it, or `None` for coaches (`Car TER`,
/// `Car à réservation`), which aren't trains.
pub fn product_name(product: &str) -> Option<&str> {
    Some(match product {
        p if p.starts_with("Car") => return None,
        "TGV INOUI" => "TGV INOUI",
        "OUIGO" => "OUIGO",
        "INTERCITES" => "Intercités",
        "INTERCITES de nuit" => "Intercités de nuit",
        "ICE" => "ICE",
        "Lyria" => "Lyria",
        "Train TER" => "TER",
        "TramTrain" => "Tram-train",
        "Navette" => "Navette",
        "" => "Train",
        other => other,
    })
}

/// Products in the national region; everything else is regional (TER).
pub fn is_national(name: &str) -> bool {
    matches!(
        name,
        "TGV INOUI" | "OUIGO" | "Intercités" | "Intercités de nuit" | "ICE" | "Lyria"
    )
}

/// TER areas: code, name, and points that belong to it (main cities). A
/// regional trip goes to the area with a point nearest its middle stop;
/// only which file a trip lands in depends on it.
/// A TER area: region code, name, and (lat, lon) points in it.
pub type Area = (&'static str, &'static str, &'static [(f64, f64)]);

pub const TER_AREAS: &[Area] = &[
    (
        "fr-ara",
        "TER Auvergne-Rhône-Alpes",
        &[(45.76, 4.84), (45.78, 3.08), (45.19, 5.72), (45.44, 4.39)],
    ),
    (
        "fr-bfc",
        "TER Bourgogne-Franche-Comté",
        &[(47.32, 5.04), (47.24, 6.02), (46.99, 3.16)],
    ),
    (
        "fr-bre",
        "TER Bretagne",
        &[(48.11, -1.68), (48.39, -4.49), (47.66, -2.76)],
    ),
    (
        "fr-cvl",
        "TER Centre-Val de Loire",
        &[(47.90, 1.91), (47.39, 0.69), (47.08, 2.40)],
    ),
    (
        "fr-ges",
        "TER Grand Est",
        &[
            (48.58, 7.75),
            (49.12, 6.18),
            (49.26, 4.03),
            (48.69, 6.18),
            (47.75, 7.34),
        ],
    ),
    (
        "fr-hdf",
        "TER Hauts-de-France",
        &[(50.63, 3.06), (49.89, 2.30), (50.35, 3.52)],
    ),
    (
        "fr-nor",
        "TER Normandie",
        &[(49.44, 1.10), (49.18, -0.37), (49.64, -1.62)],
    ),
    (
        "fr-naq",
        "TER Nouvelle-Aquitaine",
        &[
            (44.84, -0.58),
            (45.83, 1.26),
            (46.58, 0.34),
            (43.30, -0.37),
            (46.16, -1.15),
        ],
    ),
    (
        "fr-occ",
        "TER Occitanie",
        &[(43.60, 1.44), (43.61, 3.88), (42.70, 2.90), (43.84, 4.36)],
    ),
    (
        "fr-pdl",
        "TER Pays de la Loire",
        &[(47.22, -1.55), (48.00, 0.20), (47.47, -0.55)],
    ),
    (
        "fr-pac",
        "TER Provence-Alpes-Côte d'Azur",
        &[(43.30, 5.37), (43.70, 7.27), (43.95, 4.81)],
    ),
];

/// The TER area nearest a point.
pub fn ter_area(at: LatLon) -> &'static str {
    let mut best = ("", f64::MAX);
    for (code, _, points) in TER_AREAS {
        for &(lat, lon) in *points {
            let d = haversine_m(at, LatLon::new(lat, lon));
            if d < best.1 {
                best = (code, d);
            }
        }
    }
    best.0
}

/// A region code's name (national or a TER area).
pub fn region_name(code: &str) -> String {
    if code == FR {
        return "France (TGV, Intercités)".into();
    }
    TER_AREAS
        .iter()
        .find(|a| a.0 == code)
        .map_or_else(|| code.to_owned(), |a| a.1.to_owned())
}

#[derive(Debug, Default)]
pub struct FranceStats {
    pub coaches_dropped: usize,
    pub stations: usize,
    pub by_product: BTreeMap<String, usize>,
}

/// Make a loaded SNCF feed look like the others:
/// - one stop per station, keyed by UIC code;
/// - coaches dropped;
/// - one route per line and product, named after the product;
/// - the train number (SNCF's `trip_headsign`) as the trip's short name,
///   and the last stop's name as its headsign.
pub fn normalise(feed: &mut Feed) -> FranceStats {
    let mut st = FranceStats::default();
    // Stations by UIC: the StopArea's name and place when there is one.
    let mut by_uic: HashMap<String, usize> = HashMap::new();
    let mut stops: Vec<Stop> = Vec::new();
    let mut remap = vec![0usize; feed.stops.len()];
    let mut order: Vec<usize> = (0..feed.stops.len()).collect();
    order.sort_by_key(|&i| !feed.stops[i].id.starts_with("StopArea:"));
    for i in order {
        let s = &feed.stops[i];
        let uic = split_stop_id(&s.id).1.to_owned();
        let n = *by_uic.entry(uic.clone()).or_insert_with(|| {
            stops.push(Stop {
                id: uic,
                name: tidy_name(&s.name),
                coord: s.coord,
            });
            stops.len() - 1
        });
        remap[i] = n;
    }

    let mut routes: Vec<Route> = Vec::new();
    let mut route_map: HashMap<(usize, String), usize> = HashMap::new();
    let mut trips: Vec<Trip> = Vec::with_capacity(feed.trips.len());
    for mut t in std::mem::take(&mut feed.trips) {
        let Some(&(first, _, _)) = t.stop_times.first() else {
            continue;
        };
        let raw = split_stop_id(&feed.stops[first].id).0;
        let Some(name) = product_name(raw) else {
            st.coaches_dropped += 1;
            continue;
        };
        let name = name.to_owned();
        *st.by_product.entry(name.clone()).or_default() += 1;
        let key = (t.route, name.clone());
        let r = *route_map.entry(key).or_insert_with(|| {
            let mut r = feed.routes[t.route].clone();
            r.long_name = if r.short_name.is_empty() {
                r.long_name
            } else {
                format!("{} {}", r.short_name, r.long_name)
                    .trim()
                    .to_owned()
            };
            r.short_name = name;
            routes.push(r);
            routes.len() - 1
        });
        t.route = r;
        for s in &mut t.stop_times {
            s.0 = remap[s.0];
        }
        if t.short_name.is_empty() {
            t.short_name = std::mem::take(&mut t.headsign);
        }
        if let Some(&(last, _, _)) = t.stop_times.last() {
            t.headsign.clone_from(&stops[last].name);
        }
        trips.push(t);
    }
    st.stations = stops.len();
    feed.stops = stops;
    feed.routes = routes;
    feed.trips = trips;
    st
}

/// SNCF writes some names in capitals ("FIGUERES-VILAFANT"): give those a
/// title case, with French linking words in lower case ("Paris Gare de
/// Lyon"); mixed-case names stay as they are.
pub fn tidy_name(name: &str) -> String {
    if name.chars().any(char::is_lowercase) {
        return name.to_owned();
    }
    const SMALL: &[&str] = &[
        "de", "du", "des", "la", "le", "les", "sur", "en", "et", "sous", "lès",
    ];
    let mut out = String::with_capacity(name.len());
    let mut word = String::new();
    let mut first = true;
    let flush = |word: &mut String, out: &mut String, first: &mut bool| {
        if word.is_empty() {
            return;
        }
        let lower = word.to_lowercase();
        if !*first && SMALL.contains(&lower.as_str()) {
            out.push_str(&lower);
        } else {
            let mut cs = lower.chars();
            if let Some(c) = cs.next() {
                out.extend(c.to_uppercase());
                out.push_str(cs.as_str());
            }
        }
        *first = false;
        word.clear();
    };
    for c in name.chars() {
        if c.is_alphanumeric() {
            word.push(c);
        } else {
            flush(&mut word, &mut out, &mut first);
            out.push(c);
        }
    }
    flush(&mut word, &mut out, &mut first);
    out
}

/// Region code → trips: national products in `fr`, the rest by TER area.
pub fn split(feed: &Feed) -> BTreeMap<String, Vec<&Trip>> {
    let mut out: BTreeMap<String, Vec<&Trip>> = BTreeMap::new();
    for t in &feed.trips {
        let code = if is_national(&feed.routes[t.route].short_name) {
            FR
        } else {
            let mid = t.stop_times[t.stop_times.len() / 2].0;
            ter_area(feed.stops[mid].coord)
        };
        out.entry(code.to_owned()).or_default().push(t);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_ids_split_into_product_and_uic() {
        assert_eq!(
            split_stop_id("StopPoint:OCETGV INOUI-87686006"),
            ("TGV INOUI", "87686006")
        );
        assert_eq!(
            split_stop_id("StopPoint:OCEINTERCITES de nuit-87751008"),
            ("INTERCITES de nuit", "87751008")
        );
        assert_eq!(split_stop_id("StopArea:OCE87686006"), ("", "87686006"));
        assert_eq!(split_stop_id("12345"), ("", "12345"));
    }

    #[test]
    fn coaches_are_not_trains() {
        assert_eq!(product_name("Car TER"), None);
        assert_eq!(product_name("Car à réservation"), None);
        assert_eq!(product_name("Train TER"), Some("TER"));
        assert_eq!(product_name("INTERCITES"), Some("Intercités"));
        assert!(is_national("TGV INOUI") && is_national("Lyria"));
        assert!(!is_national("TER") && !is_national("Tram-train"));
    }

    #[test]
    fn regional_trips_go_to_the_nearest_area() {
        assert_eq!(ter_area(LatLon::new(45.75, 4.83)), "fr-ara"); // Lyon
        assert_eq!(ter_area(LatLon::new(49.25, 4.03)), "fr-ges"); // Reims
        assert_eq!(ter_area(LatLon::new(43.70, 7.26)), "fr-pac"); // Nice
        assert_eq!(ter_area(LatLon::new(48.39, -4.48)), "fr-bre"); // Brest
        assert_eq!(region_name("fr-hdf"), "TER Hauts-de-France");
    }

    #[test]
    fn capitalised_names_get_a_title_case() {
        assert_eq!(tidy_name("FIGUERES-VILAFANT"), "Figueres-Vilafant");
        assert_eq!(tidy_name("PARIS GARE DE LYON"), "Paris Gare de Lyon");
        assert_eq!(tidy_name("CHALON-SUR-SAONE"), "Chalon-sur-Saone");
        assert_eq!(tidy_name("Lyon Part-Dieu"), "Lyon Part-Dieu");
    }

    #[test]
    fn normalise_merges_stations_and_drops_coaches() {
        let ll = LatLon::new(48.8, 2.3);
        let stop = |id: &str| Stop {
            id: id.into(),
            name: "Paris".into(),
            coord: ll,
        };
        let route = Route {
            id: "R".into(),
            short_name: "K12".into(),
            long_name: "Paris - Lyon".into(),
            color: None,
            text_color: None,
            route_type: "2".into(),
        };
        let trip = |id: &str, a: usize, b: usize| Trip {
            id: id.into(),
            route: 0,
            service: "1".into(),
            headsign: "6601".into(),
            short_name: String::new(),
            shape_id: String::new(),
            days: 1,
            stop_times: vec![(a, 0, 0), (b, 600, 600)],
        };
        let mut feed = Feed {
            stops: vec![
                stop("StopPoint:OCETGV INOUI-87686006"),
                stop("StopArea:OCE87686006"),
                stop("StopPoint:OCETGV INOUI-87723197"),
                stop("StopPoint:OCECar TER-87686006"),
            ],
            routes: vec![route],
            trips: vec![trip("t1", 0, 2), trip("t2", 3, 2)],
            ..Feed::default()
        };
        let st = normalise(&mut feed);
        assert_eq!(st.coaches_dropped, 1);
        assert_eq!(feed.stops.len(), 2, "one stop per UIC");
        assert_eq!(feed.trips.len(), 1);
        let t = &feed.trips[0];
        assert_eq!(t.short_name, "6601");
        assert_eq!(feed.stops[t.stop_times[0].0].id, "87686006");
        assert_eq!(feed.routes[t.route].short_name, "TGV INOUI");
        assert_eq!(feed.routes[t.route].long_name, "K12 Paris - Lyon");
        assert_eq!(split(&feed).keys().collect::<Vec<_>>(), ["fr"]);
    }
}
