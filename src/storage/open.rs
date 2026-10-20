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
        .with_max_writers(16)
        .with_write_timeout(Duration::from_secs(60));

    // Without a retention, tsink keeps everything and accepts backfill of any age.
    // A retention of zero would reject every write.
    if let Some(days) = config.retention_days.filter(|days| *days > 0) {
        builder = builder.with_retention(Duration::from_secs(u64::from(days) * 24 * 3600));
    }

    builder.build()
}
