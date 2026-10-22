//! Host-wide stall information (Linux PSI), so background work can back off
//! while the host is short on memory or disk bandwidth.
//!
//! The values are host-wide even inside a container: a migration that keeps
//! reading while other services stall on the disk is what took the host down.

use serde::Serialize;
use std::path::Path;

/// Pause background work above these shares of the last 10 s in which some
/// task stalled.
const MEMORY_HIGH_PERCENT: f64 = 25.0;
const IO_HIGH_PERCENT: f64 = 50.0;
/// Resume only below these, so work does not flap on and off.
const MEMORY_LOW_PERCENT: f64 = 10.0;
const IO_LOW_PERCENT: f64 = 20.0;

/// Share of the last 10 s in which at least one task stalled, in percent.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct HostPressure {
    pub memory: f64,
    pub io: f64,
}

impl HostPressure {
    pub fn is_high(&self) -> bool {
        self.memory >= MEMORY_HIGH_PERCENT || self.io >= IO_HIGH_PERCENT
    }

    pub fn is_low(&self) -> bool {
        self.memory < MEMORY_LOW_PERCENT && self.io < IO_LOW_PERCENT
    }

    pub fn describe(&self) -> String {
        format!(
            "tasks stalled on memory {:.0}% and on disk IO {:.0}% of the last 10 s",
            self.memory, self.io
        )
    }
}

/// None where PSI is unavailable (macOS, kernels without CONFIG_PSI).
pub fn read_host_pressure() -> Option<HostPressure> {
    read_from(Path::new("/proc/pressure"))
}

fn read_from(dir: &Path) -> Option<HostPressure> {
    let read = |name| {
        std::fs::read_to_string(dir.join(name))
            .ok()
            .and_then(|text| some_avg10(&text))
    };
    Some(HostPressure {
        memory: read("memory")?,
        io: read("io")?,
    })
}

/// Parses `avg10` of the `some` line, e.g.
/// `some avg10=1.53 avg60=0.87 avg300=0.40 total=123456`.
fn some_avg10(text: &str) -> Option<f64> {
    text.lines()
        .find_map(|line| line.strip_prefix("some "))?
        .split_whitespace()
        .find_map(|field| field.strip_prefix("avg10="))?
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_some_avg10() {
        let text = "some avg10=71.25 avg60=60.10 avg300=20.00 total=99\n\
                    full avg10=40.00 avg60=30.00 avg300=10.00 total=50\n";
        assert_eq!(some_avg10(text), Some(71.25));
        assert_eq!(some_avg10("full avg10=1.00"), None);
        assert_eq!(some_avg10(""), None);
    }

    #[test]
    fn reads_memory_and_io() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("memory"),
            "some avg10=2.00 avg60=0 avg300=0 total=0\n",
        )
        .unwrap();
        assert_eq!(read_from(dir.path()), None);
        std::fs::write(
            dir.path().join("io"),
            "some avg10=70.00 avg60=0 avg300=0 total=0\n",
        )
        .unwrap();
        assert_eq!(
            read_from(dir.path()),
            Some(HostPressure {
                memory: 2.0,
                io: 70.0
            })
        );
    }

    #[test]
    fn pauses_high_and_resumes_only_when_low() {
        let at = |memory, io| HostPressure { memory, io };
        // The incident: iowait around 70 %.
        assert!(at(5.0, 70.0).is_high());
        assert!(at(30.0, 0.0).is_high());
        assert!(!at(5.0, 30.0).is_high());
        // Between the thresholds it is neither: a paused migration stays paused.
        assert!(!at(5.0, 30.0).is_low());
        assert!(at(5.0, 10.0).is_low());
    }
}
