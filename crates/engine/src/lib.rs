//! TrainRadar engine, compiled to WebAssembly and run in the browser.
//!
//! The web app fetches feeds (through the CORS pass-through Worker) and
//! reference files, hands the bytes to [`Engine`], and asks it for positions
//! to draw each frame. Everything (decoding, matching, delays,
//! interpolation, spacing, stats) happens here, in the browser.

pub mod gtfs_rt;
pub mod incidents;
mod json;
pub mod live;
pub mod network;
pub mod onboard;
pub mod places;
pub mod poll;
pub mod renfe;
pub mod schedule;
pub mod source;
pub mod spacing;
pub mod stats;

use live::{DelaySource, Live, TrainView};
use network::Network;
use source::SourceAdapter;
use trainradar_proto::{Delay, DelayClass, PositionSource};
use wasm_bindgen::prelude::*;

/// Engine version, for the "about" panel and cache busting.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Map colour band for a delay in seconds: 0 = on time / <5 min,
/// 1 = 5–14 min, 2 = 15+ min.
#[wasm_bindgen(js_name = delayClass)]
pub fn delay_class(delay_secs: i32) -> u8 {
    class_code(Some(Delay(delay_secs)))
}

fn class_code(d: Option<Delay>) -> u8 {
    match d.map(Delay::class) {
        Some(DelayClass::OnTime) => 0,
        Some(DelayClass::Minor) => 1,
        Some(DelayClass::Major) => 2,
        None => 3,
    }
}

fn flags(v: &TrainView, t: &live::LiveTrain) -> u32 {
    let mut f = 0;
    if t.feed == "vp_cer" {
        f |= FLAG_COMMUTER;
    }
    if let Some(s) = v.stopped {
        f |= FLAG_STOPPED;
        if !s.confirmed {
            f |= FLAG_STOPPED_LIKELY;
        }
    }
    if v.source == PositionSource::Scheduled {
        f |= FLAG_SCHEDULED_ONLY;
    }
    f
}

fn secs(now_ms: f64) -> i64 {
    (now_ms / 1000.0).floor() as i64
}

/// Values per train in [`Engine::positions`].
pub const POSITION_STRIDE: usize = 6;

/// Bits of the flags value in [`Engine::positions`].
pub const FLAG_STOPPED: u32 = 1;
pub const FLAG_STOPPED_LIKELY: u32 = 2;
pub const FLAG_SCHEDULED_ONLY: u32 = 4;
pub const FLAG_COMMUTER: u32 = 8;

/// Everything the browser needs, behind one handle.
#[wasm_bindgen]
#[derive(Debug, Default)]
pub struct Engine {
    net: Network,
    live: Live,
    onboard: onboard::Onboard,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Load `stations.<hash>.bin`. Returns the number of stations.
    #[wasm_bindgen(js_name = loadStations)]
    pub fn load_stations(&mut self, bytes: &[u8]) -> Result<u32, JsError> {
        Ok(self.net.load_stations(bytes)? as u32)
    }

    /// Load a `tt-<region>.<hash>.bin`. Returns the region code.
    #[wasm_bindgen(js_name = loadTimetable)]
    pub fn load_timetable(&mut self, bytes: &[u8], now_ms: f64) -> Result<String, JsError> {
        let code = self.net.load_timetable(bytes)?;
        self.live.rebuild(&self.net, secs(now_ms));
        Ok(code)
    }

    /// Load a `geo-<region>.<hash>.bin` (track geometry). Returns the region
    /// code. Call after that region's timetable; trains redraw on track.
    #[wasm_bindgen(js_name = loadGeometry)]
    pub fn load_geometry(&mut self, bytes: &[u8]) -> Result<String, JsError> {
        Ok(self.net.load_geometry(bytes)?)
    }

