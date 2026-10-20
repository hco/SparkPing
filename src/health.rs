//! Health of the running instance, for `GET /api/health` and the log.
//!
//! Problems that used to go unnoticed for days (open-files limit reached,
//! storage refusing writes) show up here and in the UI banner.

use crate::config::AppConfig;
use crate::fd_limit::{current_soft_limit, open_fd_count};
use crate::storage::migration::status::{MigrationState, MigrationStatus};
use crate::storage::write::last_successful_write;
use serde::Serialize;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tracing::{error, info, warn};
use tsink::storage::StorageHealthSnapshot;
use tsink::Storage;

const LOG_INTERVAL: Duration = Duration::from_secs(60);
const LOG_REMINDER: Duration = Duration::from_secs(15 * 60);
/// Pings may stop being stored for this long before it counts as a problem.
const MIN_WRITE_STALL_SECS: i64 = 5 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ok,
    Degraded,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthIssueKind {
    Storage,
    OpenFiles,
    Writes,
    Migration,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthIssue {
    pub kind: HealthIssueKind,
    pub severity: HealthStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthReport {
    pub status: HealthStatus,
    pub issues: Vec<HealthIssue>,
    pub open_files: Option<usize>,
    pub open_files_limit: Option<u64>,
    /// Unix time of the last stored ping result.
    pub last_write_at: Option<i64>,
    pub migration: MigrationState,
}

pub struct HealthMonitor {
    storage: Arc<dyn Storage>,
    config: Arc<RwLock<AppConfig>>,
    migration: Arc<MigrationStatus>,
    started_at: i64,
}

impl HealthMonitor {
    pub fn new(
        storage: Arc<dyn Storage>,
        config: Arc<RwLock<AppConfig>>,
        migration: Arc<MigrationStatus>,
    ) -> Self {
        Self {
            storage,
            config,
            migration,
            started_at: chrono::Utc::now().timestamp(),
        }
    }

    pub fn report(&self) -> HealthReport {
        let storage = self.storage.observability_snapshot().health;
        let open_files = open_fd_count();
        let open_files_limit = current_soft_limit();
        let last_write_at = last_successful_write();
        let migration = self.migration.get();

        // Without targets nothing is written, so a stall means nothing.
        let max_ping_interval = self
            .config
            .read()
            .map(|config| config.targets.iter().map(|t| t.ping_interval).max())
            .unwrap_or(None);
        let write_check = max_ping_interval.map(|interval| WriteCheck {
            age_secs: chrono::Utc::now().timestamp() - last_write_at.unwrap_or(self.started_at),
            stall_secs: MIN_WRITE_STALL_SECS.max(3 * interval as i64),
        });

        let issues = evaluate(&Inputs {
            storage: &storage,
            open_files,
            open_files_limit,
            writes: write_check,
            migration: &migration,
        });
        HealthReport {
            status: overall_status(&issues),
            issues,
            open_files,
            open_files_limit,
            last_write_at,
            migration,
        }
    }
}

/// Logs health changes, and a reminder while unhealthy.
pub fn spawn_health_log(monitor: Arc<HealthMonitor>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(LOG_INTERVAL);
        let mut logged: Vec<(HealthIssueKind, HealthStatus)> = Vec::new();
        let mut last_log = Instant::now();
        loop {
            interval.tick().await;
            let monitor = Arc::clone(&monitor);
            let Ok(report) = tokio::task::spawn_blocking(move || monitor.report()).await else {
                continue;
            };
            let current: Vec<_> = report.issues.iter().map(|i| (i.kind, i.severity)).collect();
            let changed = current != logged;
            if !changed && (current.is_empty() || last_log.elapsed() < LOG_REMINDER) {
                continue;
            }
            if current.is_empty() {
                info!("Health is ok again");
            } else {
                for issue in &report.issues {
                    let prefix = if changed { "Health" } else { "Health (still)" };
                    match issue.severity {
                        HealthStatus::Error => error!("{}: {}", prefix, issue.message),
                        _ => warn!("{}: {}", prefix, issue.message),
                    }
                }
            }
            logged = current;
            last_log = Instant::now();
        }
    })
}

struct WriteCheck {
    /// Seconds since the last successful write, or since startup.
    age_secs: i64,
    stall_secs: i64,
}

struct Inputs<'a> {
    storage: &'a StorageHealthSnapshot,
    open_files: Option<usize>,
    open_files_limit: Option<u64>,
    /// None when there are no targets.
    writes: Option<WriteCheck>,
    migration: &'a MigrationState,
}

fn overall_status(issues: &[HealthIssue]) -> HealthStatus {
    issues
        .iter()
        .map(|i| i.severity)
        .max()
        .unwrap_or(HealthStatus::Ok)
}

