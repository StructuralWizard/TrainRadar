//! Delay history (phase C3): follows every live train through its trip and
//! hands back one record per finished run, for the central recorder to store.
//!
//! - A stop's delay is the train's delay when it is first seen at or past
//!   that stop. Stops passed while we weren't watching (first sighting
//!   mid-trip) stay unknown rather than guessed.
//! - A run is finished when it reaches its last stop, when it hasn't been
//!   seen for 3 hours, or 3 hours after its (delayed) scheduled arrival.
//! - Only what Renfe publishes is recorded: timetable-only operators (no
//!   live feed) are skipped, and delays we estimated from GPS are marked.
//!
//! The state can be saved and restored (postcard) so a restart of the
//! recorder doesn't lose the runs in progress.

use crate::json;
use crate::live::{DelaySource, Live};
use crate::network::{Match, Network, train_number};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use trainradar_proto::time::civil_from_days;

/// Not seen for this long: the run is over (it left the feed).
pub const STALE_SECS: i64 = 3 * 3_600;
/// A stop counts as reached within this distance of it.
const AT_STOP_M: f64 = 300.0;
/// On a first sighting, stops up to this far behind still get the current
/// delay (the train has only just passed them).
const BEHIND_M: f64 = 2_000.0;
/// A timestamped GPS fix older than this is not recorded.
pub const MAX_FIX_AGE_SECS: i64 = 600;
/// Finished runs are remembered this many days so a train still listed at
/// its terminus doesn't start a second record.
const DONE_KEEP_DAYS: i64 = 2;
/// Version of the saved state; a mismatch starts from scratch.
const STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StopObs {
    pub id: String,
    /// Scheduled arrival, unix seconds.
    pub sched: i64,
    /// Delay in seconds when the train reached the stop.
    pub delay: Option<i32>,
    /// From our GPS estimate rather than Renfe's trip update.
    pub estimated: bool,
}

/// One run of a trip on a service day, as far as we've seen it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub day: i64,
    pub trip_id: String,
    pub train_no: String,
    pub line: String,
    pub product: String,
    pub origin_id: String,
    pub dest_id: String,
    pub sched_dep: i64,
    pub sched_arr: i64,
    pub stops: Vec<StopObs>,
    pub max_delay: Option<i32>,
    pub last_delay: Option<i32>,
    pub cancelled: bool,
    /// Renfe gave a trip-update delay at least once.
    pub trip_update: bool,
    pub last_seen: i64,
    /// Furthest point reached (metres along the trip).
    pub along: Option<f64>,
}

impl Run {
    fn reached_end(&self) -> bool {
        self.stops.last().is_some_and(|s| s.delay.is_some())
    }

