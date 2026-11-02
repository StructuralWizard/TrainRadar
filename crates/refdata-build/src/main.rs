//! `refdata-build`: Renfe static GTFS → compact pre-indexed `.bin` files.
//!
//! Runs natively in CI, never in the browser.

mod build;
mod calendar;
mod gtfs_io;
mod inspect;
mod load;
mod osm;
mod verify;

use build::{
    ATTRIBUTION, FileEntry, LONG_DISTANCE, Manifest, RegionEntry, Source, bbox_e5, build_stations,
    build_timetable, content_hash, region_name, split_regions, window_header,
};
use calendar::{Window, format_date, parse_date};
use gtfs_io::{Gtfs, Result};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};
use trainradar_proto::encode;
use trainradar_proto::refdata::{GeometryFile, RegionRec, ShapeRec, TimetableFile, from_e5};

const USAGE: &str = "\
usage:
  refdata-build inspect <file.zip|file.csv>...
  refdata-build verify DIR
  refdata-build build --out DIR [--ld ZIP] [--cercanias ZIP] [--ouigo ZIP]
                      [--rail FILE.geojsonseq] [--date YYYY-MM-DD] [--days N]
                      [--sources FILE.tsv] [--report FILE.md] [--gzip]

build: writes stations.<hash>.bin, <region>.<hash>.bin and manifest.json to DIR.
  --date     service date the window is centred on (default: today, Madrid)
  --days     window length in days starting the day before --date (default 8)
  --sources  tab-separated name, url, etag, last-modified (from tools/fetch-gtfs.sh)
  --gzip     write gzip-compressed .bin.gz files (for deployment)
  --rail     OpenStreetMap railway=rail ways (from tools/fetch-osm-rail.sh), used to
             draw trips that have no usable GTFS shape (all of AV/LD/MD)
";

struct BuildArgs {
    out: PathBuf,
    ld: Option<PathBuf>,
    cercanias: Option<PathBuf>,
    ouigo: Option<PathBuf>,
    rail: Option<PathBuf>,
    date: Option<String>,
    days: u8,
    sources: Option<PathBuf>,
    report: Option<PathBuf>,
    gzip: bool,
}

fn parse_build_args(args: &[String]) -> std::result::Result<BuildArgs, String> {
    let mut a = BuildArgs {
        out: PathBuf::new(),
        ld: None,
        cercanias: None,
        ouigo: None,
        rail: None,
        date: None,
        days: 8,
        sources: None,
        report: None,
        gzip: false,
    };
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let mut val = || {
            it.next()
                .cloned()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag.as_str() {
            "--out" => a.out = val()?.into(),
            "--ld" => a.ld = Some(val()?.into()),
            "--cercanias" => a.cercanias = Some(val()?.into()),
            "--rail" => a.rail = Some(val()?.into()),
            "--ouigo" => a.ouigo = Some(val()?.into()),
            "--date" => a.date = Some(val()?),
            "--days" => {
                a.days = val()?
                    .parse()
                    .ok()
                    .filter(|d| (1..=16).contains(d))
                    .ok_or("--days must be 1..=16")?;
            }
            "--sources" => a.sources = Some(val()?.into()),
            "--report" => a.report = Some(val()?.into()),
            "--gzip" => a.gzip = true,
            other => return Err(format!("unknown option {other}")),
        }
    }
    if a.out.as_os_str().is_empty() {
        return Err("--out is required".into());
    }
    if a.ld.is_none() && a.cercanias.is_none() && a.ouigo.is_none() {
        return Err("give --ld, --cercanias and/or --ouigo".into());
    }
    Ok(a)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn read_sources(path: &Path) -> Result<Vec<Source>> {
    let text = std::fs::read_to_string(path)?;
    Ok(text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            let g = |i: usize| f.get(i).copied().unwrap_or("").trim().to_owned();
            Source {
                name: g(0),
                url: g(1),
                etag: g(2),
                last_modified: g(3),
            }
        })
        .collect())
}

