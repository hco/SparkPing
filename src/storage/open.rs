use crate::config::DatabaseConfig;
use std::sync::Arc;
use std::time::Duration;
use tsink::{Storage, StorageBuilder, TimestampPrecision, WalSyncMode};

/// Opens the tsink storage for ping data.
///
/// No memory limit is set on purpose: tsink counts memory-mapped segment bytes
/// against the budget, so the budget fills up with on-disk data, and writers
/// then stall while holding shard locks (see ADR 0003).
pub fn open_storage(config: &DatabaseConfig) -> tsink::Result<Arc<dyn Storage>> {
    let mut builder = StorageBuilder::new()
        .with_data_path(&config.path)
        // Must match the second-precision timestamps written by storage::write
        .with_timestamp_precision(TimestampPrecision::Seconds)
        .with_wal_enabled(true)
        // fsync once per second instead of per insert; a crash loses at most
        // the last second of pings.
        .with_wal_sync_mode(WalSyncMode::Periodic(Duration::from_secs(1)))
        // Larger chunks keep the in-memory index of persisted data small
        // (about 0.3 MB per day of data instead of 0.9 MB with the default).
        .with_chunk_points(8192)
        // Day-long partitions keep the chunk count low (a chunk never spans
        // partitions) and let late writes reach back 8 days, the default
        // number of open partitions per series.
        .with_partition_duration(Duration::from_secs(24 * 3600))
        .with_max_writers(16)
        .with_write_timeout(Duration::from_secs(60));

    // Without a retention, tsink keeps everything and accepts backfill of any age.
    // A retention of zero would reject every write.
    if let Some(days) = config.retention_days.filter(|days| *days > 0) {
        builder = builder.with_retention(Duration::from_secs(u64::from(days) * 24 * 3600));
    }

    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fd_limit::open_fd_count;

    const CHILD_ENV: &str = "SPARKPING_FD_LIMIT_CHILD";
    const SOFT_LIMIT: u64 = 24;
    const DAYS: i64 = 80;

    /// tsink 0.5 kept one file descriptor per partition, which ran into the
    /// open-files limit after enough days of data. Storage with more files on
    /// disk than the limit must still open, read and write. The soft limit
    /// applies to the whole process, so the check runs in a child process.
    #[test]
    fn many_segment_files_fit_in_a_small_open_files_limit() {
        if std::env::var_os(CHILD_ENV).is_some() {
            many_segment_files_with_low_limit();
            return;
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "storage::open::tests::many_segment_files_fit_in_a_small_open_files_limit",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "child failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn many_segment_files_with_low_limit() {
        let limit = libc::rlimit {
            rlim_cur: SOFT_LIMIT,
            rlim_max: SOFT_LIMIT,
        };
        assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) }, 0);

        let dir = tempfile::tempdir().unwrap();
        let config = DatabaseConfig {
            path: dir.path().join("data").to_string_lossy().into_owned(),
            retention_days: None,
        };
        let now = chrono::Utc::now().timestamp();
        let row = |target: usize, ts: i64| {
            tsink::Row::with_labels(
                "ping_latency",
                vec![tsink::Label::new("target_id", format!("id-{}", target))],
                tsink::DataPoint::new(ts, 12.5),
            )
        };

        // Each close persists a segment, so many short runs leave more
        // segment files than the limit allows open at once.
        let mut written = 0;
        for day in 0..DAYS {
            let storage = open_storage(&config).unwrap();
            let start = now - (DAYS - day) * 24 * 3600;
            let rows: Vec<tsink::Row> = (start..start + 24 * 3600)
                .step_by(3600)
                .flat_map(|ts| (0..3).map(move |target| row(target, ts)))
                .collect();
            storage.insert_rows(&rows).unwrap();
            written += rows.len();
            storage.close().unwrap();
        }
        let files = segment_files(dir.path());
        assert!(files > SOFT_LIMIT as usize, "only {} files", files);

        let storage = open_storage(&config).unwrap();
        let stored: usize = storage
            .select_all("ping_latency", 0, i64::MAX)
            .unwrap()
            .iter()
            .map(|(_, points)| points.len())
            .sum();
        assert_eq!(stored, written);
        storage.insert_rows(&[row(0, now)]).unwrap();
        let open = open_fd_count().unwrap();
        assert!(open < SOFT_LIMIT as usize / 2, "{} files open", open);
        storage.close().unwrap();
    }

    fn segment_files(dir: &std::path::Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .map(|path| {
                if path.is_dir() {
                    segment_files(&path)
                } else {
                    1
                }
            })
            .sum()
    }
}
