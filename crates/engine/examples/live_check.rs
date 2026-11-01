//! Run the engine natively against real data and print how well it works:
//! match rates, delay sources, fix ages, interpolation error and spacing.
//!
//!   cargo run --release -p trainradar-engine --example live_check -- web/data gtfs/rt
//!
//! `web/data` is refdata-build output; `gtfs/rt` holds the five `.pb` feeds.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use trainradar_engine::live::{DelaySource, Live};
use trainradar_engine::network::Network;
use trainradar_engine::renfe::Renfe;
use trainradar_engine::source::SourceAdapter;
use trainradar_proto::LatLon;
use trainradar_proto::geo::haversine_m;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (data, rt) = (Path::new(&args[0]), Path::new(&args[1]));
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;

    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(data.join("manifest.json"))?)?;
    let mut net = Network::default();
    let file = |v: &serde_json::Value| std::fs::read(data.join(v["file"].as_str().unwrap()));
    net.load_stations(&file(&manifest["stations"])?)?;
    for r in manifest["regions"].as_array().unwrap() {
        net.load_timetable(&file(r)?)?;
    }
    println!("### Live check\n\nLoaded {} regions.\n", net.regions.len());

    let mut live = Live::default();
    for spec in Renfe.feeds() {
        let bytes = std::fs::read(rt.join(spec.path))?;
        let data = Renfe.decode(spec.kind, &bytes)?;
        let n = match &data {
            trainradar_engine::source::FeedData::Vehicles(v) => v.len(),
            trainradar_engine::source::FeedData::TripUpdates(u) => u.len(),
            trainradar_engine::source::FeedData::Alerts(a) => a.len(),
        };
        println!("- `{}`: {} bytes, {n} records", spec.path, bytes.len());
        live.ingest(&net, spec.key, data, now);
    }

    let mut by_feed: BTreeMap<&str, [usize; 6]> = BTreeMap::new();
    let mut unmatched = Vec::new();
    let mut delays = Vec::new();
    let mut ages = Vec::new();
    for t in &live.trains {
        let c = by_feed.entry(t.feed).or_default();
        c[0] += 1;
        match t.matched {
            Some(m) if m.exact => c[1] += 1,
            Some(_) => c[2] += 1,
            None => {
                c[3] += 1;
                if unmatched.len() < 8 {
                    unmatched.push(format!("{} / {}", t.rt.trip_id, t.rt.train_number));
                }
            }
        }
        if t.fix_along.is_some() {
            c[4] += 1;
        }
        if t.delay_source == Some(DelaySource::TripUpdate) {
            c[5] += 1;
        }
        if let Some(d) = t.delay {
            delays.push(d);
        }
        ages.push(now - t.fix_time);
    }
    println!("\n| Feed | Trains | Matched by id | by number | Unmatched | Fix on line | Delay from Renfe |");
    println!("|---|---:|---:|---:|---:|---:|---:|");
    for (f, c) in &by_feed {
        println!("| {f} | {} | {} | {} | {} | {} | {} |", c[0], c[1], c[2], c[3], c[4], c[5]);
    }
    if !unmatched.is_empty() {
        println!("\nUnmatched examples (trip id / number): {}", unmatched.join(", "));
    }

    delays.sort_unstable();
    let pct = |v: &[i64], p: f64| v.get(((v.len() as f64 - 1.0) * p) as usize).copied();
    let d64: Vec<i64> = delays.iter().map(|&d| i64::from(d)).collect();
    println!(
        "\nDelay (s): min {:?}, median {:?}, p90 {:?}, max {:?}",
        d64.first(),
        pct(&d64, 0.5),
        pct(&d64, 0.9),
        d64.last()
    );
    ages.sort_unstable();
    println!(
        "Fix age at load (s): median {:?}, p90 {:?} (feeds without timestamps count from now)",
        pct(&ages, 0.5),
        pct(&ages, 0.9)
    );

    // Interpolation: drawn position now vs. the raw GPS fix.
    let views = live.views(&net, now, true);
    let mut err: Vec<i64> = views
        .iter()
        .filter(|v| v.along.is_some())
        .map(|v| {
            let t = &live.trains[v.index];
            haversine_m(v.coord, LatLon::new(t.rt.lat, t.rt.lon)).round() as i64
        })
        .collect();
    err.sort_unstable();
    println!(
        "Drawn vs. GPS position (m), matched trains: median {:?}, p90 {:?}, max {:?}",
        pct(&err, 0.5),
        pct(&err, 0.9),
        err.last()
    );

    let s = trainradar_engine::stats::compute(views.iter().map(|v| v.delay));
    println!(
        "Stats bar: {} trains, {} delayed (5+ min), median delay {:?} s",
        s.trains, s.delayed, s.median_delay
    );

    let with_ahead: Vec<_> = views.iter().filter(|v| v.ahead.is_some()).collect();
    println!(
        "\nSpacing: {} of {} trains have a train ahead on the same line. Examples:\n",
        with_ahead.len(),
        views.len()
    );
    println!("| Train | Line | Ahead | Distance | Time |");
    println!("|---|---|---|---:|---:|");
    for v in with_ahead.iter().take(10) {
        let t = &live.trains[v.index];
        let g = v.ahead.as_ref().unwrap();
        println!(
            "| {} | {} | {} | {:.1} km | {} min |",
            t.rt.train_number,
            t.rt.line,
            g.trip_id,
            f64::from(g.distance_m) / 1000.0,
            g.time_secs / 60
        );
    }
    Ok(())
}
