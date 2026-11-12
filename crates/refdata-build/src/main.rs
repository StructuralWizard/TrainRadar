//! `refdata-build`: Renfe static GTFS → compact pre-indexed `.bin` files.
//!
//! Runs natively in CI, never in the browser.

mod build;
mod calendar;
mod dem;
mod gtfs_io;
mod igr;
mod inspect;
mod load;
mod netcheck;
mod nrsched;
mod osm;
mod profile;
mod railnet;
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
use trainradar_proto::refdata::{
    GeometryFile, LegInfo, NetworkFile, Profile, RegionRec, SectionInfo, ShapeRec, TimetableFile,
    from_e5,
};

/// Ways kept by kind and left out by reason, for the build report.
fn network_note(g: &osm::RailGraph) -> String {
    let mut kept: Vec<_> = g.kept.iter().collect();
    kept.sort();
    let mut skipped: Vec<_> = g.skipped.iter().collect();
    skipped.sort();
    format!(
        "- OpenStreetMap ways kept: {}; left out: {}\n",
        kept.iter()
            .map(|(k, n)| format!("{} {n}", k.name()))
            .collect::<Vec<_>>()
            .join(", "),
        skipped
            .iter()
            .map(|(k, n)| format!("{} {n}", k.label()))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

const USAGE: &str = "\
usage:
  refdata-build inspect <file.zip|file.csv>...
  refdata-build verify DIR
  refdata-build dem-tiles --rail FILE.geojsonseq
  refdata-build dem-sample --rail FILE.geojsonseq --dem DIR --out FILE
  refdata-build build --out DIR [--ld ZIP] [--cercanias ZIP] [--ouigo ZIP]
                      [--rail FILE.geojsonseq] [--date YYYY-MM-DD] [--days N]
                      [--rail-heights FILE] [--rail-attrs FILE]
                      [--stations FILE.geojson] [--network-geojson FILE]
                      [--sources FILE.tsv] [--report FILE.md]
                      [--gzip]
  refdata-build validate-net --rail FILE.geojsonseq --stations FILE.geojson
                      [--pairs FILE.tsv]... [--ld ZIP] [--date YYYY-MM-DD]
                      [--report FILE.md] [--csv FILE.csv]

build: writes stations.<hash>.bin, <region>.<hash>.bin and manifest.json to DIR.
  --date     service date the window is centred on (default: today, Madrid)
  --days     window length in days starting the day before --date (default 8)
  --sources  tab-separated name, url, etag, last-modified (from tools/fetch-gtfs.sh)
  --gzip     write gzip-compressed .bin.gz files (for deployment)
  --rail     OpenStreetMap railway=rail ways (from tools/fetch-osm-rail.sh), used to
             draw trips that have no usable GTFS shape (all of AV/LD/MD)
  --rail-heights  terrain heights of the --rail nodes (from dem-sample): adds a
             height profile to every OpenStreetMap leg, for gradients
  --rail-attrs  IGN railway links (from tools/fetch-igr-rail.py): adds the
             number of tracks and electrification to every OpenStreetMap leg
  --stations Renfe's estaciones.geojson (from tools/fetch-gtfs.sh): each station is
             anchored on the track (AV, conventional, metre gauge) and the network
             file rail.<hash>.bin is cut there; trains start and stop at the anchors
  --network-geojson  also write the network and the anchors as GeoJSON (to check)

validate-net: for every pair of consecutive stops (live trains collected by
  tools/collect-renfe-ld.py, and the AV/LD/MD timetable with --ld), checks there
  is a track path no longer than 1.5 x the straight distance; lists the failures.

dem-tiles: prints the URLs of the Copernicus DEM tiles covering the rail nodes.
dem-sample: looks up every rail node in the tiles in DIR (<name>.tif) and writes
  lines of \"lat_e7 lon_e7 height_dm\".
";

struct BuildArgs {
    out: PathBuf,
    ld: Option<PathBuf>,
    cercanias: Option<PathBuf>,
    ouigo: Option<PathBuf>,
    /// Network Rail SCHEDULE (JSON lines, .gz or plain) and NaPTAN CSV: the UK.
    uk_schedule: Option<PathBuf>,
    naptan: Option<PathBuf>,
    /// Network Rail CORPUS (JSON, .gz or plain): sibling TIPLOCs of a station.
    corpus: Option<PathBuf>,
    rail: Option<PathBuf>,
    rail_heights: Option<PathBuf>,
    rail_attrs: Option<PathBuf>,
    stations: Option<PathBuf>,
    network_geojson: Option<PathBuf>,
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
        uk_schedule: None,
        naptan: None,
        corpus: None,
        rail: None,
        rail_heights: None,
        rail_attrs: None,
        stations: None,
        network_geojson: None,
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
            "--rail-heights" => a.rail_heights = Some(val()?.into()),
            "--rail-attrs" => a.rail_attrs = Some(val()?.into()),
            "--stations" => a.stations = Some(val()?.into()),
            "--network-geojson" => a.network_geojson = Some(val()?.into()),
            "--ouigo" => a.ouigo = Some(val()?.into()),
            "--uk-schedule" => a.uk_schedule = Some(val()?.into()),
            "--naptan" => a.naptan = Some(val()?.into()),
            "--corpus" => a.corpus = Some(val()?.into()),
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
    if a.ld.is_none() && a.cercanias.is_none() && a.ouigo.is_none() && a.uk_schedule.is_none() {
        return Err("give --ld, --cercanias and/or --ouigo, or --uk-schedule".into());
    }
    if a.uk_schedule.is_some() != a.naptan.is_some() {
        return Err("--uk-schedule and --naptan go together".into());
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

    let mut heights_note = None;
    let graph = match &a.rail {
        Some(p) => {
            let mut g = read_graph(p)?;
            if let Some(h) = &a.rail_heights {
                let f = std::fs::File::open(h).map_err(|e| format!("{}: {e}", h.display()))?;
                let terrain = dem::read_heights(std::io::BufReader::new(f))?;
                let (known, filled) = g.set_heights(&terrain);
                let note = format!(
                    "{known} of {} rail nodes have a terrain height (Copernicus DEM); \
                     {filled} in tunnels or on bridges interpolated between their ends",
                    g.node_count()
                );
                eprintln!("{note}");
                heights_note = Some(note);
            } else {
                eprintln!("no --rail-heights: legs get no height profile");
            }
            Some(g)
        }
        None => None,
    };
    // Anchor the Renfe stations on the track (cutting it there) before any
    // routing, so trains start and stop at the anchors.
    let mut net_report = String::new();
    let mut anchored = None;
    let mut graph = graph;
    if let Some(g) = graph.as_mut() {
        net_report.push_str(&network_note(g));
        if let Some(p) = &a.stations {
            let stations = railnet::read_stations(&std::fs::read_to_string(p)?)?;
            let r = g.anchor_stations(&stations);
            net_report.push_str(&r.markdown(stations.len()));
            anchored = Some((stations, r));
        }
    }
    let graph = graph;
    let mut router = graph.as_ref().map(osm::Router::new);

    type Built = (
        RegionRec,
        TimetableFile,
        Vec<(ShapeRec, LegInfo, Profile)>,
        build::RegionStats,
    );
    let mut built: Vec<Built> = Vec::new();
    let mut report = String::new();
    for (path, kind) in [
        (&a.ld, "ld"),
        (&a.cercanias, "cercanias"),
        (&a.ouigo, "ouigo"),
        (&a.uk_schedule, "uk"),
    ] {
        let Some(path) = path else { continue };
        let commuter = kind == "cercanias";
        if kind == "uk" {
            // Network Rail: one region for Great Britain (plan 3, phase 3b).
            let naptan_path = a.naptan.as_ref().ok_or("--naptan missing")?;
            let naptan = nrsched::read_naptan(
                std::fs::File::open(naptan_path)
                    .map_err(|e| format!("{}: {e}", naptan_path.display()))?,
            )?;
            let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
            let reader: Box<dyn std::io::BufRead> = if path.extension().is_some_and(|x| x == "gz") {
                Box::new(std::io::BufReader::with_capacity(
                    1 << 20,
                    flate2::read::MultiGzDecoder::new(file),
                ))
            } else {
                Box::new(std::io::BufReader::with_capacity(1 << 20, file))
            };
            let corpus = match &a.corpus {
                Some(p) => {
                    let f = std::fs::File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
                    let r: Box<dyn std::io::Read> = if p.extension().is_some_and(|x| x == "gz") {
                        Box::new(flate2::read::MultiGzDecoder::new(f))
                    } else {
                        Box::new(f)
                    };
                    Some(nrsched::read_corpus(std::io::BufReader::new(r))?)
                }
                None => None,
            };
            let (feed, st) = nrsched::load(reader, &naptan, corpus.as_ref(), &window)?;
            report.push_str(&format!(
                "- `{}` (Network Rail): {} schedules, {} in window, {} passenger trips; {} cancelled \
                 train-days; {} public calls, {} at {} TIPLOCs without NaPTAN coordinates; {} stations \
                 ({} NaPTAN rail stations)\n",
                path.display(),
                st.schedules,
                st.in_window,
                st.passenger_trips,
                st.cancelled_days,
                st.calls,
                st.calls_unplaced,
                st.unplaced_tiplocs,
                st.stations,
                naptan.len()
            ));
            report.push_str(&format!(
                "  - {} calls placed at a sibling TIPLOC (same STANOX in CORPUS). Unplaced, most calls first: {}\n",
                st.calls_via_corpus,
                st.top_unplaced
                    .iter()
                    .map(|(t, n, c)| format!("`{t}` {n} ({c})"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            eprintln!("{report}");
            let trips: Vec<&load::Trip> = feed.trips.iter().collect();
            let (mut tt, legs, rs) =
                build_timetable(&feed, &trips, build::UK, header.clone(), router.as_mut());
            tt.operator = "National Rail".into();
            let rec = RegionRec {
                code: build::UK.into(),
                name: "Great Britain".into(),
                bbox_e5: bbox_e5(&tt),
            };
            built.push((rec, tt, legs, rs));
            continue;
        }
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
    if let Some(p) = &a.rail_attrs {
        let f = std::fs::File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
        let attrs = igr::TrackAttrs::from_lines(std::io::BufReader::new(f))?;
        let (mut legs, mut tracks, mut elec, mut single) = (0, 0, 0, 0);
        for b in &mut built {
            for (shape, info, _) in &mut b.2 {
                (info.tracks, info.electrified) = attrs.along(&shape.points());
                legs += 1;
                tracks += usize::from(info.tracks > 0);
                single += usize::from(info.tracks == 1);
                elec += usize::from(info.electrified > 0);
            }
        }
        let note = format!(
            "- IGN network (IGR-RT): {} link segments; of {legs} legs, {tracks} have a track \
             count ({single} single track) and {elec} know their electrification\n",
            attrs.len()
        );
        eprint!("{note}");
        report.push_str(&note);
    }
    for b in &built {
        if b.0.code == LONG_DISTANCE || b.1.operator != "Renfe" || b.3.jumps.is_empty() {
            continue;
        }
        report.push_str(&format!(
            "- ⚠ {}: stops or shape points far apart (bad data?), over {} km:\n",
            b.0.code,
            build::JUMP_M / 1000.0
        ));
        for j in &b.3.jumps {
            report.push_str(&format!("  - {j}\n"));
        }
    }
    if let Some(n) = &heights_note {
        let with: usize = built.iter().map(|b| b.3.legs_with_profile).sum();
        report.push_str(&format!(
            "- Heights: {n}; {with} legs have a height profile\n"
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
            let (mut shapes, mut info, mut profiles) = (Vec::new(), Vec::new(), Vec::new());
            for (s, i, p) in legs {
                shapes.push(s);
                info.push(i);
                profiles.push(p);
            }
            let g = GeometryFile {
                header: tt.header.clone(),
                region: rec.code.clone(),
                legs: shapes,
                info,
                profiles,
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

    let network = match &graph {
        Some(g) => {
            let sections = g.sections(railnet::NET_SIMPLIFY_M);
            let (shapes, info): (Vec<ShapeRec>, Vec<SectionInfo>) = sections
                .iter()
                .map(|s| {
                    (
                        ShapeRec::encode(String::new(), &s.pts),
                        SectionInfo {
                            kind: s.kind.code(),
                            mixed: s.mixed,
                            disused: s.disused,
                            gauge_mm: s.gauge_mm,
                            max_kmh: s.max_kmh,
                        },
                    )
                })
                .unzip();
            let nf = NetworkFile {
                header: window_header(&window, generated_at),
                sections: shapes,
                info,
            };
            let nb = encode(&nf)?;
            let km = |k: railnet::Kind| -> f64 {
                sections
                    .iter()
                    .filter(|s| s.kind == k)
                    .map(|s| trainradar_proto::geo::Polyline::new(s.pts.clone()).length_m())
                    .sum::<f64>()
                    / 1000.0
            };
            net_report.push_str(&format!(
                "- Network: {} sections, {:.0} km AV, {:.0} km conventional, {:.0} km metre gauge \
                 (each track counted), {} points\n",
                sections.len(),
                km(railnet::Kind::Av),
                km(railnet::Kind::Conv),
                km(railnet::Kind::Metric),
                sections.iter().map(|s| s.pts.len()).sum::<usize>()
            ));
            if let Some(p) = &a.network_geojson {
                let empty = (Vec::new(), railnet::AnchorReport::default());
                let (st, r) = anchored.as_ref().unwrap_or(&empty);
                std::fs::write(p, railnet::debug_geojson(&sections, st, r, g))?;
            }
            Some(FileEntry {
                file: write_hashed(&a.out, "rail", &nb, a.gzip)?,
                bytes: nb.len(),
            })
        }
        None => None,
    };
    report.push_str(&net_report);

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
        network,
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

fn read_graph(p: &Path) -> Result<osm::RailGraph> {
    let f = std::fs::File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let g = osm::RailGraph::from_geojsonseq(std::io::BufReader::new(f))?;
    eprintln!("rail graph: {} nodes", g.node_count());
    Ok(g)
}

/// `--name value` pairs for the small subcommands.
fn flags<'a>(args: &'a [String], names: &[&str]) -> Result<Vec<&'a str>> {
    let mut out = vec![None; names.len()];
    for pair in args.chunks(2) {
        let i = names
            .iter()
            .position(|n| *n == pair[0])
            .ok_or_else(|| format!("unknown option {}", pair[0]))?;
        out[i] = Some(pair.get(1).ok_or("missing value")?.as_str());
    }
    out.into_iter()
        .zip(names)
        .map(|(v, n)| v.ok_or_else(|| format!("missing {n}").into()))
        .collect()
}

fn dem_tiles(args: &[String]) -> Result<()> {
    let f = flags(args, &["--rail"])?;
    let g = read_graph(Path::new(f[0]))?;
    for (lat, lon) in dem::tiles_for(g.nodes().iter().copied()) {
        let name = dem::tile_name(lat, lon);
        println!("{}/{name}/{name}.tif", dem::BASE_URL);
    }
    Ok(())
}

fn dem_sample(args: &[String]) -> Result<()> {
    let f = flags(args, &["--rail", "--dem", "--out"])?;
    let g = read_graph(Path::new(f[0]))?;
    let (done, missing) = dem::sample(g.nodes(), Path::new(f[1]), Path::new(f[2]))?;
    eprintln!("heights: {done} nodes, {missing} without a tile or with no data");
    Ok(())
}

/// `validate-net`: check the track network against real pairs of stops.
fn validate_net(args: &[String]) -> Result<()> {
    use std::collections::{BTreeMap, HashMap};
    let (mut rail, mut stations, mut ld, mut date, mut report, mut csv) =
        (None, None, None, None, None, None);
    let mut pair_files = Vec::new();
    for pair in args.chunks(2) {
        let v = pair.get(1).ok_or("missing value")?.clone();
        match pair[0].as_str() {
            "--rail" => rail = Some(v),
            "--stations" => stations = Some(v),
            "--pairs" => pair_files.push(v),
            "--ld" => ld = Some(v),
            "--date" => date = Some(v),
            "--report" => report = Some(v),
            "--csv" => csv = Some(v),
            other => return Err(format!("unknown option {other}").into()),
        }
    }
    let mut g = read_graph(Path::new(&rail.ok_or("missing --rail")?))?;
    let st = railnet::read_stations(&std::fs::read_to_string(
        stations.ok_or("missing --stations")?,
    )?)?;
    let anchors = g.anchor_stations(&st);
    let mut names: HashMap<String, String> = st
        .iter()
        .map(|s| (s.code.clone(), s.name.clone()))
        .collect();
    let mut pairs = BTreeMap::new();
    for p in &pair_files {
        netcheck::read_pairs(&std::fs::read_to_string(p)?, &mut pairs);
    }
    let mut extra = HashMap::new();
    if let Some(z) = ld {
        let today = match &date {
            Some(d) => parse_date(d).ok_or("bad --date")?,
            None => (now_unix() + 3600).div_euclid(86_400),
        };
        let window = Window {
            start: today - 1,
            days: 8,
        };
        let feed = load::load(&mut Gtfs::open(Path::new(&z))?, &window)?;
        for s in &feed.stops {
            extra.insert(s.id.clone(), s.coord);
            names.entry(s.id.clone()).or_insert_with(|| s.name.clone());
        }
        for t in &feed.trips {
            for w in t.stop_times.windows(2) {
                let (a, b) = (&feed.stops[w[0].0].id, &feed.stops[w[1].0].id);
                if a == b {
                    continue;
                }
                let s = pairs.entry(netcheck::key(a, b)).or_default();
                s.timetable = true;
                if s.trains.len() < 5
                    && !t.short_name.is_empty()
                    && !s.trains.contains(&t.short_name)
                {
                    s.trains.push(t.short_name.clone());
                }
            }
        }
    }
    let checked = netcheck::check(&g, &st, &extra, &pairs);
    let md = netcheck::markdown(&checked, &names);
    let md = md.replacen(
        "\n\n| Pairs",
        &format!(
            "\n\n{}{}\n| Pairs",
            network_note(&g),
            anchors.markdown(st.len())
        ),
        1,
    );
    let summary_end = md.find("## Failing").unwrap_or(md.len());
    print!("{}", &md[..summary_end]);
    if let Some(p) = report {
        std::fs::write(p, &md)?;
    }
    if let Some(p) = csv {
        std::fs::write(p, netcheck::csv(&checked, &names))?;
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("validate-net") => validate_net(&args[1..]),
        Some("inspect") if args.len() > 1 => args[1..]
            .iter()
            .try_for_each(|p| inspect::run(&PathBuf::from(p))),
        Some("verify") if args.len() == 2 => verify::run(Path::new(&args[1])),
        Some("dem-tiles") => dem_tiles(&args[1..]),
        Some("dem-sample") => dem_sample(&args[1..]),
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
