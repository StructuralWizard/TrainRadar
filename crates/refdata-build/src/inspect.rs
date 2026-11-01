//! `refdata-build inspect`: print the structure of a GTFS zip or CSV so we can
//! check what Renfe actually publishes (files, columns, ID formats, shapes).

use crate::gtfs_io::{Gtfs, Result, Table, decode_text};
use std::collections::BTreeMap;
use std::path::Path;

pub fn run(path: &Path) -> Result<()> {
    if path.extension().is_some_and(|e| e == "zip") {
        inspect_zip(path)
    } else {
        let text = decode_text(&std::fs::read(path)?);
        let delim = if text.lines().next().unwrap_or("").contains(';') {
            b';'
        } else {
            b','
        };
        let t = Table::parse_with(&text, delim)?;
        println!("== {} ({} rows)", path.display(), t.rows.len());
        print_sample(&t, 5);
        Ok(())
    }
}

fn print_sample(t: &Table, n: usize) {
    println!("   columns: {}", t.headers.join(", "));
    for r in t.rows.iter().take(n) {
        println!("   | {}", r.join(" | "));
    }
}

fn inspect_zip(path: &Path) -> Result<()> {
    let mut g = Gtfs::open(path)?;
    println!("# {}", path.display());
    for (name, size) in g.files()? {
        println!("- {name}: {:.1} MB uncompressed", size as f64 / 1e6);
    }
    for name in [
        "agency.txt",
        "routes.txt",
        "stops.txt",
        "trips.txt",
        "calendar.txt",
        "calendar_dates.txt",
        "shapes.txt",
        "frequencies.txt",
        "transfers.txt",
        "feed_info.txt",
    ] {
        match g.table(name)? {
            Some(t) => {
                println!("\n== {name} ({} rows)", t.rows.len());
                print_sample(&t, 4);
            }
            None => println!("\n== {name}: (absent)"),
        }
    }

    if let Some(routes) = g.table("routes.txt")? {
        let id = routes.col("route_id");
        let mut prefixes: BTreeMap<String, (usize, String)> = BTreeMap::new();
        for r in &routes.rows {
            let rid = routes.get(r, id);
            let p: String = rid.chars().take(2).collect();
            let e = prefixes.entry(p).or_insert((0, String::new()));
            e.0 += 1;
            if e.1.is_empty() {
                e.1 = format!(
                    "{} / {} / {}",
                    rid,
                    routes.get(r, routes.col("route_short_name")),
                    routes.get(r, routes.col("route_long_name"))
                );
            }
        }
        println!("\n== route_id 2-char prefixes (count, example id / short / long)");
        for (p, (n, ex)) in prefixes {
            println!("   {p}: {n}  e.g. {ex}");
        }
        let types: BTreeMap<&str, usize> =
            routes.rows.iter().fold(BTreeMap::new(), |mut m, r| {
                *m.entry(routes.get(r, routes.col("route_type"))).or_default() += 1;
                m
            });
        println!("   route_type counts: {types:?}");
    }

    if let Some(trips) = g.table("trips.txt")? {
        let shape = trips.col("shape_id");
        let with_shape = trips
            .rows
            .iter()
            .filter(|r| !trips.get(r, shape).is_empty())
            .count();
        println!(
            "\n== trips: {} total, {} with shape_id",
            trips.rows.len(),
            with_shape
        );
    }

    // stop_times can be hundreds of MB: stream-count rather than print.
    if let Some(text) = g.text("stop_times.txt")? {
        let mut lines = text.lines();
        let header = lines.next().unwrap_or("");
        println!("\n== stop_times.txt");
        println!("   columns: {header}");
        let mut n = 0usize;
        let mut max_time = String::new();
        let arr = header
            .split(',')
            .position(|h| h.trim().eq_ignore_ascii_case("arrival_time"));
        for (i, l) in lines.enumerate() {
            if i < 4 {
                println!("   | {l}");
            }
            n += 1;
            if let Some(a) = arr.and_then(|a| l.split(',').nth(a)) {
                let a = a.trim();
                if a.len() >= max_time.len() && a > max_time.as_str() {
                    max_time = a.to_owned();
                }
            }
        }
        println!("   rows: {n}; latest arrival_time: {max_time}");
    }
    Ok(())
}
