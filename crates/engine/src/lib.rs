//! TrainRadar engine, compiled to WebAssembly and run in the browser.
//!
//! Phase A1 only sets up the crate layout: the [`source::SourceAdapter`]
//! trait that keeps Renfe-specific parsing separate, and the map stats.
//! Feed decoding, trip matching and interpolation arrive in phase A3.

pub mod source;
pub mod stats;

use wasm_bindgen::prelude::*;

/// Engine version, for the "about" panel and cache busting.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Map colour band for a delay in seconds: 0 = on time / <5 min,
/// 1 = 5–14 min, 2 = 15+ min.
#[wasm_bindgen(js_name = delayClass)]
pub fn delay_class(delay_secs: i32) -> u8 {
    use trainradar_proto::{Delay, DelayClass};
    match Delay(delay_secs).class() {
        DelayClass::OnTime => 0,
        DelayClass::Minor => 1,
        DelayClass::Major => 2,
    }
}
