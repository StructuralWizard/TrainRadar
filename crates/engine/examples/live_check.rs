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
        if !r["geometry"].is_null() {
            net.load_geometry(&file(&r["geometry"])?)?;
        }
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
    let mut unmatched: BTreeMap<(&str, &str), (usize, Vec<String>)> = BTreeMap::new();
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
                let why = net.explain_no_match(&t.rt.trip_id, &t.rt.train_number);
                let e = unmatched.entry((t.feed, why)).or_default();
                e.0 += 1;
                if e.1.len() < 6 {
                    let detail = net.find_trip(&t.rt.trip_id).map_or(String::new(), |tr| {
                        let r = &net.regions[tr.region as usize];
                        let trip = net.trip(tr);
                        let dur = net.schedule(tr).last().map_or(0, |s| s.arrival);
                        let hm = |s: u32| format!("{:02}:{:02}", s / 3600, s % 3600 / 60);
                        format!(
                            " sched {}–{} days {:#010b} (window from day {}), now {}",
                            hm(trip.start),
                            hm(trip.start + dur),
                            trip.days,
                            r.tt.header.window_start_day,
                            {
                                let l = now + trainradar_proto::time::madrid_offset(now);
                                let d = l.rem_euclid(86_400);
                                format!(
                                    "{:02}:{:02} local, day {}",
                                    d / 3600,
                                    d % 3600 / 60,
                                    l.div_euclid(86_400)
                                )
                            }
                        )
                    });
                    e.1.push(format!(
                        "`{}` ({}){detail}",
                        t.rt.trip_id, t.rt.train_number
                    ));
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
    println!(
        "\n| Feed | Trains | Matched by id | by number | Unmatched | Fix on line | Delay from Renfe |"
    );
    println!("|---|---:|---:|---:|---:|---:|---:|");
    for (f, c) in &by_feed {
        println!(
            "| {f} | {} | {} | {} | {} | {} | {} |",
            c[0], c[1], c[2], c[3], c[4], c[5]
        );
    }
    for ((feed, why), (n, ex)) in &unmatched {
        println!(
            "\n- Unmatched in {feed}: {n} × {why}, e.g. {}",
            ex.join(", ")
        );
    }

    let mut early: Vec<_> = live
        .trains
        .iter()
        .filter(|t| t.delay.is_some_and(|d| d < -900))
        .collect();
    early.sort_by_key(|t| t.delay);
    for t in early.iter().take(3) {
        println!(
            "- Very early: `{}` ({}) feed {}, delay {:?} from {:?}",
            t.rt.trip_id, t.rt.train_number, t.feed, t.delay, t.delay_source
        );
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
    let mut worst: Vec<_> = views
        .iter()
        .filter(|v| v.along.is_some())
        .map(|v| {
            let t = &live.trains[v.index];
            (
                haversine_m(v.coord, LatLon::new(t.rt.lat, t.rt.lon)),
                v.index,
            )
        })
        .collect();
    worst.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (d, i) in worst.iter().take(3).filter(|w| w.0 > 1_000.0) {
        let t = &live.trains[*i];
        println!(
            "- Far from GPS: {:.0} m, `{}` ({}) feed {}, delay {:?} ({:?}), fix age {} s",
            d,
            t.rt.trip_id,
            t.rt.train_number,
            t.feed,
            t.delay,
            t.delay_source,
            now - t.fix_time
        );
    }
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

    // Incidents (alerts feed): what they refer to and how many are active.
    let inc = &live.incidents;
    let active = inc
        .iter()
        .filter(|a| {
            a.active_from.is_none_or(|f| f <= now) && a.active_until.is_none_or(|u| u >= now)
        })
        .count();
    let with_routes = inc.iter().filter(|a| !a.route_ids.is_empty()).count();
    let with_stops = inc.iter().filter(|a| !a.stop_ids.is_empty()).count();
    println!(
        "\nIncidents: {} total, {active} active now, {with_routes} name lines, {with_stops} name stations",
        inc.len()
    );
    for a in inc.iter().take(6) {
        let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>().replace('\n', " ");
        println!(
            "- `{}` from {:?} until {:?}; routes {:?}; stops {:?}; \"{}\" / \"{}\"",
            a.id,
            a.active_from,
            a.active_until,
            a.route_ids.iter().take(4).collect::<Vec<_>>(),
            a.stop_ids.iter().take(4).collect::<Vec<_>>(),
            cut(&a.header, 80),
            cut(&a.description, 160)
        );
    }

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
