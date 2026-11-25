//! Calendar maths and the Europe/Madrid time zone, without a date library.
//!
//! GTFS times are "seconds since local noon minus 12 h" of the service date.
//! Madrid is CET (UTC+1) in winter and CEST (UTC+2) from the last Sunday of
//! March to the last Sunday of October, switching at 01:00 UTC (EU rule).

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
    (day + 3).rem_euclid(7) as usize // 1970-01-01 was a Thursday
}

/// Day number of the last Sunday of a month.
fn last_sunday(year: i64, month: u32) -> i64 {
    let next = if month == 12 {
        days_from_civil(year + 1, 1, 1)
    } else {
        days_from_civil(year, month + 1, 1)
    };
    let last = next - 1;
    last - ((weekday(last) as i64 + 1) % 7)
}

/// Madrid's UTC offset in seconds at a UTC instant.
pub fn madrid_offset(utc: i64) -> i64 {
    let (y, _, _) = civil_from_days(utc.div_euclid(86_400));
    let start = last_sunday(y, 3) * 86_400 + 3_600;
    let end = last_sunday(y, 10) * 86_400 + 3_600;
    if (start..end).contains(&utc) {
        7_200
    } else {
        3_600
    }
}

/// Local (Madrid) calendar day of a UTC instant.
pub fn madrid_day(utc: i64) -> i64 {
    (utc + madrid_offset(utc)).div_euclid(86_400)
}

/// UTC instant that GTFS time 0 refers to for a service date: local noon
/// minus 12 hours (differs from midnight on DST change days).
pub fn service_day_base(day: i64) -> i64 {
    let noon_guess = day * 86_400 + 11 * 3_600; // ≈ local noon in UTC
    day * 86_400 + 12 * 3_600 - madrid_offset(noon_guess) - 12 * 3_600
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(y: i64, m: u32, d: u32, h: i64, min: i64) -> i64 {
        days_from_civil(y, m, d) * 86_400 + h * 3_600 + min * 60
    }

    #[test]
    fn civil_round_trip() {
        let d = days_from_civil(2026, 11, 1);
        assert_eq!(civil_from_days(d), (2026, 11, 1));
        assert_eq!(weekday(d), 6, "1 Nov 2026 is a Sunday");
        assert_eq!(days_from_civil(1970, 1, 1), 0);
    }

    #[test]
    fn dst_switches_on_last_sundays() {
        // 2026: summer time 29 Mar 01:00 UTC – 25 Oct 01:00 UTC.
        assert_eq!(last_sunday(2026, 3), days_from_civil(2026, 3, 29));
        assert_eq!(last_sunday(2026, 10), days_from_civil(2026, 10, 25));
        assert_eq!(madrid_offset(utc(2026, 3, 29, 0, 59)), 3_600);
        assert_eq!(madrid_offset(utc(2026, 3, 29, 1, 0)), 7_200);
        assert_eq!(madrid_offset(utc(2026, 10, 25, 0, 59)), 7_200);
        assert_eq!(madrid_offset(utc(2026, 10, 25, 1, 0)), 3_600);
        assert_eq!(madrid_offset(utc(2026, 1, 15, 12, 0)), 3_600);
    }

    #[test]
    fn service_day_base_and_local_day() {
        // Winter: base = 23:00 UTC the day before.
        let d = days_from_civil(2026, 11, 1);
        assert_eq!(service_day_base(d), utc(2026, 10, 31, 23, 0));
        // Summer: base = 22:00 UTC the day before.
        let s = days_from_civil(2026, 7, 1);
        assert_eq!(service_day_base(s), utc(2026, 6, 30, 22, 0));
        // DST end day: local noon is CET, so base = 23:00 UTC (= 01:00 CEST).
        let e = days_from_civil(2026, 10, 25);
        assert_eq!(service_day_base(e), utc(2026, 10, 24, 23, 0));
        // 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Madrid.
        assert_eq!(madrid_day(utc(2026, 10, 31, 23, 30)), d);
    }
}

/// Day number of the first Sunday of a month.
fn first_sunday(year: i64, month: u32) -> i64 {
    let first = days_from_civil(year, month, 1);
    first + ((6 - weekday(first) as i64).rem_euclid(7))
}

/// A time zone the app's countries use, with its own clock rules: the EU's
/// (a fixed distance from Madrid all year), or one outside Europe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zone {
    /// Keeps the EU's summer-time dates: seconds behind Madrid, all year.
    Eu(i64),
    /// No summer time: the UTC offset in seconds (Singapore, Brisbane).
    Fixed(i64),
    /// South-eastern Australia (Sydney, Melbourne, Canberra, Hobart): UTC+10,
    /// +11 from the first Sunday of October to the first Sunday of April,
    /// switching at 02:00 standard time.
    AustraliaSouthEast,
    /// New Zealand: UTC+12, +13 from the last Sunday of September to the
    /// first Sunday of April, switching at 02:00 standard time.
    NewZealand,
}

