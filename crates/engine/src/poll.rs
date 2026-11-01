//! When to fetch each feed next: never faster than the feed refreshes, with
//! jitter so clients don't fetch in lockstep, exponential backoff on errors,
//! and no polling at all while the tab is hidden.
//!
//! The browser does the fetching; this only decides the timing, so it can be
//! unit tested.

/// Longest wait after repeated failures.
pub const MAX_BACKOFF_SECS: u32 = 600;
/// ± fraction of the interval added as random jitter.
pub const JITTER: f64 = 0.1;

#[derive(Debug, Clone, PartialEq)]
pub struct Poller {
    interval_secs: u32,
    failures: u32,
    hidden: bool,
}

impl Poller {
    pub fn new(interval_secs: u32) -> Self {
        Self {
            interval_secs: interval_secs.max(1),
            failures: 0,
            hidden: false,
        }
    }

    pub fn success(&mut self) {
        self.failures = 0;
    }

    pub fn failure(&mut self) {
        self.failures = self.failures.saturating_add(1);
    }

    pub fn set_hidden(&mut self, hidden: bool) {
        self.hidden = hidden;
    }

    pub fn failures(&self) -> u32 {
        self.failures
    }

    /// Milliseconds until the next fetch, or `None` while hidden (resume by
    /// calling `set_hidden(false)` and fetching right away). `random` is a
    /// uniform number in [0, 1), e.g. from `Math.random()`.
    pub fn next_delay_ms(&self, random: f64) -> Option<u32> {
        if self.hidden {
            return None;
        }
        let base = f64::from(self.interval_secs);
        let backoff = if self.failures == 0 {
            base
        } else {
            (base * 2f64.powi(self.failures.min(16) as i32)).min(f64::from(MAX_BACKOFF_SECS))
        };
        let jitter = 1.0 + JITTER * (2.0 * random.clamp(0.0, 1.0) - 1.0);
        // Jitter only upwards from the feed interval: never poll faster.
        let secs = (backoff * jitter).max(base);
        Some((secs * 1000.0).round() as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_faster_than_the_interval() {
        let p = Poller::new(30);
        assert_eq!(p.next_delay_ms(0.0), Some(30_000));
        assert_eq!(p.next_delay_ms(0.5), Some(30_000));
        assert_eq!(p.next_delay_ms(0.999), Some(32_994));
    }

    #[test]
    fn backs_off_exponentially_and_recovers() {
        let mut p = Poller::new(30);
        p.failure();
        assert_eq!(p.next_delay_ms(0.5), Some(60_000));
        p.failure();
        p.failure();
        assert_eq!(p.next_delay_ms(0.5), Some(240_000));
        for _ in 0..20 {
            p.failure();
        }
        assert_eq!(p.next_delay_ms(0.5), Some(600_000), "capped");
        p.success();
        assert_eq!(p.next_delay_ms(0.5), Some(30_000));
    }

    #[test]
    fn pauses_while_hidden() {
        let mut p = Poller::new(30);
        p.set_hidden(true);
        assert_eq!(p.next_delay_ms(0.5), None);
        p.set_hidden(false);
        assert!(p.next_delay_ms(0.5).is_some());
    }
}