/// Write `<stem>.<hash>.bin`, or `.bin.gz` gzip-compressed. Pre-compressing
/// means phones get the small size whatever the host does with `.bin`; the
/// browser decompresses with the built-in DecompressionStream.
fn write_hashed(out: &Path, stem: &str, bytes: &[u8], gzip: bool) -> Result<String> {
    let hash = content_hash(bytes);
    if gzip {
        use std::io::Write;
        let name = format!("{stem}.{hash}.bin.gz");
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        enc.write_all(bytes)?;
        std::fs::write(out.join(&name), enc.finish()?)?;
        Ok(name)
    } else {
        let name = format!("{stem}.{hash}.bin");
        std::fs::write(out.join(&name), bytes)?;
        Ok(name)
    }
}

fn run_build(a: BuildArgs) -> Result<()> {
    let generated_at = now_unix();
    // Madrid is UTC+1/+2; +1 h is close enough to pick the service date, and
    // the window starts a day early anyway.
    let today = match &a.date {
        Some(d) => parse_date(d).ok_or("bad --date")?,
        None => (generated_at + 3600).div_euclid(86_400),
    };
    let window = Window {
        start: today - 1,
        days: a.days,
    };
    let header = window_header(&window, generated_at);
    eprintln!(
        "window: {} + {} days",
        format_date(window.start),
        window.days
    );

    std::fs::create_dir_all(&a.out)?;
    for e in std::fs::read_dir(&a.out)? {
        let p = e?.path();
        if p.extension().is_some_and(|x| x == "bin" || x == "gz") || p.ends_with("manifest.json") {
            std::fs::remove_file(p)?;
        }
    }

    let graph = match &a.rail {
        Some(p) => {
            let f = std::fs::File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
            let g = osm::RailGraph::from_geojsonseq(std::io::BufReader::new(f))?;
            eprintln!("rail graph: {} nodes", g.node_count());
            Some(g)
        }
        None => None,
    };
    let mut router = graph.as_ref().map(osm::Router::new);

    type Built = (RegionRec, TimetableFile, Vec<ShapeRec>, build::RegionStats);
    let mut built: Vec<Built> = Vec::new();
    let mut report = String::new();
    for (path, kind) in [
        (&a.ld, "ld"),
        (&a.cercanias, "cercanias"),
        (&a.ouigo, "ouigo"),
    ] {
        let Some(path) = path else { continue };
        let commuter = kind == "cercanias";
        let mut g = Gtfs::open(path)?;
        let mut feed = load::load(&mut g, &window)?;
        if kind == "ouigo" {
            build::normalise_ouigo(&mut feed);
        }
        report.push_str(&format!(
            "- `{}`: {} trips in feed, {} in window, {} outside window, {} buses skipped, \
             {} too short; {} stop_times rows\n",
            path.display(),
            feed.stats.trips_total,
            feed.trips.len(),
            feed.stats.trips_outside_window,
            feed.stats.trips_skipped_bus,
            feed.stats.trips_too_short,
            feed.stats.stop_time_rows
        ));
        let regions = if kind == "ouigo" {
            std::iter::once((build::OUIGO.to_owned(), feed.trips.iter().collect())).collect()
        } else {
            split_regions(&feed, commuter)
        };
        for (code, trips) in regions {
            let (mut tt, legs, st) =
                build_timetable(&feed, &trips, &code, header.clone(), router.as_mut());
            if kind == "ouigo" {
                tt.operator = "OUIGO".into();
                tt.live = false;
            }
            let rec = RegionRec {
                code: code.clone(),
                name: region_name(&code),
                bbox_e5: bbox_e5(&tt),
            };
            built.push((rec, tt, legs, st));
        }
    }
    if let Some(r) = &router {
        report.push_str(&format!(
            "- OpenStreetMap track: {} graph nodes; {} stop pairs routed, {} not routable \
             (drawn straight)\n",
            graph.as_ref().map_or(0, osm::RailGraph::node_count),
            r.stats.pairs_routed,
            r.stats.pairs_failed
        ));
    }
    // AV/LD/MD first, then núcleos by code.
    built.sort_by(|a, b| {
        (a.0.code != LONG_DISTANCE, &a.0.code).cmp(&(b.0.code != LONG_DISTANCE, &b.0.code))
    });

    let pairs: Vec<(RegionRec, &TimetableFile)> =
        built.iter().map(|(r, t, _, _)| (r.clone(), t)).collect();
    let stations = build_stations(&pairs, header);
    let st_bytes = encode(&stations)?;
    let st_file = write_hashed(&a.out, "stations", &st_bytes, a.gzip)?;

    let mut regions = Vec::new();
    for (rec, tt, legs, stats) in built {
        let bytes = encode(&tt)?;
        let file = write_hashed(&a.out, &format!("tt-{}", rec.code), &bytes, a.gzip)?;
        let geometry = if legs.is_empty() {
            None
        } else {
            let g = GeometryFile {
                header: tt.header.clone(),
                region: rec.code.clone(),
                legs,
            };
            let gb = encode(&g)?;
            Some(FileEntry {
                file: write_hashed(&a.out, &format!("geo-{}", rec.code), &gb, a.gzip)?,
                bytes: gb.len(),
            })
        };
        let b = rec.bbox_e5;
        regions.push(RegionEntry {
            operator: tt.operator.clone(),
            live: tt.live,
            code: rec.code,
            name: rec.name,
            bbox: [from_e5(b[0]), from_e5(b[1]), from_e5(b[2]), from_e5(b[3])],
            file,
            bytes: bytes.len(),
            geometry,
            stats,
        });
    }

    let manifest = Manifest {
        format: trainradar_proto::FORMAT_VERSION,
        generated_at,
        window_start: format_date(window.start),
        window_days: window.days,
        sources: match &a.sources {
            Some(p) => read_sources(p)?,
            None => vec![],
        },
        stations: FileEntry {
            file: st_file,
            bytes: st_bytes.len(),
        },
        regions,
        attribution: ATTRIBUTION,
    };
    std::fs::write(
        a.out.join("manifest.json"),
        serde_json::to_string_pretty(&manifest)?,
    )?;

    let md = size_report(&manifest, stations.stations.len(), &report);
    print!("{md}");
    if let Some(p) = &a.report {
        std::fs::write(p, &md)?;
    }
    Ok(())
}