fn evaluate(inputs: &Inputs) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    let mut push = |kind, severity, message: String| {
        issues.push(HealthIssue {
            kind,
            severity,
            message,
        })
    };

    let storage = inputs.storage;
    let storage_error = storage
        .last_background_error
        .as_deref()
        .or(storage.last_maintenance_error.as_deref())
        .unwrap_or("unknown error");
    if storage.fail_fast_triggered {
        push(
            HealthIssueKind::Storage,
            HealthStatus::Error,
            format!(
                "Storage stopped after a background error and rejects all reads and writes until SparkPing is restarted: {}",
                storage_error
            ),
        );
    } else if storage.degraded {
        push(
            HealthIssueKind::Storage,
            HealthStatus::Degraded,
            format!(
                "Storage reported {} background errors since startup, last: {}",
                storage.background_errors_total + storage.maintenance_errors_total,
                storage_error
            ),
        );
    }

    if let (Some(open), Some(limit)) = (inputs.open_files, inputs.open_files_limit) {
        let used = open as f64 / limit.max(1) as f64;
        let severity = if used >= 0.95 {
            Some(HealthStatus::Error)
        } else if used >= 0.8 {
            Some(HealthStatus::Degraded)
        } else {
            None
        };
        if let Some(severity) = severity {
            push(
                HealthIssueKind::OpenFiles,
                severity,
                format!("{} of {} allowed open files in use", open, limit),
            );
        }
    }

    if let Some(writes) = &inputs.writes {
        if writes.age_secs > writes.stall_secs {
            push(
                HealthIssueKind::Writes,
                HealthStatus::Error,
                format!(
                    "No ping results were stored for {} minutes",
                    writes.age_secs / 60
                ),
            );
        }
    }

    match inputs.migration {
        MigrationState::Failed { error } => push(
            HealthIssueKind::Migration,
            HealthStatus::Degraded,
            format!(
                "Migrating old data failed, it is kept and retried on the next start: {}",
                error
            ),
        ),
        MigrationState::Completed {
            failed_partitions, ..
        } if *failed_partitions > 0 => push(
            HealthIssueKind::Migration,
            HealthStatus::Degraded,
            format!(
                "{} partitions of old data could not be migrated, they are kept and retried on the next start",
                failed_partitions
            ),
        ),
        _ => {}
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn healthy_inputs<'a>(
        storage: &'a StorageHealthSnapshot,
        migration: &'a MigrationState,
    ) -> Inputs<'a> {
        Inputs {
            storage,
            open_files: Some(100),
            open_files_limit: Some(1024),
            writes: Some(WriteCheck {
                age_secs: 30,
                stall_secs: MIN_WRITE_STALL_SECS,
            }),
            migration,
        }
    }

    fn kinds(issues: &[HealthIssue]) -> Vec<(HealthIssueKind, HealthStatus)> {
        issues.iter().map(|i| (i.kind, i.severity)).collect()
    }

    #[test]
    fn healthy_instance_has_no_issues() {
        let storage = StorageHealthSnapshot::default();
        let migration = MigrationState::Running {
            percent: 40,
            points_migrated: 1000,
        };
        let issues = evaluate(&healthy_inputs(&storage, &migration));
        assert!(issues.is_empty());
        assert_eq!(overall_status(&issues), HealthStatus::Ok);
    }

    #[test]
    fn stopped_storage_is_an_error() {
        let storage = StorageHealthSnapshot {
            background_errors_total: 1,
            degraded: true,
            fail_fast_enabled: true,
            fail_fast_triggered: true,
            last_background_error: Some("flush worker error: IO error".to_string()),
            ..Default::default()
        };
        let issues = evaluate(&healthy_inputs(&storage, &MigrationState::NotNeeded));
        assert_eq!(
            kinds(&issues),
            [(HealthIssueKind::Storage, HealthStatus::Error)]
        );
        assert!(issues[0].message.contains("flush worker error"));
    }

    #[test]
    fn open_files_near_the_limit() {
        let storage = StorageHealthSnapshot::default();
        let mut inputs = healthy_inputs(&storage, &MigrationState::NotNeeded);
        inputs.open_files = Some(900);
        assert_eq!(
            kinds(&evaluate(&inputs)),
            [(HealthIssueKind::OpenFiles, HealthStatus::Degraded)]
        );
        inputs.open_files = Some(1000);
        assert_eq!(
            kinds(&evaluate(&inputs)),
            [(HealthIssueKind::OpenFiles, HealthStatus::Error)]
        );
    }

    #[test]
    fn stalled_writes_are_an_error_only_with_targets() {
        let storage = StorageHealthSnapshot::default();
        let mut inputs = healthy_inputs(&storage, &MigrationState::NotNeeded);
        inputs.writes = Some(WriteCheck {
            age_secs: MIN_WRITE_STALL_SECS + 1,
            stall_secs: MIN_WRITE_STALL_SECS,
        });
        assert_eq!(
            kinds(&evaluate(&inputs)),
            [(HealthIssueKind::Writes, HealthStatus::Error)]
        );
        inputs.writes = None;
        assert!(evaluate(&inputs).is_empty());
    }

    #[test]
    fn migration_problems_are_degraded() {
        let storage = StorageHealthSnapshot::default();
        let failed = MigrationState::Completed {
            failed_partitions: 2,
            points_migrated: 10,
        };
        assert_eq!(
            kinds(&evaluate(&healthy_inputs(&storage, &failed))),
            [(HealthIssueKind::Migration, HealthStatus::Degraded)]
        );
        let done = MigrationState::Completed {
            failed_partitions: 0,
            points_migrated: 10,
        };
        assert!(evaluate(&healthy_inputs(&storage, &done)).is_empty());
    }
}
