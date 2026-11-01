//! `refdata-build`: Renfe static GTFS → compact pre-indexed `.bin` files.
//!
//! Runs natively in CI, never in the browser. Implemented in phase A2.

use std::process::ExitCode;

fn main() -> ExitCode {
    eprintln!(
        "refdata-build {} (format v{}): not implemented yet (phase A2)",
        env!("CARGO_PKG_VERSION"),
        trainradar_proto::FORMAT_VERSION
    );
    ExitCode::FAILURE
}