    /// Feeds to poll, as JSON: `[{key, path, interval, commuter}]`.
    #[wasm_bindgen(js_name = feedsJson)]
    pub fn feeds_json(&self) -> String {
        let mut s = String::from("[");
        for (i, f) in renfe::Renfe.feeds().iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            json::Obj::new(&mut s)
                .s("key", f.key)
                .s("path", f.path)
                .n("interval", f.min_interval_secs)
                .on("commuter", f.commuter)
                .end();
        }
        s.push(']');
        s
    }

    /// Decode and apply one feed fetch. Returns the number of records.
    pub fn ingest(&mut self, key: &str, bytes: &[u8], now_ms: f64) -> Result<u32, JsError> {
        let spec = renfe::Renfe
            .feeds()
            .iter()
            .find(|f| f.key == key)
            .ok_or_else(|| JsError::new(&format!("unknown feed {key}")))?;
        let data = renfe::Renfe.decode(spec.kind, bytes)?;
        let n = match &data {
            source::FeedData::Vehicles(v) => v.len(),
            source::FeedData::TripUpdates(u) => u.len(),
            source::FeedData::Alerts(a) => a.len(),
        };
        self.live.ingest(&self.net, spec.key, data, secs(now_ms));
        Ok(n as u32)
    }

    /// Flat array for drawing, [`POSITION_STRIDE`] numbers per train:
    /// lon, lat, delay class (0–2, 3 = unknown), bearing (NaN if unknown),
    /// GPS fix age in seconds, flags (1 stopped between stations, 2 only
    /// likely, 4 position from the timetable only, 8 Cercanías).
    pub fn positions(&self, now_ms: f64) -> Vec<f64> {
        let views = self.live.views(&self.net, secs(now_ms), false);
        let mut out = Vec::with_capacity(views.len() * POSITION_STRIDE);
        for v in &views {
            out.extend([
                v.coord.lon,
                v.coord.lat,
                f64::from(class_code(v.delay)),
                v.bearing.map_or(f64::NAN, f64::from),
                v.fix_age_secs as f64,
                f64::from(flags(v, &self.live.trains[v.index])),
            ]);
        }
        out
    }

    /// Details for the popup of train `index` (as in `positions`), as JSON.
    #[wasm_bindgen(js_name = trainJson)]
    pub fn train_json(&self, index: usize, now_ms: f64) -> String {
        let now = secs(now_ms);
        let views = self.live.views(&self.net, now, false);
        let Some(v) = views.get(index) else {
            return "null".into();
        };
        let (ahead, behind) = spacing::for_train(&self.net, &self.live.trains, &views, index, now);
        let mut v = v.clone();
        v.ahead = ahead;
        v.behind = behind;
        self.view_json(&v)
    }

    /// Stats bar: `{trains, delayed, median_delay}`.
    #[wasm_bindgen(js_name = statsJson)]
    pub fn stats_json(&self, now_ms: f64) -> String {
        let views = self.live.views(&self.net, secs(now_ms), false);
        let live = views
            .iter()
            .filter(|v| v.source != PositionSource::Scheduled);
        let s = stats::compute(live.map(|v| v.delay));
        let scheduled = views.len() - s.trains;
        let mut out = String::new();
        json::Obj::new(&mut out)
            .n("trains", s.trains)
            .n("scheduled", scheduled)
            .n("delayed", s.delayed)
            .on("median_delay", s.median_delay)
            .end();
        out
    }

    /// Most delayed trains (5+ min), worst first, as a JSON array.
    #[wasm_bindgen(js_name = delayedJson)]
    pub fn delayed_json(&self, now_ms: f64, limit: usize) -> String {
        let views = self.live.views(&self.net, secs(now_ms), false);
        let mut late: Vec<&TrainView> = views
            .iter()
            .filter(|v| v.delay.is_some_and(|d| d.class() != DelayClass::OnTime))
            .collect();
        late.sort_by_key(|v| std::cmp::Reverse(v.delay));
        let mut s = String::from("[");
        for (i, v) in late.into_iter().take(limit).enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push_str(&self.view_json(v));
        }
        s.push(']');
        s
    }

    /// All stations as a GeoJSON FeatureCollection (name, id, services bitmask:
    /// 1 = AV/LD/MD, 2 = Cercanías), for the map's station layer.
    #[wasm_bindgen(js_name = stationsGeoJson)]
    pub fn stations_geojson(&self) -> String {
        let mut s = String::from(r#"{"type":"FeatureCollection","features":["#);
        for (i, st) in self
            .net
            .stations
            .iter()
            .flat_map(|f| &f.stations)
            .enumerate()
        {
            if i > 0 {
                s.push(',');
            }
            let c = st.coord();
            s.push_str(r#"{"type":"Feature","geometry":{"type":"Point","coordinates":["#);
            s.push_str(&format!("{:.5},{:.5}]}},\"properties\":", c.lon, c.lat));
            json::Obj::new(&mut s)
                .s("id", &st.id)
                .s("name", &st.name)
                .n("services", st.services)
                .end();
            s.push('}');
        }
        s.push_str("]}");
        s
    }

    /// Current index of a train (as in `positions`) by trip id and number,
    /// or -1. Indexes can shift when feeds update; popups use this to follow
    /// the same train.
    #[wasm_bindgen(js_name = findTrain)]
    pub fn find_train(&self, trip_id: &str, number: &str) -> i32 {
        self.live
            .trains
            .iter()
            .position(|t| t.rt.trip_id == trip_id && t.rt.train_number == number)
            .map_or(-1, |i| i as i32)
    }

    /// Route of train `index` for highlighting: `{line: [[lon, lat]…],
    /// stops: [{name, lon, lat, time}], same_line: [indexes]}`. `time` is the
    /// expected arrival (schedule + current delay). `null` if unmatched.
    #[wasm_bindgen(js_name = tripJson)]
    pub fn trip_json(&self, index: usize) -> String {
        let Some(t) = self.live.trains.get(index) else {
            return "null".into();
        };
        let Some(m) = t.matched else {
            return "null".into();
        };
        let delay = i64::from(t.delay.unwrap_or(0));
        let coords: Vec<String> = self
            .net
            .trip_line(m.trip)
            .iter()
            .map(|p| format!("[{:.5},{:.5}]", p.lon, p.lat))
            .collect();
        let mut stops = String::from("[");
        for (i, (name, c, arr)) in self.net.trip_stops(m.trip).iter().enumerate() {
            if i > 0 {
                stops.push(',');
            }
            json::Obj::new(&mut stops)
                .s("name", name)
                .n("lon", format!("{:.5}", c.lon))
                .n("lat", format!("{:.5}", c.lat))
                .n("time", m.start_utc + i64::from(*arr) + delay)
                .end();
        }
        stops.push(']');
        let key = self.net.line_key(m.trip);
        let same: Vec<String> = self
            .live
            .trains
            .iter()
            .enumerate()
            .filter(|(i, o)| {
                *i != index
                    && o.matched
                        .is_some_and(|om| self.net.line_key(om.trip) == key)
            })
            .map(|(i, _)| i.to_string())
            .collect();
        let mut out = String::new();
        json::Obj::new(&mut out)
            .raw("line", &format!("[{}]", coords.join(",")))
            .raw("stops", &stops)
            .raw("same_line", &format!("[{}]", same.join(",")))
            .end();
        out
    }

    /// Lines of the loaded Cercanías núcleos in their official colours, as a
    /// GeoJSON FeatureCollection: `{line, region, color, notice}`; `notice`
    /// is true when an active Renfe notice names the line.
    #[wasm_bindgen(js_name = linesGeoJson)]
    pub fn lines_geojson(&self, now_ms: f64) -> String {
        use std::collections::{BTreeMap, HashSet};
        let active = incidents::active(&self.net, &self.live.incidents, secs(now_ms));
        let noticed: HashSet<(String, String)> = active
            .iter()
            .flat_map(|r| {
                r.nucleos
                    .iter()
                    .flat_map(move |n| r.lines.iter().map(move |l| (n.clone(), l.clone())))
            })
            .collect();
        let mut s = String::from(r#"{"type":"FeatureCollection","features":["#);
        let mut first = true;
        for (ri, r) in self.net.regions.iter().enumerate() {
            if r.tt.region == "ld" || !r.tt.live {
                continue;
            }
            // Longest trip per line name draws that line.
            let mut best: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
            for (ti, trip) in r.tt.trips.iter().enumerate() {
                let name = r.tt.routes[trip.route as usize].short_name.as_str();
                let len = r.sched[trip.pattern as usize]
                    .last()
                    .map_or(0, |x| x.dist_m);
                if best.get(name).is_none_or(|b| len > b.0) {
                    best.insert(name, (len, ti as u32));
                }
            }
            for (name, (_, ti)) in best {
                let tref = network::TripRef {
                    region: ri as u16,
                    trip: ti,
                };
                let trip = &r.tt.trips[ti as usize];
                let color = r.tt.routes[trip.route as usize]
                    .color
                    .map_or_else(|| "#6b7280".to_owned(), |c| format!("#{c:06x}"));
                let coords: Vec<String> = self
                    .net
                    .trip_line(tref)
                    .iter()
                    .map(|p| format!("[{:.5},{:.5}]", p.lon, p.lat))
                    .collect();
                if !first {
                    s.push(',');
                }
                first = false;
                s.push_str(r#"{"type":"Feature","geometry":{"type":"LineString","coordinates":["#);
                s.push_str(&coords.join(","));
                s.push_str("]},\"properties\":");
                json::Obj::new(&mut s)
                    .s("line", name)
                    .s("region", &r.tt.region)
                    .s("color", &color)
                    .b(
                        "notice",
                        noticed.contains(&(r.tt.region.clone(), name.to_owned())),
                    )
                    .end();
                s.push('}');
            }
        }
        s.push_str("]}");
        s
    }

    /// Up to `k` stations within `max_m` of a point, nearest first:
    /// `[{id, name, lat, lon, distance_m, services}]`.
    #[wasm_bindgen(js_name = nearestStationsJson)]
    pub fn nearest_stations_json(&self, lat: f64, lon: f64, k: usize, max_m: f64) -> String {
        let near =
            places::nearest_stations(&self.net, trainradar_proto::LatLon::new(lat, lon), k, max_m);
        let mut s = String::from("[");
        for (i, n) in near.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            let c = n.station.coord();
            json::Obj::new(&mut s)
                .s("id", &n.station.id)
                .s("name", &n.station.name)
                .n("lat", c.lat)
                .n("lon", c.lon)
                .n("distance_m", n.distance_m.round())
                .n("services", n.station.services)
                .end();
        }
        s.push(']');
        s
    }

    /// Next trains at a station (loaded timetables, live delays), in
    /// timetable order: `[{trip_id, route, number, other_end, terminates, sched, delay,
    /// expected, canceled, live}]`. `sched` is the departure, or the arrival
    /// for trains that terminate here.
    #[wasm_bindgen(js_name = stationBoardJson)]
    pub fn station_board_json(
        &self,
        station_id: &str,
        now_ms: f64,
        horizon_secs: i32,
        limit: usize,
    ) -> String {
        let rows = places::board(
            &self.net,
            &self.live,
            station_id,
            secs(now_ms),
            i64::from(horizon_secs),
            limit,
        );
        let mut s = String::from("[");
        for (i, r) in rows.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            json::Obj::new(&mut s)
                .s("trip_id", &r.trip_id)
                .s("route", &r.route)
                .s("number", &r.number)
                .s("other_end", &r.other_end)
                .b("terminates", r.terminates)
                .n(
                    "sched",
                    if r.terminates {
                        r.sched_arr
                    } else {
                        r.sched_dep
                    },
                )
                .on("delay", r.delay)
                .n("expected", r.expected())
                .b("canceled", r.canceled)
                .b("live", r.live)
                .end();
        }
        s.push(']');
        s
    }

    /// Trains on the map heading for a station within `horizon_secs`, by
    /// arrival: each is the train's popup JSON plus `eta` and `distance_m`.
    #[wasm_bindgen(js_name = approachingJson)]
    pub fn approaching_json(&self, station_id: &str, now_ms: f64, horizon_secs: i32) -> String {
        let now = secs(now_ms);
        let list = places::approaching(
            &self.net,
            &self.live,
            station_id,
            now,
            i64::from(horizon_secs),
        );
        let views = self.live.views(&self.net, now, false);
        let mut s = String::from("[");
        for (i, a) in list.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            let mut v = self.view_json(&views[a.index]);
            v.pop(); // reopen the object to add fields
            s.push_str(&v);
            s.push_str(&format!(
                ",\"eta\":{},\"distance_m\":{}}}",
                a.eta,
                a.distance_m.round()
            ));
        }
        s.push(']');
        s
    }

    /// Add a user location fix for "Am I on this train?". Kept in memory for
    /// 90 s only; never sent anywhere.
    #[wasm_bindgen(js_name = onboardAdd)]
    pub fn onboard_add(&mut self, lat: f64, lon: f64, accuracy_m: f64, now_ms: f64) {
        self.onboard.add(
            &self.net,
            &self.live,
            onboard::Sample {
                t: secs(now_ms),
                p: trainradar_proto::LatLon::new(lat, lon),
                accuracy_m,
            },
        );
    }

    /// Forget all location fixes (location turned off).
    #[wasm_bindgen(js_name = onboardClear)]
    pub fn onboard_clear(&mut self) {
        self.onboard.clear();
    }

    /// `{status, samples, span_secs, user_speed, candidates: [{index,
    /// trip_id, number, median_m, confidence}]}`; status is one of
    /// collecting, stationary, none, match, ambiguous.
    #[wasm_bindgen(js_name = onboardJson)]
    pub fn onboard_json(&self) -> String {
        use onboard::{Confidence, Status};
        let v = self.onboard.verdict();
        let mut cands = String::from("[");
        for (i, c) in v.candidates.iter().take(3).enumerate() {
            if i > 0 {
                cands.push(',');
            }
            json::Obj::new(&mut cands)
                .n("index", self.find_train(&c.trip_id, &c.number))
                .s("trip_id", &c.trip_id)
                .s("number", &c.number)
                .n("median_m", c.median_m.round())
                .s(
                    "confidence",
                    match c.confidence {
                        Confidence::High => "high",
                        Confidence::Medium => "medium",
                        Confidence::Low => "low",
                    },
                )
                .end();
        }
        cands.push(']');
        let mut s = String::new();
        json::Obj::new(&mut s)
            .s(
                "status",
                match v.status {
                    Status::Collecting => "collecting",
                    Status::Stationary => "stationary",
                    Status::NoMatch => "none",
                    Status::Match => "match",
                    Status::Ambiguous => "ambiguous",
                },
            )
            .n("samples", v.samples)
            .n("span_secs", v.span_secs)
            .on(
                "user_speed",
                v.user_speed_ms.map(|x| (x * 10.0).round() / 10.0),
            )
            .raw("candidates", &cands)
            .end();
        s
    }

    /// Trains stopped between stations (longest first), as popup JSON.
    #[wasm_bindgen(js_name = stoppedJson)]
    pub fn stopped_json(&self, now_ms: f64) -> String {
        let views = self.live.views(&self.net, secs(now_ms), false);
        let mut list: Vec<&TrainView> = views.iter().filter(|v| v.stopped.is_some()).collect();
        list.sort_by_key(|v| v.stopped.map(|s| s.since));
        let items: Vec<String> = list.iter().map(|v| self.view_json(v)).collect();
        format!("[{}]", items.join(","))
    }

    /// Active incidents, newest first: `[{id, text, tags, lines, nucleos,
    /// stops: [{id, name, lat, lon}], from, until}]`. Feed text is untrusted:
    /// show it as text only.
    #[wasm_bindgen(js_name = incidentsJson)]
    pub fn incidents_json(&self, now_ms: f64) -> String {
        let strs = |v: &[String]| {
            let mut x = String::from("[");
            for (i, t) in v.iter().enumerate() {
                if i > 0 {
                    x.push(',');
                }
                json::str(&mut x, t);
            }
            x.push(']');
            x
        };
        let mut s = String::from("[");
        for (i, r) in incidents::active(&self.net, &self.live.incidents, secs(now_ms))
            .iter()
            .enumerate()
        {
            if i > 0 {
                s.push(',');
            }
            let mut stops = String::from("[");
            for (k, (id, name, c)) in r.stops.iter().enumerate() {
                if k > 0 {
                    stops.push(',');
                }
                json::Obj::new(&mut stops)
                    .s("id", id)
                    .s("name", name)
                    .on("lat", c.map(|c| c.lat))
                    .on("lon", c.map(|c| c.lon))
                    .end();
            }
            stops.push(']');
            json::Obj::new(&mut s)
                .s("id", &r.incident.id)
                .s("text", &r.text)
                .raw("tags", &strs(&r.tags))
                .raw("lines", &strs(&r.lines))
                .raw("nucleos", &strs(&r.nucleos))
                .raw("stops", &stops)
                .on("from", r.incident.active_from)
                .on("until", r.incident.active_until)
                .end();
        }
        s.push(']');
        s
    }
}

