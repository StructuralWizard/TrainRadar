//! Journeys with changes on a real refdata build: a few known trips, timed,
//! with every region loaded (the app loads fewer: the long-distance region
//! and the Cercanías of both ends).
//!
//!   cargo run --release -p trainradar-engine --example journeys_bench -- web/data
//!
//! Prints Markdown (for the workflow summary). Stations are found by name.

use std::path::Path;
use std::time::Instant;
use trainradar_engine::journeys::{Query, Step, journeys};
use trainradar_engine::live::Live;
use trainradar_engine::network::Network;
use trainradar_proto::time::service_day_base;

const TRIPS: &[(&str, &str)] = &[
    ("Sol", "Valladolid"),
    ("Alcalá de Henares", "Toledo"),
    ("Aeropuerto T4", "Segovia"),
    ("Barcelona-Sants", "Girona"),
    ("Sevilla-Santa Justa", "Málaga"),
    ("Abando", "Madrid-Chamartín"),
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data = std::env::args().nth(1).unwrap_or_else(|| "web/data".into());
    let data = Path::new(&data);
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(data.join("manifest.json"))?)?;
    let file = |v: &serde_json::Value| std::fs::read(data.join(v["file"].as_str().unwrap()));
    let mut net = Network::default();
    net.load_stations(&file(&manifest["stations"])?)?;
    for r in manifest["regions"].as_array().unwrap() {
        net.load_timetable(&file(r)?)?;
    }
    let live = Live::default();
    let stations = &net.stations.as_ref().unwrap().stations;
    let find = |name: &str| -> Vec<&str> {
        let exact: Vec<&str> = stations
            .iter()
            .filter(|s| s.name.eq_ignore_ascii_case(name))
            .map(|s| s.id.as_str())
            .collect();
        if !exact.is_empty() {
            return exact;
        }
        let low = name.to_lowercase();
        stations
            .iter()
            .filter(|s| s.name.to_lowercase().contains(&low))
            .map(|s| s.id.as_str())
            .take(3)
            .collect()
    };
    let name = |id: &str| {
        stations
            .iter()
            .find(|s| s.id == id)
            .map_or(id.to_owned(), |s| s.name.clone())
    };
    // 07:30 Madrid time on the window's second day.
    let day = i64::from(net.regions[0].tt.header.window_start_day) + 1;
    let after = service_day_base(day) + 7 * 3_600 + 1_800;
    let hm = |t: i64| {
        let local = t - service_day_base(day);
        format!(
            "{:02}:{:02}",
            local.div_euclid(3_600) % 24,
            local.div_euclid(60) % 60
        )
    };
    println!("## Journeys with changes (all regions loaded, 07:30, no live data)\n");
    let mut total = 0.0;
    for (a, b) in TRIPS {
        let (from, to) = (find(a), find(b));
        let t0 = Instant::now();
        let js = journeys(
            &net,
            &live,
            &Query {
                from: &from,
                to: &to,
                after,
                max_changes: 2,
                limit: 5,
                window_secs: 4 * 3_600,
            },
        );
        let ms = t0.elapsed().as_secs_f64() * 1_000.0;
        total += ms;
        println!(
            "### {a} ({}) → {b} ({}): {} journeys in {ms:.0} ms\n",
            from.join(","),
            to.join(","),
            js.len()
        );
        for j in &js {
            let mut parts = Vec::new();
            for s in &j.steps {
                match s {
                    Step::Ride(r) => parts.push(format!(
                        "{} {} {} {}→{} {}",
                        r.route,
                        r.number,
                        hm(r.sched_dep),
                        name(&r.from),
                        name(&r.to),
                        hm(r.sched_arr)
                    )),
                    Step::Walk(w) => parts.push(format!(
                        "walk {}→{} {} min",
                        name(&w.from),
                        name(&w.to),
                        w.secs / 60
                    )),
                }
            }
            println!(
                "- {}–{}, {} changes: {}",
                hm(j.dep()),
                hm(j.arr()),
                j.changes(),
                parts.join(" · ")
            );
        }
        println!();
    }
    println!("Total: {total:.0} ms");
    Ok(())
}
