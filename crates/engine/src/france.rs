//! France (SNCF, docs/europe/fr.md): SNCF's open GTFS-Realtime trip updates
//! and alerts, fetched once by our backend and served next to the others as
//! `fr/rt/trip_updates.pb` and `fr/rt/alerts.pb`. Plain GTFS-Realtime,
//! decoded like Renfe's; the trip ids are the static file's (the
//! "NewTripId" export), which the timetable keeps.

use crate::source::{DecodeError, FeedData, FeedKind, FeedSpec, SourceAdapter};

#[derive(Debug)]
pub struct France;

static FEEDS: [FeedSpec; 2] = [
    // SNCF refreshes its trip updates every two minutes; our backend
    // republishes them every minute.
    FeedSpec {
        key: "tu_fr",
        kind: FeedKind::TripUpdates,
        path: "trip_updates.pb",
        min_interval_secs: 30,
        commuter: None,
    },
    FeedSpec {
        key: "alerts",
        kind: FeedKind::Alerts,
        path: "alerts.pb",
        min_interval_secs: 120,
        commuter: None,
    },
];

impl SourceAdapter for France {
    fn id(&self) -> &'static str {
        "france"
    }

    fn feeds(&self) -> &'static [FeedSpec] {
        &FEEDS
    }

    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        let mut data = crate::renfe::Renfe.decode(kind, bytes)?;
        if let FeedData::Alerts(alerts) = &mut data {
            // SNCF writes its alerts in HTML ("<p>…</p>"), which the app
            // shows as plain text; and names stations by `StopArea:OCE<uic>`,
            // where the timetable keeps the UIC code.
            for a in alerts {
                a.header = plain_text(&a.header);
                a.description = plain_text(&a.description);
                for s in &mut a.stop_ids {
                    if let Some(uic) = s.strip_prefix("StopArea:OCE") {
                        *s = uic.to_owned();
                    } else if let Some((_, uic)) = s
                        .strip_prefix("StopPoint:OCE")
                        .and_then(|r| r.rsplit_once('-'))
                    {
                        *s = uic.to_owned();
                    }
                }
            }
        }
        Ok(data)
    }
}

/// HTML to plain text: tags dropped (a paragraph or line break becomes a
/// new line), the common entities decoded, blank lines squeezed.
pub fn plain_text(html: &str) -> String {
    if !html.contains('<') && !html.contains('&') {
        return html.to_owned();
    }
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find('>') else {
            out.push_str(&rest[i..]);
            rest = "";
            break;
        };
        let tag = rest[i + 1..i + j]
            .trim_start_matches('/')
            .to_ascii_lowercase();
        if tag.starts_with("br")
            || tag.starts_with("p")
            || tag.starts_with("li")
            || tag.starts_with("div")
        {
            out.push('\n');
        }
        rest = &rest[i + j + 1..];
    }
    out.push_str(rest);
    let out = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// SNCF's regions: the national one and the TER areas (refdata-build
/// `france::split`).
pub fn is_french_region(region: &str) -> bool {
    region == "fr" || region.starts_with("fr-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alerts_lose_their_html() {
        assert_eq!(
            plain_text(
                "<p>L'entrée est fermée jusqu'au 27-11-26.</p><p>Prévoir&nbsp;un allongement.</p>"
            ),
            "L'entrée est fermée jusqu'au 27-11-26.\nPrévoir un allongement."
        );
        assert_eq!(
            plain_text("Travaux &amp; autocars<br/>Ligne C"),
            "Travaux & autocars\nLigne C"
        );
        assert_eq!(plain_text("plain"), "plain");
    }

    #[test]
    fn regions_of_france() {
        assert!(is_french_region("fr") && is_french_region("fr-ara"));
        assert!(!is_french_region("ld") && !is_french_region("france"));
    }
}