impl Engine {
    /// "AVE 3071" / "C3 21096" for a train identified by trip id or number.
    fn title_of(&self, id: &str) -> String {
        let Some(t) =
            self.live.trains.iter().find(|t| {
                t.rt.trip_id == id || (t.rt.trip_id.is_empty() && t.rt.train_number == id)
            })
        else {
            return String::new();
        };
        let route = t.matched.map_or_else(
            || t.rt.line.clone(),
            |m| {
                let r = &self.net.regions[m.trip.region as usize];
                r.tt.routes[self.net.trip(m.trip).route as usize]
                    .short_name
                    .clone()
            },
        );
        format!("{route} {}", t.rt.train_number).trim().to_owned()
    }

    /// Time of the latest feed data (for filtering incidents in popups).
    fn live_now(&self) -> i64 {
        self.live.now
    }

    fn view_json(&self, v: &TrainView) -> String {
        let t = &self.live.trains[v.index];
        let mut s = String::new();
        let mut o = json::Obj::new(&mut s);
        o.n("index", v.index)
            .s("trip_id", &t.rt.trip_id)
            .s("number", &t.rt.train_number)
            .s("line", &t.rt.line)
            .os("platform", t.rt.platform.as_deref())
            .s("feed", t.feed)
            .n("lat", v.coord.lat)
            .n("lon", v.coord.lon)
            .on("delay", v.delay.map(|d| d.0))
            .os(
                "delay_source",
                t.delay_source.map(|d| match d {
                    DelaySource::TripUpdate => "renfe",
                    DelaySource::Gps => "estimated",
                }),
            )
            .n("fix_age", v.fix_age_secs)
            .s(
                "position",
                match v.source {
                    PositionSource::Gps => "gps",
                    PositionSource::Interpolated => "interpolated",
                    PositionSource::Scheduled => "scheduled",
                },
            )
            .b("canceled", t.canceled)
            .on("speed_kmh", v.speed.map(|s| s.0.round()))
            .b("speed_measured", v.speed.is_some_and(|s| s.1))
            .os(
                "accessible",
                t.accessible.map(|a| if a { "yes" } else { "no" }),
            );
        if let Some(m) = t.matched {
            let r = &self.net.regions[m.trip.region as usize];
            let trip = self.net.trip(m.trip);
            let route = &r.tt.routes[trip.route as usize];
            let n = self.net.schedule(m.trip).len();
            o.s("region", &r.tt.region)
                .s("route", &route.short_name)
                .s("origin", self.net.stop_name(m.trip, 0))
                .s("destination", self.net.stop_name(m.trip, n - 1))
                .os(
                    "next_stop",
                    v.next_stop.map(|i| self.net.stop_name(m.trip, i)),
                )
                .on("next_arrival", v.next_arrival)
                .b("matched_exact", m.exact)
                .s("operator", &r.tt.operator);
            if let Some(info) = v.along.and_then(|d| self.net.track_info(m.trip, d)) {
                o.n("gauge_mm", info.gauge_mm).n("max_kmh", info.max_kmh);
            }
            o.b("timetable_only", !r.tt.live)
                .s("route_id", &route.id)
                .n(
                    "incidents",
                    incidents::for_route(&self.live.incidents, &route.id, self.live_now()).len(),
                );
        }
        if let (Some(st), Some(m)) = (v.stopped, t.matched) {
            let mut x = String::new();
            json::Obj::new(&mut x)
                .n("since", st.since)
                .b("confirmed", st.confirmed)
                .s("after", self.net.stop_name(m.trip, st.after_stop))
                .s("before", self.net.stop_name(m.trip, st.after_stop + 1))
                .end();
            o.raw("stopped", &x);
        }
        for (k, g) in [("ahead", &v.ahead), ("behind", &v.behind)] {
            match g {
                Some(g) => {
                    let mut x = String::new();
                    json::Obj::new(&mut x)
                        .s("trip_id", &g.trip_id)
                        .s("title", &self.title_of(&g.trip_id))
                        .n("distance_m", g.distance_m)
                        .n("time_secs", g.time_secs)
                        .b("estimated", g.source == PositionSource::Interpolated)
                        .end();
                    o.raw(k, &x);
                }
                None => {
                    o.raw(k, "null");
                }
            }
        }
        o.end();
        s
    }
}