    fn finished(&self, now: i64) -> bool {
        let late = i64::from(self.last_delay.unwrap_or(0).max(0));
        self.reached_end()
            || now - self.last_seen >= STALE_SECS
            || now > self.sched_arr + late + STALE_SECS
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Recorder {
    version: u32,
    runs: BTreeMap<String, Run>,
    /// Finished run key → service day, to ignore later sightings.
    done: BTreeMap<String, i64>,
}

fn minutes(secs: i32) -> i32 {
    (f64::from(secs) / 60.0).round() as i32
}

/// "YYYY-MM-DD" of a day number.
pub fn date(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Line and product of a trip, as the history groups them: Cercanías by
/// núcleo and line (`"10-C5"`, product `"CERCANIAS"`); other trains by the
/// pair of terminal stop ids (either direction) and Renfe's product name
/// (`"60000-71801"`, `"AVE"`).
pub fn line_product(net: &Network, m: Match) -> (String, String) {
    let r = &net.regions[m.trip.region as usize];
    let trip = net.trip(m.trip);
    let name = r.tt.routes[trip.route as usize]
        .short_name
        .trim()
        .to_owned();
    if r.tt.region != "ld" {
        return (format!("{}-{}", r.tt.region, name), "CERCANIAS".into());
    }
    let p = &r.tt.patterns[trip.pattern as usize];
    let id = |i: usize| r.tt.stops[p.stops[i] as usize].id.clone();
    let (a, b) = (id(0), id(p.stops.len() - 1));
    let (a, b) = if a <= b { (a, b) } else { (b, a) };
    (format!("{a}-{b}"), name.to_uppercase())
}

fn new_run(net: &Network, m: Match) -> Run {
    let r = &net.regions[m.trip.region as usize];
    let trip = net.trip(m.trip);
    let p = &r.tt.patterns[trip.pattern as usize];
    let st = net.schedule(m.trip);
    let stops: Vec<StopObs> = p
        .stops
        .iter()
        .zip(st)
        .map(|(&s, t)| StopObs {
            id: r.tt.stops[s as usize].id.clone(),
            sched: m.start_utc + i64::from(t.arrival),
            delay: None,
            estimated: false,
        })
        .collect();
    let (line, product) = line_product(net, m);
    Run {
        day: m.day,
        trip_id: r.tt.trip_id(trip),
        train_no: train_number(trip),
        line,
        product,
        origin_id: stops.first().map(|s| s.id.clone()).unwrap_or_default(),
        dest_id: stops.last().map(|s| s.id.clone()).unwrap_or_default(),
        sched_dep: m.start_utc + st.first().map_or(0, |s| i64::from(s.departure)),
        sched_arr: stops.last().map_or(m.start_utc, |s| s.sched),
        stops,
        max_delay: None,
        last_delay: None,
        cancelled: false,
        trip_update: false,
        last_seen: 0,
        along: None,
    }
}

fn run_key(net: &Network, m: Match) -> String {
    let r = &net.regions[m.trip.region as usize];
    format!("{}|{}", m.day, r.tt.trip_id(net.trip(m.trip)))
}

impl Default for Recorder {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            runs: BTreeMap::new(),
            done: BTreeMap::new(),
        }
    }
}

impl Recorder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Runs in progress.
    pub fn active(&self) -> usize {
        self.runs.len()
    }

    /// Take in the current live state; returns the runs that just finished.
    pub fn observe(&mut self, net: &Network, live: &Live, now: i64) -> Vec<Run> {
        for t in &live.trains {
            if t.scheduled {
                continue; // no live data: nothing to record
            }
            let Some(m) = t.matched else { continue };
            if t.rt.timestamp.is_some_and(|ts| now - ts > MAX_FIX_AGE_SECS) {
                continue;
            }
            let key = run_key(net, m);
            if self.done.contains_key(&key) {
                continue;
            }
            let run = self.runs.entry(key).or_insert_with(|| new_run(net, m));
            run.last_seen = now;
            run.cancelled |= t.canceled;
            let Some(delay) = t.delay else { continue };
            let estimated = t.delay_source != Some(DelaySource::TripUpdate);
            run.trip_update |= !estimated;
            run.last_delay = Some(delay);
            run.max_delay = Some(run.max_delay.map_or(delay, |d| d.max(delay)));
            let Some(fd) = t.fix_along else { continue };
            let from = run.along.unwrap_or(fd) - BEHIND_M;
            let st = net.schedule(m.trip);
            for (s, t) in run.stops.iter_mut().zip(st) {
                let d = f64::from(t.dist_m);
                if s.delay.is_none() && d <= fd + AT_STOP_M && d >= from {
                    s.delay = Some(delay);
                    s.estimated = estimated;
                }
            }
            run.along = Some(run.along.map_or(fd, |a| a.max(fd)));
        }
        // Cancelled trips Renfe lists without a vehicle.
        for m in live.canceled_trips(net, now) {
            let key = run_key(net, m);
            if self.done.contains_key(&key) {
                continue;
            }
            let run = self.runs.entry(key).or_insert_with(|| new_run(net, m));
            run.cancelled = true;
            run.last_seen = now;
        }

        let today = trainradar_proto::time::madrid_day(now);
        self.done.retain(|_, d| *d >= today - DONE_KEEP_DAYS);
        let keys: Vec<String> = self
            .runs
            .iter()
            .filter(|(_, r)| r.finished(now))
            .map(|(k, _)| k.clone())
            .collect();
        let mut out = Vec::with_capacity(keys.len());
        for k in keys {
            if let Some(r) = self.runs.remove(&k) {
                self.done.insert(k, r.day);
                out.push(r);
            }
        }
        out
    }

