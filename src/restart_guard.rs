//! Limits how often SparkPing restarts itself after the storage stopped.
//!
//! Exiting lets the Supervisor watchdog reopen the storage, but an error that
//! comes back right after every start would turn that into a restart loop.
//! Each restart therefore waits longer than the one before, and after
//! `MAX_RESTARTS` within `WINDOW` SparkPing keeps running and only reports
//! the error. A restart from outside (stop, update) clears the count.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, warn};
use tsink::Storage;

const HISTORY_FILE: &str = "sparkping-restarts.txt";
const WINDOW_SECS: i64 = 24 * 3600;
const MAX_RESTARTS: usize = 5;
const FIRST_DELAY: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq)]
pub enum Decision {
    Restart { delay: Duration },
    GiveUp { restarts: usize },
}

/// The first restart happens right away, each further one within the window
/// waits twice as long as the one before.
pub fn decide(restarts_at: &[i64], now: i64) -> Decision {
    let recent = restarts_at
        .iter()
        .filter(|at| now - **at < WINDOW_SECS)
        .count();
    match recent {
        0 => Decision::Restart {
            delay: Duration::ZERO,
        },
        n if n >= MAX_RESTARTS => Decision::GiveUp { restarts: n },
        n => Decision::Restart {
            delay: FIRST_DELAY * 2u32.pow(n as u32 - 1),
        },
    }
}

/// Kept next to the storage directory, outside of tsink's own files.
pub fn history_path(database_path: &str) -> PathBuf {
    Path::new(database_path).with_file_name(HISTORY_FILE)
}

fn read_history(path: &Path) -> Vec<i64> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

fn record_restart(path: &Path, restarts_at: &[i64], now: i64) -> std::io::Result<()> {
    let mut lines: Vec<String> = restarts_at
        .iter()
        .filter(|at| now - **at < WINDOW_SECS)
        .map(|at| at.to_string())
        .collect();
    lines.push(now.to_string());
    std::fs::write(path, lines.join("\n") + "\n")
}

/// Called on a shutdown requested from outside.
pub fn clear_history(path: &Path) {
    if let Err(e) = std::fs::remove_file(path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            warn!("Cannot clear the restart history {:?}: {}", path, e);
        }
    }
}

/// Resolves when SparkPing should exit so it gets restarted: after the
/// storage stopped and the backoff passed. Never resolves once the restart
/// limit is reached.
pub async fn restart_after_storage_stop(storage: Arc<dyn Storage>, history: PathBuf) {
    crate::health::storage_stopped(storage).await;
    let now = chrono::Utc::now().timestamp();
    let restarts_at = read_history(&history);
    match decide(&restarts_at, now) {
        Decision::GiveUp { restarts } => {
            error!(
                "Storage stopped after a background error; SparkPing already restarted {} times within 24 hours and does not restart again. Restart it manually once the cause is fixed.",
                restarts
            );
            std::future::pending::<()>().await;
        }
        Decision::Restart { delay } => {
            if let Err(e) = record_restart(&history, &restarts_at, now) {
                warn!("Cannot record the restart in {:?}: {}", history, e);
            }
            if !delay.is_zero() {
                error!(
                    "Storage stopped after a background error, restarting SparkPing in {} minutes",
                    delay.as_secs() / 60
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    #[test]
    fn restarts_with_growing_delays_then_gives_up() {
        let mut history = Vec::new();
        let mut delays = Vec::new();
        while let Decision::Restart { delay } = decide(&history, NOW) {
            delays.push(delay.as_secs());
            history.push(NOW - 60);
        }
        assert_eq!(delays, vec![0, 60, 120, 240, 480]);
        assert_eq!(
            decide(&history, NOW),
            Decision::GiveUp {
                restarts: MAX_RESTARTS
            }
        );
    }

    #[test]
    fn restarts_older_than_a_day_do_not_count() {
        let history = vec![NOW - WINDOW_SECS - 1; 10];
        assert_eq!(
            decide(&history, NOW),
            Decision::Restart {
                delay: Duration::ZERO
            }
        );
    }

    #[test]
    fn history_survives_a_restart_and_is_cleared_on_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = history_path(&dir.path().join("tsink-data").to_string_lossy());
        assert_eq!(path, dir.path().join(HISTORY_FILE));
        assert!(read_history(&path).is_empty());

        record_restart(&path, &[], NOW - WINDOW_SECS - 1).unwrap();
        record_restart(&path, &read_history(&path), NOW - 10).unwrap();
        // The restart outside the window is dropped when the next one is recorded.
        record_restart(&path, &read_history(&path), NOW).unwrap();
        assert_eq!(read_history(&path), vec![NOW - 10, NOW]);

        clear_history(&path);
        assert!(read_history(&path).is_empty());
        clear_history(&path);
    }
}
