//! Reading GTFS zips and CSV files: tolerant of Renfe quirks (padding spaces,
//! UTF-8 BOM, Latin-1 encoding).

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

pub type Error = Box<dyn std::error::Error>;
pub type Result<T> = std::result::Result<T, Error>;

/// Decode bytes as UTF-8, falling back to Latin-1 (every byte is a char).
pub fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

/// A parsed CSV table with named columns. Values are trimmed.
#[derive(Debug, Default)]
pub struct Table {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    index: HashMap<String, usize>,
}

impl Table {
    pub fn parse(text: &str) -> Result<Self> {
        Self::parse_with(text, b',')
    }

    pub fn parse_with(text: &str, delimiter: u8) -> Result<Self> {
        let mut rdr = csv::ReaderBuilder::new()
            .delimiter(delimiter)
            .trim(csv::Trim::All)
            .flexible(true)
            .from_reader(text.as_bytes());
        let headers: Vec<String> = rdr
            .headers()?
            .iter()
            .map(|h| h.trim().to_ascii_lowercase())
            .collect();
        let index = headers
            .iter()
            .enumerate()
            .map(|(i, h)| (h.clone(), i))
            .collect();
        let mut rows = Vec::new();
        for rec in rdr.records() {
            let rec = rec?;
            if rec.iter().all(str::is_empty) {
                continue;
            }
            rows.push(rec.iter().map(str::to_owned).collect());
        }
        Ok(Self {
            headers,
            rows,
            index,
        })
    }

    pub fn col(&self, name: &str) -> Option<usize> {
        self.index.get(name).copied()
    }

    /// Column index, or an error naming the missing column.
    pub fn require(&self, file: &str, name: &str) -> Result<usize> {
        self.col(name)
            .ok_or_else(|| format!("{file}: missing required column `{name}`").into())
    }

    /// Value in `row` at optional column `c` (empty string if absent).
    pub fn get<'a>(&self, row: &'a [String], c: Option<usize>) -> &'a str {
        c.and_then(|i| row.get(i)).map_or("", String::as_str)
    }
}

/// An opened GTFS feed: file name → decoded text, loaded lazily.
pub struct Gtfs<R: Read + Seek> {
    zip: zip::ZipArchive<R>,
}

impl Gtfs<File> {
    pub fn open(path: &Path) -> Result<Self> {
        let f = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Self {
            zip: zip::ZipArchive::new(f)?,
        })
    }
}

impl<R: Read + Seek> Gtfs<R> {
    pub fn from_reader(r: R) -> Result<Self> {
        Ok(Self {
            zip: zip::ZipArchive::new(r)?,
        })
    }

    /// File names in the archive with their uncompressed sizes.
    pub fn files(&mut self) -> Result<Vec<(String, u64)>> {
        let mut out = Vec::new();
        for i in 0..self.zip.len() {
            let f = self.zip.by_index(i)?;
            out.push((f.name()?.into_owned(), f.size()));
        }
        Ok(out)
    }

    /// Find a file by base name, ignoring any folder prefix inside the zip.
    fn find(&mut self, name: &str) -> Option<String> {
        self.zip
            .file_names()
            .filter_map(|n| n.ok())
            .find(|n| n.rsplit('/').next() == Some(name))
            .map(|n| n.into_owned())
    }

    pub fn has(&mut self, name: &str) -> bool {
        self.find(name).is_some()
    }

    pub fn text(&mut self, name: &str) -> Result<Option<String>> {
        let Some(full) = self.find(name) else {
            return Ok(None);
        };
        let mut f = self.zip.by_name(&full)?;
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf)?;
        Ok(Some(decode_text(&buf)))
    }

    pub fn table(&mut self, name: &str) -> Result<Option<Table>> {
        match self.text(name)? {
            Some(t) => Ok(Some(Table::parse(&t)?)),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_latin1_and_strips_bom() {
        assert_eq!(decode_text(b"\xEF\xBB\xBFabc"), "abc");
        assert_eq!(decode_text(b"Le\xF3n"), "León");
        assert_eq!(decode_text("León".as_bytes()), "León");
    }

    #[test]
    fn parses_padded_csv() {
        let t = Table::parse("Stop_ID , stop_name\n 001 ,  Atocha \n\n").unwrap();
        assert_eq!(t.headers, ["stop_id", "stop_name"]);
        assert_eq!(t.rows, [["001", "Atocha"]]);
        assert_eq!(t.get(&t.rows[0], t.col("stop_name")), "Atocha");
        assert!(t.require("stops.txt", "stop_lat").is_err());
    }
}
