//! Disk reads of the calling thread, to tell which step of the migration
//! reads how much. Most reads are page faults on tsink's memory maps, which
//! only show up in `read_bytes` and the major fault count, not in `rchar`.

use std::ops::Sub;

#[derive(Debug, Clone, Copy, Default)]
pub struct ThreadIo {
    pub read_bytes: u64,
    pub major_faults: u64,
}

impl ThreadIo {
    /// Zero where /proc is unavailable (macOS).
    pub fn now() -> Self {
        let read_bytes = std::fs::read_to_string("/proc/thread-self/io")
            .ok()
            .and_then(|io| {
                io.lines()
                    .find_map(|line| line.strip_prefix("read_bytes:"))
                    .and_then(|v| v.trim().parse().ok())
            })
            .unwrap_or(0);
        // The command name in parentheses may contain spaces; majflt is the
        // 10th field after it.
        let major_faults = std::fs::read_to_string("/proc/thread-self/stat")
            .ok()
            .and_then(|stat| {
                stat.rsplit_once(')')
                    .and_then(|(_, rest)| rest.split_whitespace().nth(9)?.parse().ok())
            })
            .unwrap_or(0);
        Self {
            read_bytes,
            major_faults,
        }
    }

    pub fn describe(&self) -> String {
        format!(
            "{:.1} MB / {} faults",
            self.read_bytes as f64 / 1e6,
            self.major_faults
        )
    }
}

impl Sub for ThreadIo {
    type Output = ThreadIo;

    fn sub(self, earlier: ThreadIo) -> ThreadIo {
        ThreadIo {
            read_bytes: self.read_bytes.saturating_sub(earlier.read_bytes),
            major_faults: self.major_faults.saturating_sub(earlier.major_faults),
        }
    }
}
