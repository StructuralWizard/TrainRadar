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
/// Denmark: Rejseplanen's SIRI-ET as trip updates keyed by train number
/// (backend-eu); placed by timetable plus delay.
static DK: [FeedSpec; 1] = [feed("tu_dk", FeedKind::TripUpdates, "trip_updates.pb", 30)];
/// Germany: DB's station boards gathered into trip updates keyed by train
/// number (backend-eu); placed by timetable plus delay.
/// Belgium: SNCB's GTFS-Realtime trip updates and alerts (backend-eu).
static BE: [FeedSpec; 2] = [
    feed("tu_be", FeedKind::TripUpdates, "trip_updates.pb", 30),
    feed("alerts", FeedKind::Alerts, "alerts.pb", 300),
];
/// New South Wales: Transport for NSW's GPS, trip updates and alerts
/// (Sydney Trains, NSW TrainLink, Sydney Metro; backend-eu), trip ids the
/// timetable's.
static AU: [FeedSpec; 3] = [
    feed(
        "vp_au",
        FeedKind::VehiclePositions,
        "vehicle_positions.pb",
        15,
    ),
    feed("tu_au", FeedKind::TripUpdates, "trip_updates.pb", 30),
    feed("alerts", FeedKind::Alerts, "alerts.pb", 300),
];
static DE: [FeedSpec; 1] = [feed("tu_de", FeedKind::TripUpdates, "trip_updates.pb", 60)];
/// Czechia: PID's trains (Prague and Central Bohemia) from Golemio, GPS and
/// delays, kept to trains by backend-eu; the rest of the country by
/// timetable.
static CZ: [FeedSpec; 2] = [
    feed(
        "vp_cz",
        FeedKind::VehiclePositions,
        "vehicle_positions.pb",
        20,
    ),
    feed("tu_cz", FeedKind::TripUpdates, "trip_updates.pb", 60),
];

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
#[derive(Debug)]
pub struct Czechia;
#[derive(Debug)]
pub struct Denmark;
#[derive(Debug)]
pub struct Germany;
#[derive(Debug)]
pub struct Belgium;
#[derive(Debug)]
pub struct Australia;

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
adapter!(Denmark, "denmark", DK);
adapter!(Germany, "germany", DE);
adapter!(Belgium, "belgium", BE);
adapter!(Australia, "australia", AU);

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

impl SourceAdapter for Czechia {
    fn id(&self) -> &'static str {
        "czechia"
    }
    fn feeds(&self) -> &'static [FeedSpec] {
        &CZ
    }
    fn decode(&self, kind: FeedKind, bytes: &[u8]) -> Result<FeedData, DecodeError> {
        let mut data = crate::renfe::Renfe.decode(kind, bytes)?;
        // Golemio's vehicles are "train-9504": the national train number,
        // as CIS JŘ's timetable has it. Its trip ids are PID's own
        // ("1030_9504_260309", route_number_version), and the same train's
        // can differ between the two feeds: both are keyed by the number,
        // so a train's delay joins its GPS.
        match &mut data {
            FeedData::Vehicles(vs) => {
                for v in vs {
                    if let Some(n) = v.train_number.strip_prefix("train-") {
                        v.train_number = n.to_owned();
                    }
                    if !v.train_number.is_empty() {
                        v.trip_id = format!("cz-{}", v.train_number);
                    }
                }
            }
            FeedData::TripUpdates(us) => {
                for u in us {
                    if let Some(n) = czech_number(&u.trip_id) {
                        u.trip_id = format!("cz-{n}");
                    }
                }
            }
            _ => {}
        }
        Ok(data)
    }
}

/// The train number in a PID trip id ("1030_9504_260309" → "9504").
pub fn czech_number(trip_id: &str) -> Option<&str> {
    let n = trip_id.split('_').nth(1)?;
    (!n.is_empty() && n.chars().all(|c| c.is_ascii_digit())).then_some(n)
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
    matches!(region, "fi" | "fi-l" | "no" | "cz" | "cz-r" | "au-nsw" | "au-vic")
}

/// Regions placed by timetable plus delay only.
pub fn placed(region: &str) -> bool {
    matches!(
        region,
        "nl" | "ch" | "ch-r" | "pl" | "pl-r" | "se" | "dk" | "be"
    ) || region == "de"
        || region.starts_with("de-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_regions_have_gps() {
        assert!(mixed("fi") && mixed("fi-l") && mixed("no") && mixed("cz-r"));
        assert_eq!(Czechia.feeds()[0].key, "vp_cz");
        assert!(!mixed("nl") && placed("nl"));
        assert!(placed("ch-r") && placed("pl") && placed("se") && !placed("ee"));
        assert!(placed("de") && placed("de-by") && !placed("dk-x"));
        assert_eq!(Switzerland.feeds()[1].key, "alerts");
        assert_eq!(Norway.feeds().len(), 3);
        assert_eq!(Finland.feeds()[0].key, "vp_fi");
        assert_eq!(norwegian_number("VYG:ServiceJourney:1013_791877-R"), "1013");
        assert_eq!(
            norwegian_number("FLT:ServiceJourney:1-2614-3736-20261122"),
            "3736"
        );
    }

    #[test]
    fn czech_vehicles_carry_the_train_number() {
        use crate::gtfs_rt::*;
        use prost::Message;
        let msg = FeedMessage {
            header: None,
            entity: vec![FeedEntity {
                id: Some("2026-11-23T04:44:00Z_9504".into()),
                vehicle: Some(VehiclePosition {
                    trip: Some(TripDescriptor {
                        trip_id: Some("1003_9504_260309".into()),
                        ..Default::default()
                    }),
                    position: Some(Position {
                        latitude: 50.28,
                        longitude: 14.58,
                        ..Default::default()
                    }),
                    vehicle: Some(VehicleDescriptor {
                        id: Some("train-9504".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }],
        };
        let FeedData::Vehicles(v) = Czechia
            .decode(FeedKind::VehiclePositions, &msg.encode_to_vec())
            .unwrap()
        else {
            panic!("wrong kind");
        };
        assert_eq!(v[0].train_number, "9504");
        assert_eq!(v[0].trip_id, "cz-9504");
        assert_eq!(czech_number("1030_9504_260309"), Some("9504"));
        assert_eq!(czech_number("odd"), None);
    }
}
