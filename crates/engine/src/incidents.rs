//! Renfe incidents (GTFS-RT alerts), resolved to lines and stations.
//!
//! Renfe's alerts name Cercanías routes (`10T0011C4`) and sometimes stops;
//! the text is in the description, led by tags such as `#MadC4b`. Many
//! alerts have no end date, so the UI shows each one's start date and the
//! feed's age rather than trusting "active".

use crate::network::Network;
use trainradar_proto::{Incident, LatLon};

/// An incident ready for display.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved<'a> {
    pub incident: &'a Incident,
    /// Text without the leading tags.
    pub text: String,
    /// Tags from the start of the text, without `#` (e.g. `MadC4b`).
    pub tags: Vec<String>,
    /// Line names (e.g. `C4`), sorted and unique.
    pub lines: Vec<String>,
    /// Cercanías núcleo codes of the routes named.
    pub nucleos: Vec<String>,
    /// Stations named, with coordinates when known.
    pub stops: Vec<(String, String, Option<LatLon>)>,
    /// What kind of notice it is, guessed from its text.
    pub kind: Kind,
}

/// Kind of a Renfe notice. Renfe's alerts don't fill GTFS-RT's cause and
/// effect, so it's read from the Spanish text; the first match in this
/// order wins (a strike or works notice usually also describes changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Huelga, servicios mínimos.
    Strike = 1,
    /// Lifts, escalators, step-free access.
    Accessibility = 2,
    /// Obras, trabajos, mantenimiento.
    Works = 4,
    /// Incidencias, retrasos, supresiones, cortes, autobuses.
    Disruption = 8,
    /// Anything else: timetable changes, information.
    Other = 16,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Strike => "strike",
            Kind::Accessibility => "accessibility",
            Kind::Works => "works",
            Kind::Disruption => "disruption",
            Kind::Other => "other",
        }
    }
}

/// Guess a notice's kind from its header and description.
pub fn kind_of(text: &str) -> Kind {
    let t = text.to_lowercase();
    let any = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if any(&[
        "huelga",
        "servicios mínimos",
        "servicios minimos",
        "paros parciales",
    ]) {
        Kind::Strike
    } else if any(&[
        "ascensor",
        "escalera mecánica",
        "escaleras mecánicas",
        "escalera mecanica",
        "accesib",
        "movilidad reducida",
        "rampa",
    ]) {
        Kind::Accessibility
    } else if any(&[
        "obra",
        "trabajos",
        "mantenimiento",
        "renovación",
        "renovacion",
        "mejora de",
    ]) {
        Kind::Works
    } else if any(&[
        "incidencia",
        "retras",
        "suprim",
        "cancel",
        "alteraci",
        "interrump",
        "avería",
        "averia",
        "no efectúa",
        "no efectuará",
        "sin servicio",
        "corte",
        "transbordo",
        "autobús",
        "autobuses",
        "por carretera",
    ]) {
        Kind::Disruption
    } else {
        Kind::Other
    }
}

/// `10T0011C4` → (`10`, `C4`). Renfe Cercanías route ids are núcleo digits,
/// `T`, four digits, then the line name.
pub fn split_route_id(id: &str) -> Option<(&str, &str)> {
    let n = id.bytes().take_while(u8::is_ascii_digit).count();
    let rest = id[n..].strip_prefix('T')?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let line = &rest[digits..];
    (n > 0 && digits > 0 && !line.is_empty()).then(|| (&id[..n], line))
}

/// Split leading `#tags` off a text.
pub fn split_tags(text: &str) -> (Vec<String>, String) {
    let mut tags = Vec::new();
    let mut rest = text.trim_start();
    while let Some(t) = rest.strip_prefix('#') {
        let end = t.find(char::is_whitespace).unwrap_or(t.len());
        if end > 0 {
            tags.push(t[..end].trim_end_matches([',', '.', ':']).to_owned());
        }
        rest = t[end..].trim_start();
    }
    (tags, rest.to_owned())
}

pub fn is_active(i: &Incident, now: i64) -> bool {
    i.active_from.is_none_or(|f| f <= now) && i.active_until.is_none_or(|u| u >= now)
}

