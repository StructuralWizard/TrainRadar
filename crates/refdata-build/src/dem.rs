//! Terrain elevation from the Copernicus DEM (GLO-30), for track gradients.
//!
//! CI downloads only the 1°×1° tiles that contain rail nodes
//! (`refdata-build dem-tiles`), looks up every OSM rail node's height once
//! (`refdata-build dem-sample`) and caches that small result. The DEM gives
//! the *terrain* height, so tunnels and bridges are bridged over later, from
//! their portals (see `osm.rs`).
//!
//! Copernicus DEM: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014
//! and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by
//! the European Union and ESA; all rights reserved.

use crate::gtfs_io::Result;
use std::collections::BTreeMap;
use std::io::{BufRead, BufWriter, Write};
use std::path::Path;
use trainradar_proto::LatLon;

/// Public bucket (AWS Open Data) holding the Copernicus GLO-30 COG tiles.
pub const BASE_URL: &str = "https://copernicus-dem-30m.s3.amazonaws.com";

/// Copernicus tile name for the 1° cell whose south-west corner is (lat, lon).
pub fn tile_name(lat: i32, lon: i32) -> String {
    let ns = if lat >= 0 { 'N' } else { 'S' };
    let ew = if lon >= 0 { 'E' } else { 'W' };
    format!(
        "Copernicus_DSM_COG_10_{ns}{:02}_00_{ew}{:03}_00_DEM",
        lat.abs(),
        lon.abs()
    )
}

pub fn cell_of(p: LatLon) -> (i32, i32) {
    (p.lat.floor() as i32, p.lon.floor() as i32)
}

/// One decoded tile: rows north→south, columns west→east.
pub struct Tile {
    lat0: i32,
    lon0: i32,
    w: usize,
    h: usize,
    z: Vec<f32>,
}

impl Tile {
    pub fn read(path: &Path, lat0: i32, lon0: i32) -> Result<Self> {
        let f = std::io::BufReader::new(std::fs::File::open(path)?);
        let mut d = tiff::decoder::Decoder::new(f)?;
        let (w, h) = d.dimensions()?;
        let z = match d.read_image()? {
            tiff::decoder::DecodingResult::F32(v) => v,
            _ => return Err(format!("{}: not a float32 DEM", path.display()).into()),
        };
        Ok(Self {
            lat0,
            lon0,
            w: w as usize,
            h: h as usize,
            z,
        })
    }

    /// Bilinear terrain height in metres, or `None` for no-data.
    pub fn height(&self, p: LatLon) -> Option<f32> {
        // Pixel centres: Copernicus tiles are pixel-is-point on a 1/w° grid
        // starting at the north-west corner.
        let x = (p.lon - f64::from(self.lon0)) * self.w as f64;
        let y = (f64::from(self.lat0) + 1.0 - p.lat) * self.h as f64;
        let (x0, y0) = (x.floor().max(0.0) as usize, y.floor().max(0.0) as usize);
        let (x1, y1) = ((x0 + 1).min(self.w - 1), (y0 + 1).min(self.h - 1));
        let (fx, fy) = ((x - x0 as f64) as f32, (y - y0 as f64) as f32);
        let at = |c: usize, r: usize| {
            let v = self.z[r.min(self.h - 1) * self.w + c.min(self.w - 1)];
            (v > -500.0 && v < 9000.0).then_some(v)
        };
        let (a, b, c, d) = (at(x0, y0)?, at(x1, y0)?, at(x0, y1)?, at(x1, y1)?);
        let top = a + (b - a) * fx;
        let bottom = c + (d - c) * fx;
        Some(top + (bottom - top) * fy)
    }
}

/// Tiles needed for a set of points.
pub fn tiles_for(points: impl Iterator<Item = LatLon>) -> Vec<(i32, i32)> {
    let mut cells: Vec<(i32, i32)> = points.map(cell_of).collect();
    cells.sort_unstable();
    cells.dedup();
    cells
}

/// Heights of `points` from the tiles in `dir` (`<tile_name>.tif`), as
/// lines "lat_e7 lon_e7 height_dm". Points in missing tiles are skipped.
pub fn sample(points: &[LatLon], dir: &Path, out: &Path) -> Result<(usize, usize)> {
    let mut by_tile: BTreeMap<(i32, i32), Vec<LatLon>> = BTreeMap::new();
    for &p in points {
        by_tile.entry(cell_of(p)).or_default().push(p);
    }
    let mut w = BufWriter::new(std::fs::File::create(out)?);
    let (mut done, mut missing) = (0, 0);
    for ((lat, lon), pts) in by_tile {
        let path = dir.join(format!("{}.tif", tile_name(lat, lon)));
        if !path.exists() {
            missing += pts.len();
            continue;
        }
        let tile = Tile::read(&path, lat, lon)?;
        for p in pts {
            match tile.height(p) {
                Some(h) => {
                    writeln!(
                        w,
                        "{} {} {}",
                        (p.lat * 1e7).round() as i64,
                        (p.lon * 1e7).round() as i64,
                        (h * 10.0).round() as i32
                    )?;
                    done += 1;
                }
                None => missing += 1,
            }
        }
    }
    w.flush()?;
    Ok((done, missing))
}

/// Read a `sample` output: coordinate key (e7) → height in metres.
pub fn read_heights(r: impl BufRead) -> Result<std::collections::HashMap<(i64, i64), f32>> {
    let mut m = std::collections::HashMap::new();
    for line in r.lines() {
        let line = line?;
        let mut it = line.split_whitespace();
        let (Some(a), Some(b), Some(c)) = (it.next(), it.next(), it.next()) else {
            continue;
        };
        m.insert((a.parse()?, b.parse()?), c.parse::<f32>()? / 10.0);
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_names() {
        assert_eq!(
            tile_name(40, -4),
            "Copernicus_DSM_COG_10_N40_00_W004_00_DEM"
        );
        assert_eq!(tile_name(41, 2), "Copernicus_DSM_COG_10_N41_00_E002_00_DEM");
        assert_eq!(cell_of(LatLon::new(40.4, -3.7)), (40, -4));
        assert_eq!(
            tiles_for([LatLon::new(40.4, -3.7), LatLon::new(40.9, -3.1)].into_iter()),
            [(40, -4)]
        );
    }

    #[test]
    fn bilinear_height_and_no_data() {
        // 3×3 tile rising 10 m per column eastwards, one no-data pixel.
        let t = Tile {
            lat0: 40,
            lon0: -4,
            w: 3,
            h: 3,
            z: vec![0.0, 10.0, 20.0, 0.0, 10.0, 20.0, 0.0, 10.0, -32767.0],
        };
        let h = t.height(LatLon::new(40.9, -4.0 + 0.5 / 3.0)).unwrap();
        assert!((h - 5.0).abs() < 0.01, "{h}");
        assert!(t.height(LatLon::new(40.05, -3.05)).is_none());
    }

    #[test]
    fn heights_file_round_trip() {
        let m = read_heights("404065000 -36895000 6296\nbad\n".as_bytes()).unwrap();
        assert_eq!(m[&(404_065_000, -36_895_000)], 629.6);
    }
}
