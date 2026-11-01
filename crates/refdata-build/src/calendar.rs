//! Dates, times and service calendars, without a date library.

use crate::gtfs_io::Table;
use std::collections::HashMap;

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = i64::from((m + 9) % 12);
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// (year, month, day) for days since 1970-01-01.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// 0 = Monday … 6 = Sunday.
pub fn weekday(day: i64) -> usize {
    // 1970-01-01 was a Thursday (3).
    (day + 3).rem_euclid(7) as usize
}

/// Parse `YYYYMMDD` or `YYYY-MM-DD`.
pub fn parse_date(s: &str) -> Option<i64> {
    let digits: String = s.chars().filter(char::is_ascii_digit).collect();
    if digits.len() != 8 {
        return None;
    }
    let y = digits[..4].parse().ok()?;
    let m = digits[4..6].parse().ok()?;
    let d = digits[6..].parse().ok()?;
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then(|| days_from_civil(y, m, d))
}

pub fn format_date(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Parse GTFS `H:MM:SS` (hours may exceed 24 and may not be zero-padded).
pub fn parse_time(s: &str) -> Option<u32> {
    let mut it = s.trim().split(':');
    let h: u32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let sec: u32 = it.next()?.parse().ok()?;
    (it.next().is_none() && m < 60 && sec < 60).then_some(h * 3600 + m * 60 + sec)
}

/// Days a service runs within the window, as a bitmask (bit n = start + n).
#[derive(Debug)]
pub struct Window {
    pub start: i64,
    pub days: u8,
}

impl Window {
    pub fn service_masks(
        &self,
        calendar: Option<&Table>,
        dates: Option<&Table>,
    ) -> HashMap<String, u16> {
        let mut masks: HashMap<String, u16> = HashMap::new();
        if let Some(t) = calendar {
            let id = t.col("service_id");
            let wd: Vec<_> = [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ]
            .iter()
            .map(|d| t.col(d))
            .collect();
            let (sc, ec) = (t.col("start_date"), t.col("end_date"));
            for r in &t.rows {
                let (Some(s), Some(e)) = (parse_date(t.get(r, sc)), parse_date(t.get(r, ec)))
                else {
                    continue;
                };
                let mut mask = 0u16;
                for n in 0..self.days {
                    let day = self.start + i64::from(n);
                    if day >= s && day <= e && t.get(r, wd[weekday(day)]) == "1" {
                        mask |= 1 << n;
                    }
                }
                *masks.entry(t.get(r, id).to_owned()).or_default() |= mask;
            }
        }
        if let Some(t) = dates {
            let (id, dc, ec) = (t.col("service_id"), t.col("date"), t.col("exception_type"));
            for r in &t.rows {
                let Some(day) = parse_date(t.get(r, dc)) else {
                    continue;
                };
                let n = day - self.start;
                if !(0..i64::from(self.days)).contains(&n) {
                    continue;
                }
                let m = masks.entry(t.get(r, id).to_owned()).or_default();
                match t.get(r, ec) {
                    "1" => *m |= 1 << n,
                    "2" => *m &= !(1 << n),
                    _ => {}
                }
            }
        }
        masks
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_round_trip_and_weekday() {
        let d = parse_date("20261101").unwrap();
        assert_eq!(format_date(d), "2026-11-01");
        assert_eq!(weekday(d), 6, "1 Nov 2026 is a Sunday");
        assert_eq!(
            parse_date("2024-02-29").map(format_date).unwrap(),
            "2024-02-29"
        );
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert!(parse_date("2026-13-01").is_none());
    }

    #[test]
    fn parses_unpadded_and_overnight_times() {
        assert_eq!(parse_time("8:30:00"), Some(8 * 3600 + 30 * 60));
        assert_eq!(parse_time(" 25:09:00 "), Some(25 * 3600 + 9 * 60));
        assert_eq!(parse_time("8:60:00"), None);
        assert_eq!(parse_time(""), None);
    }

    #[test]
    fn service_masks_apply_calendar_and_exceptions() {
        let cal = Table::parse(
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n\
             WK,1,1,1,1,1,0,0,20261026,20261231\n\
             SUN,0,0,0,0,0,0,1,20261101,20261101\n",
        )
        .unwrap();
        let dates = Table::parse(
            "service_id,date,exception_type\nWK,20261102,2\nEXTRA,20261101,1\nWK,20270101,1\n",
        )
        .unwrap();
        // Window: Sat 31 Oct .. Fri 6 Nov.
        let w = Window {
            start: parse_date("20261031").unwrap(),
            days: 7,
        };
        let m = w.service_masks(Some(&cal), Some(&dates));
        assert_eq!(m["SUN"], 0b0000010);
        assert_eq!(m["EXTRA"], 0b0000010);
        // Weekdays Tue–Fri (Mon 2 Nov removed).
        assert_eq!(m["WK"], 0b1111000);
    }
}
