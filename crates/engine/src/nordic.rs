//! M2 countries (docs/europe/): Finland (Digitraffic), Norway (Entur) and
//! the Netherlands (OVapi), fetched once by our backend and served as
//! `<country>/rt/`. Plain GTFS-Realtime, decoded like Renfe's.
//!
//! Finland and Norway publish GPS for part of their trains: those are
//! drawn where they are, and every other train by its timetable plus its
//! live delay (`mixed`). The Netherlands publish delays only.

use crate::source::{DecodeError, FeedData, FeedKind, FeedSpec, SourceAdapter};

const fn feed(key: &'static str, kind: FeedKind, path: &'static str, secs: u32) -> FeedSpec {
    FeedSpec {
        key,
        kind,
        path,
        min_interval_secs: secs,
        commuter: None,
    }
}

static FI: [FeedSpec; 2] = [
    feed(
        "vp_fi",
        FeedKind::VehiclePositions,
        "vehicle_positions.pb",
        15,
    ),
    feed("tu_fi", FeedKind::TripUpdates, "trip_updates.pb", 30),
];
static NO: [FeedSpec; 3] = [
    feed(
        "vp_no",
        FeedKind::VehiclePositions,
        "vehicle_positions.pb",
        15,
    ),
    feed("tu_no", FeedKind::TripUpdates, "trip_updates.pb", 30),
    feed("alerts", FeedKind::Alerts, "alerts.pb", 120),
];
static NL: [FeedSpec; 1] = [feed("tu_nl", FeedKind::TripUpdates, "trip_updates.pb", 30)];
/// Switzerland (M3): opentransportdata.swiss's trip updates, filtered to
/// trains by our backend, and its service alerts (unplanned and planned).
static CH: [FeedSpec; 2] = [
    feed("tu_ch", FeedKind::TripUpdates, "trip_updates.pb", 30),
    feed("alerts", FeedKind::Alerts, "alerts.pb", 120),
];
/// Poland (M5): PKP PLK's live running, as trip updates (backend-eu).
/// Sweden (M3): Trafiklab's regional feeds, kept to our trains and merged
/// by backend-eu.
static SE: [FeedSpec; 1] = [feed("tu_se", FeedKind::TripUpdates, "trip_updates.pb", 60)];
static PL: [FeedSpec; 1] = [feed("tu_pl", FeedKind::TripUpdates, "trip_updates.pb", 60)];

#[derive(Debug)]
pub struct Finland;
#[derive(Debug)]
pub struct Norway;
#[derive(Debug)]
pub struct Netherlands;
#[derive(Debug)]
pub struct Switzerland;
#[derive(Debug)]
pub struct Poland;
#[derive(Debug)]
pub struct Sweden;

macro_rules! adapter {
    ($t:ty, $id:literal, $feeds:ident) => {
        impl SourceAdapter for $t {
            fn id(&self) -> &'static str {
                $id
            }
            fn feeds(&self) -> &'static [FeedSpec] {
                &$feeds
            }
            fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
                crate::renfe::Renfe.decode(kind, bytes)
            }
        }
    };
}
adapter!(Finland, "finland", FI);
adapter!(Netherlands, "netherlands", NL);
adapter!(Switzerland, "switzerland", CH);
adapter!(Poland, "poland", PL);
adapter!(Sweden, "sweden", SE);

impl SourceAdapter for Norway {
    fn id(&self) -> &'static str {
        "norway"
    }
    fn feeds(&self) -> &'static [FeedSpec] {
        &NO
    }
    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        let mut data = crate::renfe::Renfe.decode(kind, bytes)?;
        // Entur's vehicle ids are "1913-2026-11-22" or a unit ("78-08"):
        // the train number is in the trip id, as the timetable has it.
        if let FeedData::Vehicles(vs) = &mut data {
            for v in vs {
                let n = norwegian_number(&v.trip_id);
                if !n.is_empty() {
                    v.train_number = n;
                }
            }
        }
        Ok(data)
    }
}

/// Norway's train number in Entur's trip id (as refdata-build's
/// `nordic::norwegian_number`): the leading digits, or Flytoget's third part.
pub fn norwegian_number(trip_id: &str) -> String {
    let local = trip_id.rsplit(':').next().unwrap_or("");
    if trip_id.starts_with("FLT:") {
        return local.split('-').nth(2).unwrap_or("").to_owned();
    }
    let n: String = local.chars().take_while(char::is_ascii_digit).collect();
    match local[n.len()..].chars().next() {
        None | Some('_' | '-') => n,
        _ => String::new(),
    }
}

/// Regions with GPS for some trains and timetable plus delay for the rest.
pub fn mixed(region: &str) -> bool {
    matches!(region, "fi" | "fi-l" | "no")
}

/// Regions placed by timetable plus delay only.
pub fn placed(region: &str) -> bool {
    matches!(region, "nl" | "ch" | "ch-r" | "pl" | "pl-r" | "se")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_regions_have_gps() {
        assert!(mixed("fi") && mixed("fi-l") && mixed("no"));
        assert!(!mixed("nl") && placed("nl"));
        assert!(placed("ch-r") && placed("pl") && placed("se") && !placed("ee"));
        assert_eq!(Switzerland.feeds()[1].key, "alerts");
        assert_eq!(Norway.feeds().len(), 3);
        assert_eq!(Finland.feeds()[0].key, "vp_fi");
        assert_eq!(norwegian_number("VYG:ServiceJourney:1013_791877-R"), "1013");
        assert_eq!(
            norwegian_number("FLT:ServiceJourney:1-2614-3736-20261122"),
            "3736"
        );
    }
}
