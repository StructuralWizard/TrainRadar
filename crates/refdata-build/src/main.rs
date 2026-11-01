//! `refdata-build`: Renfe static GTFS → compact pre-indexed `.bin` files.
//!
//! Runs natively in CI, never in the browser.

mod gtfs_io;
mod inspect;

use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
usage:
  refdata-build inspect <file.zip|file.csv>...
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("inspect") if args.len() > 1 => args[1..]
            .iter()
            .try_for_each(|p| inspect::run(&PathBuf::from(p))),
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
