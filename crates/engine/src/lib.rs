//! TrainRadar engine, compiled to WebAssembly and run in the browser.
//!
//! The web app fetches feeds (through the CORS pass-through Worker) and
//! reference files, hands the bytes to [`Engine`], and asks it for positions
//! to draw each frame. Everything (decoding, matching, delays,
//! interpolation, spacing, stats) happens here, in the browser.

pub mod gtfs_rt;
mod json;
pub mod live;
pub mod network;
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

fn secs(now_ms: f64) -> i64 {
    (now_ms / 1000.0).floor() as i64
}

/// Values per train in [`Engine::positions`].
pub const POSITION_STRIDE: usize = 5;

/// Everything the browser needs, behind one handle.
#[wasm_bindgen]
#[derive(Debug, Default)]
pub struct Engine {
    net: Network,
    live: Live,
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
    /// GPS fix age in seconds.
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
            ]);
        }
        out
    }

    /// Details for the popup of train `index` (as in `positions`), as JSON.
    #[wasm_bindgen(js_name = trainJson)]
    pub fn train_json(&self, index: usize, now_ms: f64) -> String {
        let views = self.live.views(&self.net, secs(now_ms), true);
        views
            .get(index)
            .map_or_else(|| "null".into(), |v| self.view_json(v))
    }

    /// Stats bar: `{trains, delayed, median_delay}`.
    #[wasm_bindgen(js_name = statsJson)]
    pub fn stats_json(&self, now_ms: f64) -> String {
        let views = self.live.views(&self.net, secs(now_ms), false);
        let s = stats::compute(views.iter().map(|v| v.delay));
        let mut out = String::new();
        json::Obj::new(&mut out)
            .n("trains", s.trains)
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

    /// Current incidents (alerts feed) as a JSON array.
    #[wasm_bindgen(js_name = incidentsJson)]
    pub fn incidents_json(&self) -> String {
        let mut s = String::from("[");
        for (i, a) in self.live.incidents.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            let routes: Vec<String> = a
                .route_ids
                .iter()
                .map(|r| {
                    let mut x = String::new();
                    json::str(&mut x, r);
                    x
                })
                .collect();
            json::Obj::new(&mut s)
                .s("id", &a.id)
                .s("header", &a.header)
                .s("description", &a.description)
                .on("from", a.active_from)
                .on("until", a.active_until)
                .raw("routes", &format!("[{}]", routes.join(",")))
                .end();
        }
        s.push(']');
        s
    }
}

impl Engine {
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
                },
            )
            .b("canceled", t.canceled);
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
                .b("matched_exact", m.exact);
        }
        for (k, g) in [("ahead", &v.ahead), ("behind", &v.behind)] {
            match g {
                Some(g) => {
                    let mut x = String::new();
                    json::Obj::new(&mut x)
                        .s("trip_id", &g.trip_id)
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
}