pub fn resolve<'a>(net: &Network, i: &'a Incident) -> Resolved<'a> {
    let body = if i.header.trim().is_empty() {
        i.description.clone()
    } else if i.description.trim().is_empty() {
        i.header.clone()
    } else {
        format!("{}\n{}", i.header.trim(), i.description.trim())
    };
    let (tags, text) = split_tags(&body);
    let mut lines = Vec::new();
    let mut nucleos = Vec::new();
    for r in &i.route_ids {
        if let Some((n, l)) = split_route_id(r) {
            lines.push(l.to_owned());
            nucleos.push(n.to_owned());
        }
    }
    for v in [&mut lines, &mut nucleos] {
        v.sort();
        v.dedup();
    }
    let stops = i
        .stop_ids
        .iter()
        .map(|id| {
            let st = net
                .stations
                .as_ref()
                .and_then(|f| f.stations.iter().find(|s| &s.id == id));
            (
                id.clone(),
                st.map_or_else(|| id.clone(), |s| s.name.clone()),
                st.map(|s| s.coord()),
            )
        })
        .collect();
    let kind = kind_of(&text);
    Resolved {
        incident: i,
        kind,
        text,
        tags,
        lines,
        nucleos,
        stops,
    }
}

/// Active incidents, newest first.
pub fn active<'a>(net: &Network, all: &'a [Incident], now: i64) -> Vec<Resolved<'a>> {
    let mut v: Vec<_> = all
        .iter()
        .filter(|i| is_active(i, now))
        .map(|i| resolve(net, i))
        .collect();
    v.sort_by_key(|r| std::cmp::Reverse(r.incident.active_from.unwrap_or(0)));
    v
}

/// Incidents naming a route (for a train's popup).
pub fn for_route<'a>(all: &'a [Incident], route_id: &str, now: i64) -> Vec<&'a Incident> {
    all.iter()
        .filter(|i| is_active(i, now) && i.route_ids.iter().any(|r| r == route_id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inc(
        id: &str,
        from: Option<i64>,
        until: Option<i64>,
        routes: &[&str],
        stops: &[&str],
        text: &str,
    ) -> Incident {
        Incident {
            id: id.into(),
            header: String::new(),
            description: text.into(),
            active_from: from,
            active_until: until,
            route_ids: routes.iter().map(|s| (*s).into()).collect(),
            stop_ids: stops.iter().map(|s| (*s).into()).collect(),
        }
    }

    #[test]
    fn kinds_from_text() {
        assert_eq!(
            kind_of("Huelga convocada: servicios mínimos del 60 %"),
            Kind::Strike
        );
        assert_eq!(
            kind_of("Ascensor fuera de servicio en el andén 2"),
            Kind::Accessibility
        );
        assert_eq!(
            kind_of("Por obras en la estación de Pinto, los trenes no efectúan parada"),
            Kind::Works
        );
        assert_eq!(
            kind_of("Retrasos por incidencia en la infraestructura"),
            Kind::Disruption
        );
        assert_eq!(kind_of("Nuevos horarios a partir del lunes"), Kind::Other);
    }

    #[test]
    fn route_ids_and_tags() {
        assert_eq!(split_route_id("10T0011C4"), Some(("10", "C4")));
        assert_eq!(split_route_id("51T0001R1"), Some(("51", "R1")));
        assert_eq!(split_route_id("1700037606GL023"), None);
        let (tags, text) = split_tags("#MadC3 #MadC4, Los trenes recuperan sus frecuencias.");
        assert_eq!(tags, ["MadC3", "MadC4"]);
        assert_eq!(text, "Los trenes recuperan sus frecuencias.");
        assert_eq!(split_tags("Sin etiquetas").0.len(), 0);
    }

    #[test]
    fn resolves_lines_and_filters_active() {
        let net = Network::default();
        let all = vec![
            inc("old", Some(10), Some(20), &[], &[], "#X ended"),
            inc(
                "a",
                Some(100),
                None,
                &["10T0011C4", "10T0068C4", "10T0099C3"],
                &["17000"],
                "#MadC4b Reajuste",
            ),
            inc("b", Some(200), None, &[], &[], "newer"),
        ];
        let v = active(&net, &all, 300);
        assert_eq!(
            v.iter().map(|r| r.incident.id.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
        let a = &v[1];
        assert_eq!(a.lines, ["C3", "C4"]);
        assert_eq!(a.nucleos, ["10"]);
        assert_eq!(a.tags, ["MadC4b"]);
        assert_eq!(a.text, "Reajuste");
        assert_eq!(a.stops[0].1, "17000", "unknown station keeps its id");
        assert_eq!(for_route(&all, "10T0099C3", 300).len(), 1);
        assert!(for_route(&all, "10T0099C3", 50).is_empty());
    }
}