    /// Finish every run in progress (for tests and shutdown).
    pub fn drain(&mut self) -> Vec<Run> {
        std::mem::take(&mut self.runs).into_values().collect()
    }

    pub fn save(&self) -> Vec<u8> {
        postcard::to_allocvec(self).unwrap_or_default()
    }

    /// Restore saved state; an unreadable or older format starts empty.
    pub fn load(bytes: &[u8]) -> Self {
        match postcard::from_bytes::<Recorder>(bytes) {
            Ok(r) if r.version == STATE_VERSION => r,
            _ => Self::new(),
        }
    }
}

/// One finished run as a JSON object with the columns of the `trips` table.
pub fn run_json(out: &mut String, r: &Run) {
    let mut stops = String::from("[");
    for (i, s) in r.stops.iter().enumerate() {
        if i > 0 {
            stops.push(',');
        }
        stops.push('[');
        json::str(&mut stops, &s.id);
        let d = s
            .delay
            .map_or("null".to_owned(), |d| minutes(d).to_string());
        stops.push_str(&format!(",{},{},{}]", s.sched, d, u8::from(s.estimated)));
    }
    stops.push(']');
    // Arrival delay: at the last stop if we saw it get there, else unknown.
    let arr = r.stops.last().and_then(|s| s.delay).map(minutes);
    json::Obj::new(out)
        .s("service_date", &date(r.day))
        .s("trip_id", &r.trip_id)
        .s("train_no", &r.train_no)
        .s("line", &r.line)
        .s("product", &r.product)
        .s("origin_id", &r.origin_id)
        .s("dest_id", &r.dest_id)
        .n("sched_dep", r.sched_dep)
        .n("sched_arr", r.sched_arr)
        .on("arr_delay_min", arr)
        .on("max_delay_min", r.max_delay.map(minutes))
        .on("last_delay_min", r.last_delay.map(minutes))
        .n("cancelled", u8::from(r.cancelled))
        .s("stops_json", &stops)
        .s(
            "source_quality",
            if r.trip_update {
                "renfe_tu"
            } else {
                "gps_estimate"
            },
        )
        .end();
}