fn size_report(m: &Manifest, n_stations: usize, load_report: &str) -> String {
    let kb = |b: usize| format!("{:.1} KB", b as f64 / 1024.0);
    let mut s = String::new();
    s.push_str(&format!(
        "### Refdata build\n\nWindow: {} + {} days. Format v{}.\n\n{load_report}\n",
        m.window_start, m.window_days, m.format
    ));
    s.push_str("| File | Region | Raw | Trips | Patterns | Stops | Shapes | GTFS shape / OSM / straight | Shape pts in → out |\n");
    s.push_str("|---|---|---:|---:|---:|---:|---:|---:|---:|\n");
    s.push_str(&format!(
        "| `{}` | all stations ({n_stations}) + index | {} | | | | | | |\n",
        m.stations.file,
        kb(m.stations.bytes)
    ));
    let mut total = m.stations.bytes;
    for r in &m.regions {
        total += r.bytes + r.geometry.as_ref().map_or(0, |g| g.bytes);
        let st = &r.stats;
        s.push_str(&format!(
            "| `{}` | {} ({}) | {} | {} | {} | {} | {} | {} / {} / {} | {} → {} |\n",
            r.file,
            r.name,
            r.code,
            kb(r.bytes),
            st.trips,
            st.patterns,
            st.stops,
            st.shapes,
            st.patterns_on_shape,
            st.patterns_on_osm,
            st.patterns_straight,
            st.shape_points_in,
            st.shape_points_out
        ));
        if let Some(g) = &r.geometry {
            s.push_str(&format!(
                "| `{}` | {} track (OpenStreetMap) | {} | | | | | | |\n",
                g.file,
                r.code,
                kb(g.bytes)
            ));
        }
    }
    s.push_str(&format!("\nTotal raw: {}\n", kb(total)));
    s
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("inspect") if args.len() > 1 => args[1..]
            .iter()
            .try_for_each(|p| inspect::run(&PathBuf::from(p))),
        Some("verify") if args.len() == 2 => verify::run(Path::new(&args[1])),
        Some("build") => match parse_build_args(&args[1..]) {
            Ok(a) => run_build(a),
            Err(e) => {
                eprintln!("error: {e}\n\n{USAGE}");
                return ExitCode::from(2);
            }
        },
        _ => {
            eprint!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
