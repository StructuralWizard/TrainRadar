//! Renfe train products grouped as the app shows them: high speed (AV),
//! long distance (LD) and medium distance (MD). Cercanías are their own
//! feed and OUIGO its own operator.

/// Product group of an AV/LD/MD train.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    /// AVE, AVLO, Avant (high-speed regional), Euromed.
    HighSpeed,
    /// Alvia, Intercity, Trenhotel and other long-distance services.
    LongDistance,
    /// MD, Regional, Regional Exprés, Proximidad and similar.
    MediumDistance,
}

/// Group of a Renfe product name (route short name in the AV/LD/MD GTFS,
/// e.g. `AVE`, `ALVIA`, `MD`, `REG.EXP.`). Unknown names count as long
/// distance, the feed's default.
pub fn group_of(name: &str) -> Group {
    let n = name.trim().to_uppercase();
    let starts = |p: &str| n.starts_with(p);
    if starts("AVE") || starts("AVLO") || starts("AVANT") || starts("EUROMED") || starts("AV ") {
        Group::HighSpeed
    } else if starts("MD")
        || starts("REG")
        || starts("R-")
        || starts("PROXIMIDAD")
        || starts("TRENCELTA")
        || starts("MEDIA")
    {
        Group::MediumDistance
    } else {
        Group::LongDistance
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups() {
        for n in ["AVE", "AVLO", "Avant", "AVE INT", "EUROMED"] {
            assert_eq!(group_of(n), Group::HighSpeed, "{n}");
        }
        for n in ["MD", "REGIONAL", "REG.EXP.", "Proximidad", "R-15"] {
            assert_eq!(group_of(n), Group::MediumDistance, "{n}");
        }
        for n in ["ALVIA", "INTERCITY", "TRENHOTEL", "", "IRYO?"] {
            assert_eq!(group_of(n), Group::LongDistance, "{n}");
        }
    }
}
