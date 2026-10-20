use std::time::{Duration, Instant};

/// Tracks an ongoing run of failures so callers can log state changes instead
/// of every single failure. A target that is down for hours would otherwise
/// write one warning per ping and fill the disk.
#[derive(Debug)]
pub struct FailureStreak {
    reminder_interval: Duration,
    failing_since: Option<Instant>,
    failures: u64,
    last_report: Option<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Transition {
    /// Nothing worth logging.
    Unchanged,
    /// First failure after a healthy period.
    Started,
    /// Still failing; `reminder_interval` has passed since the last report.
    Ongoing { duration: Duration, failures: u64 },
    /// First success after failing.
    Recovered { duration: Duration, failures: u64 },
}

impl FailureStreak {
    pub fn new(reminder_interval: Duration) -> Self {
        Self {
            reminder_interval,
            failing_since: None,
            failures: 0,
            last_report: None,
        }
    }

    pub fn record(&mut self, now: Instant, ok: bool) -> Transition {
        match (ok, self.failing_since) {
            (true, None) => Transition::Unchanged,
            (true, Some(since)) => {
                let transition = Transition::Recovered {
                    duration: now.duration_since(since),
                    failures: self.failures,
                };
                self.failing_since = None;
                self.failures = 0;
                self.last_report = None;
                transition
            }
            (false, None) => {
                self.failing_since = Some(now);
                self.failures = 1;
                self.last_report = Some(now);
                Transition::Started
            }
            (false, Some(since)) => {
                self.failures += 1;
                let due = self
                    .last_report
                    .is_none_or(|last| now.duration_since(last) >= self.reminder_interval);
                if due {
                    self.last_report = Some(now);
                    Transition::Ongoing {
                        duration: now.duration_since(since),
                        failures: self.failures,
                    }
                } else {
                    Transition::Unchanged
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: Duration = Duration::from_secs(3600);

    #[test]
    fn success_without_failures_is_silent() {
        let mut streak = FailureStreak::new(HOUR);
        let t0 = Instant::now();
        assert_eq!(streak.record(t0, true), Transition::Unchanged);
        assert_eq!(streak.record(t0, true), Transition::Unchanged);
    }

    #[test]
    fn reports_start_then_reminders_then_recovery() {
        let mut streak = FailureStreak::new(HOUR);
        let t0 = Instant::now();

        assert_eq!(streak.record(t0, false), Transition::Started);
        assert_eq!(
            streak.record(t0 + Duration::from_secs(60), false),
            Transition::Unchanged
        );
        assert_eq!(
            streak.record(t0 + HOUR - Duration::from_secs(1), false),
            Transition::Unchanged
        );
        assert_eq!(
            streak.record(t0 + HOUR, false),
            Transition::Ongoing {
                duration: HOUR,
                failures: 4
            }
        );
        // The next reminder is measured from the previous one.
        assert_eq!(
            streak.record(t0 + HOUR + Duration::from_secs(60), false),
            Transition::Unchanged
        );
        assert_eq!(
            streak.record(t0 + 2 * HOUR, true),
            Transition::Recovered {
                duration: 2 * HOUR,
                failures: 5
            }
        );
        assert_eq!(streak.record(t0 + 2 * HOUR, true), Transition::Unchanged);
    }

    #[test]
    fn a_new_streak_after_recovery_starts_fresh() {
        let mut streak = FailureStreak::new(HOUR);
        let t0 = Instant::now();

        streak.record(t0, false);
        streak.record(t0 + Duration::from_secs(10), true);
        assert_eq!(
            streak.record(t0 + Duration::from_secs(20), false),
            Transition::Started
        );
        assert_eq!(
            streak.record(t0 + Duration::from_secs(30), true),
            Transition::Recovered {
                duration: Duration::from_secs(10),
                failures: 1
            }
        );
    }
}