/// JSON array of finished runs.
pub fn runs_json(runs: &[Run]) -> String {
    let mut s = String::from("[");
    for (i, r) in runs.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        run_json(&mut s, r);
    }
    s.push(']');
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::Live;
    use crate::network::tests::{local, sample_network};
    use crate::source::{FeedData, RtTripUpdate, RtVehicle};

    fn vehicle(lat: f64, ts: i64) -> RtVehicle {
        RtVehicle {
            trip_id: "1004D100C3".into(),
            train_number: "100".into(),
            line: "C3".into(),
            platform: None,
            lat,
            lon: -3.70,
            bearing: None,
            speed: None,
            timestamp: Some(ts),
            stop_id: None,
            status: None,
        }
    }

    fn see(live: &mut Live, net: &Network, lat: f64, t: i64) {
        live.ingest(net, "vp_cer", FeedData::Vehicles(vec![vehicle(lat, t)]), t);
    }

    #[test]
    fn follows_a_run_stop_by_stop_and_finishes_at_the_end() {
        let net = sample_network();
        let mut live = Live::default();
        let mut rec = Recorder::new();
        // At A on time, leaving B 2 min late, at C 3 min late (A 08:00, B
        // 08:10–08:11, C 08:21). At a stop the GPS estimate counts against
        // the departure time.
        see(&mut live, &net, 40.40, local(8, 0));
        assert!(rec.observe(&net, &live, local(8, 0)).is_empty());
        see(&mut live, &net, 40.30, local(8, 13));
        assert!(rec.observe(&net, &live, local(8, 13)).is_empty());
        assert_eq!(rec.active(), 1);
        see(&mut live, &net, 40.20, local(8, 24));
        let done = rec.observe(&net, &live, local(8, 24));
        assert_eq!(done.len(), 1, "finished at the last stop");
        let r = &done[0];
        assert_eq!(r.trip_id, "1004D100C3");
        assert_eq!(r.line, "10-C3");
        assert_eq!(r.product, "CERCANIAS");
        assert_eq!((r.origin_id.as_str(), r.dest_id.as_str()), ("A", "C"));
        let d: Vec<Option<i32>> = r.stops.iter().map(|s| s.delay.map(minutes)).collect();
        assert_eq!(d, [Some(0), Some(2), Some(3)]);
        assert!(r.stops.iter().all(|s| s.estimated), "GPS estimates");
        assert_eq!(r.max_delay.map(minutes), Some(3));

        // Still listed at the terminus: no second record.
        see(&mut live, &net, 40.20, local(8, 25));
        assert!(rec.observe(&net, &live, local(8, 25)).is_empty());
        assert_eq!(rec.active(), 0);

        let mut s = String::new();
        run_json(&mut s, r);
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["service_date"], "2026-11-01");
        assert_eq!(v["arr_delay_min"], 3);
        assert_eq!(v["source_quality"], "gps_estimate");
        let stops: serde_json::Value =
            serde_json::from_str(v["stops_json"].as_str().unwrap()).unwrap();
        assert_eq!(stops[1], serde_json::json!(["B", local(8, 10), 2, 1]));
    }

    #[test]
    fn first_seen_mid_trip_leaves_earlier_stops_unknown_and_goes_stale() {
        let net = sample_network();
        let mut live = Live::default();
        let mut rec = Recorder::new();
        // First seen just after B: A stays unknown, B gets the delay.
        see(&mut live, &net, 40.295, local(8, 12));
        rec.observe(&net, &live, local(8, 12));
        // Then vanishes from the feed.
        live.ingest(&net, "vp_cer", FeedData::Vehicles(vec![]), local(8, 13));
        assert!(rec.observe(&net, &live, local(10, 0)).is_empty());
        let done = rec.observe(&net, &live, local(11, 13));
        assert_eq!(done.len(), 1, "3 h unseen");
        let r = &done[0];
        assert_eq!(r.stops[0].delay, None);
        assert!(r.stops[1].delay.is_some());
        assert_eq!(r.stops[2].delay, None);
        let mut s = String::new();
        run_json(&mut s, r);
        assert!(s.contains("\"arr_delay_min\":null"), "{s}");
    }

    #[test]
    fn trip_update_delays_and_cancellations() {
        let net = sample_network();
        let mut live = Live::default();
        let mut rec = Recorder::new();
        let now = local(8, 1);
        let tu = |id: &str, delay, canceled| RtTripUpdate {
            trip_id: id.into(),
            delay,
            canceled,
            accessible: None,
            stops: vec![],
        };
        live.ingest(
            &net,
            "tu_cer",
            FeedData::TripUpdates(vec![
                tu("1004D100C3", Some(240), false),
                tu("1004D102C3", None, true),
            ]),
            now,
        );
        see(&mut live, &net, 40.40, now);
        rec.observe(&net, &live, now);
        assert_eq!(rec.active(), 2);
        let mut runs = rec.drain();
        runs.sort_by(|a, b| a.trip_id.cmp(&b.trip_id));
        assert!(runs[0].trip_update && !runs[0].stops[0].estimated);
        assert_eq!(runs[0].stops[0].delay, Some(240));
        assert!(runs[1].cancelled, "listed as cancelled without a vehicle");
        let json = runs_json(&runs);
        assert!(json.contains("\"source_quality\":\"renfe_tu\""));
        assert!(json.contains("\"cancelled\":1"));
    }

    #[test]
    fn stale_fixes_and_timetable_only_trains_are_not_recorded() {
        let net = sample_network();
        let mut live = Live::default();
        let mut rec = Recorder::new();
        see(&mut live, &net, 40.40, local(8, 0));
        rec.observe(&net, &live, local(8, 11));
        assert_eq!(rec.active(), 0, "fix 11 min old");
    }

    #[test]
    fn state_survives_save_and_load() {
        let net = sample_network();
        let mut live = Live::default();
        let mut rec = Recorder::new();
        see(&mut live, &net, 40.40, local(8, 0));
        rec.observe(&net, &live, local(8, 0));
        let bytes = rec.save();
        let back = Recorder::load(&bytes);
        assert_eq!(back.active(), 1);
        assert_eq!(back.runs, rec.runs);
        assert_eq!(Recorder::load(b"garbage").active(), 0);
    }
}