/// Poll timing for one feed (see [`poll::Poller`]).
#[wasm_bindgen]
#[derive(Debug)]
pub struct FeedPoller(poll::Poller);

#[wasm_bindgen]
impl FeedPoller {
    #[wasm_bindgen(constructor)]
    pub fn new(interval_secs: u32) -> Self {
        Self(poll::Poller::new(interval_secs))
    }

    pub fn success(&mut self) {
        self.0.success();
    }

    pub fn failure(&mut self) {
        self.0.failure();
    }

    /// Consecutive failed fetches (0 when healthy).
    pub fn failures(&self) -> u32 {
        self.0.failures()
    }

    #[wasm_bindgen(js_name = setHidden)]
    pub fn set_hidden(&mut self, hidden: bool) {
        self.0.set_hidden(hidden);
    }

    /// Milliseconds to wait, or -1 while the tab is hidden.
    #[wasm_bindgen(js_name = nextDelayMs)]
    pub fn next_delay_ms(&self, random: f64) -> i32 {
        // ≤ 10 min in ms, so it always fits; an i32 is a plain JS number.
        self.0
            .next_delay_ms(random)
            .map_or(-1, |ms| i32::try_from(ms).unwrap_or(i32::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use trainradar_proto::encode;
    use trainradar_proto::refdata::{GridIndex, Header, RegionRec, StationRec, StationsFile};

    #[test]
    fn stations_geojson_is_valid() {
        let mut stations = vec![StationRec {
            id: "17000".into(),
            name: "Madrid \"Chamartín\"".into(),
            lat_e5: 4_047_118,
            lon_e5: -368_295,
            services: 3,
            regions: vec![0],
        }];
        let grid = GridIndex::build(&mut stations, |s| (s.lat_e5, s.lon_e5), 10_000);
        let f = StationsFile {
            header: Header::new(0, 8, 0),
            regions: vec![RegionRec {
                code: "ld".into(),
                name: "x".into(),
                bbox_e5: [0; 4],
            }],
            stations,
            grid,
        };
        let mut e = Engine::new();
        e.net.load_stations(&encode(&f).unwrap()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&e.stations_geojson()).unwrap();
        let feat = &v["features"][0];
        assert_eq!(feat["geometry"]["coordinates"][0], -3.68295);
        assert_eq!(feat["properties"]["name"], "Madrid \"Chamartín\"");
        assert_eq!(feat["properties"]["services"], 3);
        assert_eq!(e.find_train("x", "1"), -1);
    }

    #[test]
    fn location_json_parses() {
        use crate::network::tests::{local, sample_network};
        let mut e = Engine::new();
        e.net = sample_network();
        let now = local(8, 5);
        let v = source::RtVehicle {
            trip_id: "1004D100C3".into(),
            train_number: "100".into(),
            line: "C3".into(),
            platform: None,
            lat: 40.35,
            lon: -3.70,
            bearing: None,
            speed: None,
            timestamp: Some(now),
            stop_id: None,
            status: None,
        };
        e.live
            .ingest(&e.net, "vp_cer", source::FeedData::Vehicles(vec![v]), now);
        let ms = now as f64 * 1000.0;
        let a: serde_json::Value =
            serde_json::from_str(&e.approaching_json("B", ms, 1800)).unwrap();
        assert_eq!(a[0]["trip_id"], "1004D100C3");
        assert_eq!(a[0]["eta"], local(8, 10));
        let b: serde_json::Value =
            serde_json::from_str(&e.station_board_json("B", ms, 7200, 5)).unwrap();
        assert_eq!(b[0]["route"], "C3");
        assert_eq!(b[0]["live"], true);
        e.onboard_add(40.35, -3.70, 15.0, ms);
        let o: serde_json::Value = serde_json::from_str(&e.onboard_json()).unwrap();
        assert_eq!(o["status"], "collecting");
        assert_eq!(o["samples"], 1);
        e.onboard_clear();
        let o: serde_json::Value = serde_json::from_str(&e.onboard_json()).unwrap();
        assert_eq!(o["samples"], 0);

        // Incidents: resolved lines, and counted in the popup of a C3 train.
        e.live.ingest(
            &e.net,
            "alerts",
            source::FeedData::Alerts(vec![trainradar_proto::Incident {
                id: "AVISO_1".into(),
                header: String::new(),
                description: "#MadC3 \"Obras\" <b>entre</b> A y B".into(),
                active_from: Some(now - 3600),
                active_until: None,
                route_ids: vec!["10T0001C3".into()],
                stop_ids: vec!["B".into()],
            }]),
            now,
        );
        let i: serde_json::Value = serde_json::from_str(&e.incidents_json(ms)).unwrap();
        assert_eq!(
            i[0]["text"], "\"Obras\" <b>entre</b> A y B",
            "text kept verbatim, shown as text"
        );
        assert_eq!(i[0]["lines"][0], "C3");
        assert_eq!(i[0]["stops"][0]["id"], "B");
        let t: serde_json::Value = serde_json::from_str(&e.train_json(0, ms)).unwrap();
        assert_eq!(t["incidents"], 1);

        // Route highlight and coloured lines.
        let r: serde_json::Value = serde_json::from_str(&e.trip_json(0)).unwrap();
        assert_eq!(r["stops"].as_array().unwrap().len(), 3);
        assert!(r["line"].as_array().unwrap().len() >= 2);
        let l: serde_json::Value = serde_json::from_str(&e.lines_geojson(ms)).unwrap();
        assert_eq!(l["features"][0]["properties"]["line"], "C3");
        assert_eq!(l["features"][0]["properties"]["notice"], true);
    }
}
