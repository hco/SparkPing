//! Limits how fast the migration thread reads from disk, whatever it reads
//! through (read calls or page faults on memory maps). Unlike host pressure
//! (PSI), the thread's own read count is available on every Linux kernel.

use std::time::{Duration, Instant};

/// Sustained reads above this rate make the migration wait.
pub const BYTES_PER_SEC: u64 = 20_000_000;
/// Reads up to this much at once without waiting: a legacy partition is
/// about 10 MB and is read in one call.
pub const BURST_BYTES: u64 = 32_000_000;

pub struct ReadBudget {
    bytes_per_sec: f64,
    burst: f64,
    credit: f64,
    last_at: Instant,
    last_read: u64,
}

impl ReadBudget {
    pub fn new(bytes_per_sec: u64, burst: u64, read_bytes: u64, now: Instant) -> Self {
        Self {
            bytes_per_sec: bytes_per_sec as f64,
            burst: burst as f64,
            credit: burst as f64,
            last_at: now,
            last_read: read_bytes,
        }
    }

    /// Charges what was read since the last call and returns how long to
    /// wait before reading on. Idle time earns credit up to the burst.
    pub fn charge(&mut self, read_bytes: u64, now: Instant) -> Duration {
        let earned = now.saturating_duration_since(self.last_at).as_secs_f64() * self.bytes_per_sec;
        let spent = read_bytes.saturating_sub(self.last_read) as f64;
        self.credit = (self.credit + earned).min(self.burst) - spent;
        self.last_at = now;
        self.last_read = read_bytes;
        if self.credit >= 0.0 {
            return Duration::ZERO;
        }
        let wait = Duration::from_secs_f64(-self.credit / self.bytes_per_sec);
        // The wait pays off the debt; it must not earn credit on top.
        self.credit = 0.0;
        self.last_at = now + wait;
        wait
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1_000_000;

    #[test]
    fn bursts_are_free_and_sustained_reads_wait() {
        let start = Instant::now();
        let mut budget = ReadBudget::new(20 * MB, 32 * MB, 0, start);
        // One partition at once.
        assert_eq!(budget.charge(10 * MB, start), Duration::ZERO);
        // 100 MB more within the next second: 68 MB over budget.
        let wait = budget.charge(110 * MB, start + Duration::from_secs(1));
        assert_eq!(wait.as_secs_f64().round(), 3.0);
        // Waiting earns nothing extra: reading right after the wait at the
        // budget rate is fine, beyond it waits again.
        let after = start + Duration::from_secs(1) + wait;
        assert_eq!(budget.charge(110 * MB, after), Duration::ZERO);
        let wait = budget.charge(150 * MB, after + Duration::from_secs(1));
        assert_eq!(wait.as_secs_f64().round(), 1.0);
    }

    #[test]
    fn idle_time_earns_at_most_the_burst() {
        let start = Instant::now();
        let mut budget = ReadBudget::new(20 * MB, 32 * MB, 0, start);
        let later = start + Duration::from_secs(3600);
        assert_eq!(budget.charge(32 * MB, later), Duration::ZERO);
        assert!(budget.charge(52 * MB, later) > Duration::ZERO);
    }
}
