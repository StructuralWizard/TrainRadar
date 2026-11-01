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