impl Zone {
    /// The zone of an IANA name, for the zones the app supports.
    pub fn from_iana(tz: &str) -> Option<Zone> {
        Some(match tz {
            "Australia/Sydney"
            | "Australia/Melbourne"
            | "Australia/Canberra"
            | "Australia/Hobart"
            | "Australia/ACT"
            | "Australia/NSW"
            | "Australia/Victoria" => Zone::AustraliaSouthEast,
            "Australia/Brisbane" | "Australia/Queensland" => Zone::Fixed(10 * 3_600),
            "Pacific/Auckland" | "NZ" => Zone::NewZealand,
            "Asia/Singapore" | "Singapore" => Zone::Fixed(8 * 3_600),
            _ => return None,
        })
    }

    /// UTC offset in seconds at a UTC instant.
    pub fn utc_offset(self, utc: i64) -> i64 {
        match self {
            Zone::Eu(behind) => madrid_offset(utc) - behind,
            Zone::Fixed(o) => o,
            Zone::AustraliaSouthEast => {
                let std = 10 * 3_600;
                let (y, _, _) = civil_from_days((utc + std).div_euclid(86_400));
                let start = first_sunday(y, 10) * 86_400 + 2 * 3_600 - std;
                let end = first_sunday(y, 4) * 86_400 + 2 * 3_600 - std;
                if utc >= start || utc < end {
                    std + 3_600
                } else {
                    std
                }
            }
            Zone::NewZealand => {
                let std = 12 * 3_600;
                let (y, _, _) = civil_from_days((utc + std).div_euclid(86_400));
                let start = last_sunday(y, 9) * 86_400 + 2 * 3_600 - std;
                let end = first_sunday(y, 4) * 86_400 + 2 * 3_600 - std;
                if utc >= start || utc < end {
                    std + 3_600
                } else {
                    std
                }
            }
        }
    }

    /// Seconds the zone's clock is behind Madrid's at a UTC instant
    /// (negative: ahead).
    pub fn behind_madrid(self, utc: i64) -> i64 {
        match self {
            Zone::Eu(b) => b,
            _ => madrid_offset(utc) - self.utc_offset(utc),
        }
    }
}

#[cfg(test)]
mod zone_tests {
    use super::*;

    fn at(y: i64, m: u32, d: u32, h: i64) -> i64 {
        days_from_civil(y, m, d) * 86_400 + h * 3_600
    }

    #[test]
    fn sydney_changes_clocks_in_october_and_april() {
        let z = Zone::from_iana("Australia/Sydney").unwrap();
        // 2026: summer time ends Sunday 5 April at 03:00 local (16:00 UTC
        // on the 4th) and starts Sunday 4 October at 02:00 (16:00 UTC on
        // the 3rd).
        assert_eq!(z.utc_offset(at(2026, 4, 4, 15)), 11 * 3_600);
        assert_eq!(z.utc_offset(at(2026, 4, 4, 17)), 10 * 3_600);
        assert_eq!(z.utc_offset(at(2026, 10, 3, 15)), 10 * 3_600);
        assert_eq!(z.utc_offset(at(2026, 10, 3, 17)), 11 * 3_600);
        // Madrid winter, Sydney summer: 10 hours ahead; Madrid summer,
        // Sydney winter: 8 hours ahead.
        assert_eq!(z.behind_madrid(at(2026, 12, 1, 0)), 3_600 - 11 * 3_600);
        assert_eq!(z.behind_madrid(at(2026, 7, 1, 0)), 7_200 - 10 * 3_600);
    }

    #[test]
    fn new_zealand_and_fixed_zones() {
        let nz = Zone::from_iana("Pacific/Auckland").unwrap();
        // 2026: ends Sunday 5 April 03:00 local (14:00 UTC on the 4th),
        // starts Sunday 27 September 02:00 (14:00 UTC on the 26th).
        assert_eq!(nz.utc_offset(at(2026, 4, 4, 13)), 13 * 3_600);
        assert_eq!(nz.utc_offset(at(2026, 4, 4, 15)), 12 * 3_600);
        assert_eq!(nz.utc_offset(at(2026, 9, 26, 13)), 12 * 3_600);
        assert_eq!(nz.utc_offset(at(2026, 9, 26, 15)), 13 * 3_600);
        let sg = Zone::from_iana("Asia/Singapore").unwrap();
        assert_eq!(sg.utc_offset(at(2026, 7, 1, 0)), 8 * 3_600);
        assert_eq!(Zone::Eu(3_600).behind_madrid(0), 3_600);
        assert_eq!(Zone::from_iana("America/New_York"), None);
    }
}
