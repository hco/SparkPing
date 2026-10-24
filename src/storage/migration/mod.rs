//! Background migration of tsink 0.5 data (moved to `legacy-v05/` by
//! `legacy_layout`) into the tsink 0.10 storage. See ADR 0003.
//!
//! Data is inserted oldest first: tsink 0.10 keeps a bounded number of open
//! partitions per series and rejects writes older than the oldest one. The
//! WAL can overlap partitions in time, so both sources are merged by time.
//! Legacy files are deleted only after the new storage accepted all their
//! points and the WAL sync interval has passed.

mod legacy_wal;
mod partitions;
pub mod status;
#[cfg(test)]
mod tests;

use crate::pressure::{read_host_pressure, HostPressure};
use legacy_wal::LegacyWal;
use partitions::{list_partitions, read_partition, LegacyPartition, ReadError};
use status::{MigrationState, MigrationStatus};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use tsink::{DataPoint, Row, Storage, TsinkError};

const BATCH_ROWS: usize = 20_000;
/// Longer than the WAL sync interval (1 s), so inserted points are durable
/// before the legacy copy is deleted.
const DELETE_DELAY: Duration = Duration::from_secs(2);
const PROGRESS_LOG_INTERVAL: Duration = Duration::from_secs(30);
/// Allowed growth of tsink's in-memory index before waiting for compaction.
const INDEX_HEADROOM_BYTES: usize = 32 * 1024 * 1024;
/// Where tsink keeps freshly flushed segments until compaction merges them
/// (tsink's on-disk layout, not a public API).
const L0_SEGMENTS_DIR: &str = "lane_numeric/segments/L0";
/// Inserting pauses at this many unmerged segments and resumes at the lower
/// number. A bulk import writes segments faster than compaction merges them;
/// the backlog makes compaction and closing slow.
const L0_BACKLOG_PAUSE: usize = 64;
const L0_BACKLOG_RESUME: usize = 16;
/// Inserting pauses at this WAL size until tsink clears the WAL. It only does
/// so when no write arrives between a flush and the reset, which never
/// happens while the migration inserts continuously; a ping written during a
/// flush prevents it too, so a pause can span several flushes. Opening the
/// storage replays the whole WAL into memory: 760 MB of WAL needed more than
/// 2 GB.
const WAL_BACKLOG_PAUSE_BYTES: u64 = 128 * 1024 * 1024;
const WAL_BACKLOG_RESUME_BYTES: u64 = 32 * 1024 * 1024;
/// Waiting for the backlog stops when it has not shrunk for this long.
const BACKLOG_STALL: Duration = Duration::from_secs(60);
/// How often a migration paused for host pressure checks it again.
const PRESSURE_POLL: Duration = Duration::from_secs(5);

pub struct MigrationHandle {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl MigrationHandle {
    /// Asks the migration to stop after the current batch and waits for it.
    /// Must be called before closing the storage.
    pub fn stop_and_wait(self) {
        self.stop.store(true, Ordering::Relaxed);
        if self.thread.join().is_err() {
            error!("Migration thread panicked");
        }
    }
}

/// Starts migrating `legacy_dir` into `storage` on a background thread.
pub fn spawn_migration(
    storage: Arc<dyn Storage>,
    legacy_dir: PathBuf,
    retention_days: Option<u32>,
    status: Arc<MigrationStatus>,
) -> io::Result<MigrationHandle> {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name("tsink-migration".to_string())
        .spawn(move || {
            let mut migrator =
                Migrator::new(storage.as_ref(), &thread_stop, &status, retention_days);
            match migrator.run(&legacy_dir) {
                Ok(()) => {}
                Err(MigrationError::Stopped) => {
                    info!("Migration stopped; it resumes on the next start");
                }
                Err(e) => {
                    error!("Migration of tsink 0.5 data failed: {}", e);
                    status.set(MigrationState::Failed {
                        error: e.to_string(),
                    });
                }
            }
        })?;
    Ok(MigrationHandle { stop, thread })
}

#[derive(Debug)]
enum MigrationError {
    Stopped,
    Storage(TsinkError),
    Io(io::Error),
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MigrationError::Stopped => write!(f, "stopped"),
            MigrationError::Storage(e) => write!(f, "storage: {}", e),
            MigrationError::Io(e) => write!(f, "I/O: {}", e),
        }
    }
}

impl From<io::Error> for MigrationError {
    fn from(e: io::Error) -> Self {
        MigrationError::Io(e)
    }
}

impl From<TsinkError> for MigrationError {
    fn from(e: TsinkError) -> Self {
        match e {
            TsinkError::StorageShuttingDown | TsinkError::StorageClosed => MigrationError::Stopped,
            e => MigrationError::Storage(e),
        }
    }
}

type Result<T> = std::result::Result<T, MigrationError>;

struct Migrator<'a> {
    storage: &'a dyn Storage,
    stop: &'a AtomicBool,
    status: &'a MigrationStatus,
    /// Points older than this are dropped (retention).
    cutoff: Option<i64>,
    batch: Vec<Row>,
    pending_deletes: Vec<(Instant, PathBuf)>,
    points_migrated: u64,
    points_rejected: u64,
    failed_partitions: usize,
    bytes_total: u64,
    partition_bytes_done: u64,
    started: Instant,
    last_progress_log: Instant,
    index_watermark: usize,
    l0_dir: Option<PathBuf>,
    backlog_stall_warned: bool,
    percent: u8,
    pressure: Box<dyn FnMut() -> Option<HostPressure> + 'a>,
    pressure_poll: Duration,
    paused: Option<String>,
    pressure_pauses: usize,
}

#[derive(Clone, Copy)]
struct Backlog {
    l0_segments: usize,
    wal_bytes: u64,
}

impl<'a> Migrator<'a> {
    fn new(
        storage: &'a dyn Storage,
        stop: &'a AtomicBool,
        status: &'a MigrationStatus,
        retention_days: Option<u32>,
    ) -> Self {
        // Keep a day of margin so points don't expire while the migration
        // runs, which would fail verification.
        let cutoff = retention_days
            .filter(|d| *d > 0)
            .map(|days| chrono::Utc::now().timestamp() - (i64::from(days) - 1) * 24 * 3600);
        Self {
            storage,
            stop,
            status,
            cutoff,
            batch: Vec::with_capacity(BATCH_ROWS),
            pending_deletes: Vec::new(),
            points_migrated: 0,
            points_rejected: 0,
            failed_partitions: 0,
            bytes_total: 0,
            partition_bytes_done: 0,
            started: Instant::now(),
            last_progress_log: Instant::now(),
            index_watermark: storage
                .observability_snapshot()
                .memory
                .persisted_index_bytes,
            l0_dir: None,
            backlog_stall_warned: false,
            percent: 0,
            pressure: Box::new(read_host_pressure),
            pressure_poll: PRESSURE_POLL,
            paused: None,
            pressure_pauses: 0,
        }
    }

    fn run(&mut self, legacy_dir: &Path) -> Result<()> {
        // legacy_dir is inside the storage's data directory
        self.l0_dir = legacy_dir.parent().map(|data| data.join(L0_SEGMENTS_DIR));
        let partitions = list_partitions(legacy_dir)?;
        let mut wal = LegacyWal::open(legacy_dir)?;
        let partition_bytes: Vec<u64> = partitions.iter().map(|p| dir_size(&p.path)).collect();
        self.bytes_total = partition_bytes.iter().sum::<u64>() + wal.total_bytes();

        info!(
            "Migrating tsink 0.5 data in the background: {} partitions, {:.1} MB WAL, {:.1} MB total",
            partitions.len(),
            wal.total_bytes() as f64 / 1e6,
            self.bytes_total as f64 / 1e6
        );
        self.report_progress(&wal, true);

        for (partition, bytes) in partitions.iter().zip(partition_bytes) {
            self.migrate_wal(&mut wal, Some(partition.min_timestamp))?;
            self.migrate_partition(partition)?;
            self.partition_bytes_done += bytes;
            self.delete_due(false)?;
            self.wait_for_compaction();
            self.report_progress(&wal, false);
        }
        self.migrate_wal(&mut wal, None)?;

        std::thread::sleep(DELETE_DELAY);
        self.delete_due(true)?;
        remove_empty_legacy_dirs(legacy_dir);

        info!(
            "Migration of tsink 0.5 data finished in {:.0?}: {} points migrated, {} rejected, {} partitions kept after errors",
            self.started.elapsed(),
            self.points_migrated,
            self.points_rejected,
            self.failed_partitions
        );
        if self.failed_partitions > 0 {
            warn!(
                "{} legacy partitions remain in {:?}; they are retried on the next start",
                self.failed_partitions, legacy_dir
            );
        }
        self.status.set(MigrationState::Completed {
            failed_partitions: self.failed_partitions,
            points_migrated: self.points_migrated,
        });
        Ok(())
    }

    /// Inserts WAL rows older than `until` (all remaining rows if None).
    fn migrate_wal(&mut self, wal: &mut LegacyWal, until: Option<i64>) -> Result<()> {
        loop {
            match wal.peek()? {
                None => break,
                Some(row) if until.is_some_and(|until| row.timestamp >= until) => break,
                Some(_) => {}
            }
            let Some(row) = wal.next_row()? else { break };
            if self.is_expired(row.timestamp) {
                continue;
            }
            self.batch.push(Row::with_labels(
                row.metric,
                row.labels,
                DataPoint::new(row.timestamp, row.value),
            ));
            if self.batch.len() >= BATCH_ROWS {
                self.flush_batch()?;
                // Finished segments' rows have all been flushed now.
                self.schedule_deletes(wal.take_finished());
                self.delete_due(false)?;
                self.wait_for_compaction();
                self.report_progress(wal, false);
            }
        }
        self.flush_batch()?;
        self.schedule_deletes(wal.take_finished());
        Ok(())
    }

    fn migrate_partition(&mut self, partition: &LegacyPartition) -> Result<()> {
        let series = match read_partition(&partition.path) {
            Ok(series) => series,
            Err(ReadError::Empty) => {
                self.schedule_deletes([partition.path.clone()]);
                return Ok(());
            }
            Err(ReadError::NoMetadata(bytes)) => {
                warn!(
                    "Deleting legacy partition {:?}: {} bytes of data without meta.json, which tsink 0.5 could not read either",
                    partition.path, bytes
                );
                self.schedule_deletes([partition.path.clone()]);
                return Ok(());
            }
            Err(e) => {
                error!(
                    "Cannot read legacy partition {:?}, keeping it: {}",
                    partition.path, e
                );
                self.failed_partitions += 1;
                return Ok(());
            }
        };
        let rejected_before = self.points_rejected;

        for s in &series {
            for &(ts, value) in &s.points {
                if self.is_expired(ts) {
                    continue;
                }
                self.batch.push(Row::with_labels(
                    s.metric,
                    s.labels.clone(),
                    DataPoint::new(ts, value),
                ));
                if self.batch.len() >= BATCH_ROWS {
                    self.flush_batch()?;
                }
            }
        }
        self.flush_batch()?;
        // insert_rows only succeeds once tsink has taken every row into
        // memory and the WAL, and refuses single points with an error. Reading
        // the points back would decode every persisted chunk that overlaps the
        // partition, which on a host short of page cache came from disk again
        // and again.
        let rejected = self.points_rejected - rejected_before;
        if rejected > 0 {
            error!(
                "{} points of legacy partition {:?} were rejected, keeping it",
                rejected, partition.path
            );
            self.failed_partitions += 1;
            return Ok(());
        }

        self.schedule_deletes([partition.path.clone()]);
        Ok(())
    }

    fn is_expired(&self, timestamp: i64) -> bool {
        self.cutoff.is_some_and(|cutoff| timestamp < cutoff)
    }

    fn flush_batch(&mut self) -> Result<()> {
        if self.stop.load(Ordering::Relaxed) {
            return Err(MigrationError::Stopped);
        }
        if self.batch.is_empty() {
            return Ok(());
        }
        self.wait_for_backlog();
        self.wait_for_host_pressure();
        let batch = std::mem::take(&mut self.batch);
        match self.storage.insert_rows(&batch) {
            Ok(()) => self.points_migrated += batch.len() as u64,
            // A rejected batch writes nothing; find the rejected rows one by
            // one. Points of a partition that end up rejected fail its
            // verification, so the partition is kept and retried.
            Err(e) if is_rejected_point(&e) => {
                debug!("Batch rejected ({}), inserting rows individually", e);
                for row in &batch {
                    match self.storage.insert_rows(std::slice::from_ref(row)) {
                        Ok(()) => self.points_migrated += 1,
                        Err(e) if is_rejected_point(&e) => self.points_rejected += 1,
                        Err(e) => return Err(e.into()),
                    }
                }
            }
            Err(e) => return Err(e.into()),
        }
        self.batch = batch;
        self.batch.clear();
        Ok(())
    }

    fn schedule_deletes(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        let now = Instant::now();
        self.pending_deletes
            .extend(paths.into_iter().map(|path| (now, path)));
    }

    /// Deletes legacy files whose points have had time to become durable.
    fn delete_due(&mut self, all: bool) -> Result<()> {
        let (due, waiting): (Vec<_>, Vec<_>) = std::mem::take(&mut self.pending_deletes)
            .into_iter()
            .partition(|(scheduled, _)| all || scheduled.elapsed() >= DELETE_DELAY);
        self.pending_deletes = waiting;
        for (_, path) in due {
            if path.is_dir() {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
        }
        Ok(())
    }

    fn backlog(&self) -> Backlog {
        let l0_segments = self
            .l0_dir
            .as_ref()
            .and_then(|dir| fs::read_dir(dir).ok())
            .map_or(0, |dir| dir.count());
        Backlog {
            l0_segments,
            wal_bytes: self.storage.observability_snapshot().wal.size_bytes,
        }
    }

    /// Pauses while compaction has many unmerged segments or the WAL is
    /// large. Gives up waiting when the backlog stops shrinking, so a stuck
    /// compaction or constant live writes do not stall the migration forever.
    fn wait_for_backlog(&mut self) {
        let current = self.backlog();
        // Only the limit that was hit has to recover: the WAL clears at the
        // next flush, so waiting for it after an L0 pause idles for up to a
        // whole flush interval.
        let l0_paused = current.l0_segments >= L0_BACKLOG_PAUSE;
        let wal_paused = current.wal_bytes >= WAL_BACKLOG_PAUSE_BYTES;
        if !l0_paused && !wal_paused {
            return;
        }
        let waited = Instant::now();
        let mut lowest = current;
        let mut last_drop = Instant::now();
        while ((l0_paused && lowest.l0_segments > L0_BACKLOG_RESUME)
            || (wal_paused && lowest.wal_bytes > WAL_BACKLOG_RESUME_BYTES))
            && !self.stop.load(Ordering::Relaxed)
        {
            if last_drop.elapsed() > BACKLOG_STALL {
                if !self.backlog_stall_warned {
                    warn!(
                        "Storage backlog has not shrunk for {:?} ({} unmerged segments, {:.0} MB WAL), continuing the migration anyway",
                        BACKLOG_STALL,
                        lowest.l0_segments,
                        lowest.wal_bytes as f64 / 1e6
                    );
                    self.backlog_stall_warned = true;
                }
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
            let now = self.backlog();
            if now.l0_segments < lowest.l0_segments || now.wal_bytes < lowest.wal_bytes {
                last_drop = Instant::now();
            }
            lowest = Backlog {
                l0_segments: lowest.l0_segments.min(now.l0_segments),
                wal_bytes: lowest.wal_bytes.min(now.wal_bytes),
            };
        }
        debug!(
            "Waited {:.0?} for the storage: {} -> {} unmerged segments, {:.0} -> {:.0} MB WAL",
            waited.elapsed(),
            current.l0_segments,
            lowest.l0_segments,
            current.wal_bytes as f64 / 1e6,
            lowest.wal_bytes as f64 / 1e6
        );
    }

    /// Pauses while the host stalls on memory or disk IO, whatever causes it,
    /// and resumes once the pressure has clearly eased. A migration that kept
    /// reading on a host short of page cache held it at 70 % iowait.
    fn wait_for_host_pressure(&mut self) {
        let Some(pressure) = (self.pressure)().filter(HostPressure::is_high) else {
            return;
        };
        warn!(
            "Pausing the migration while the host is under pressure: {}",
            pressure.describe()
        );
        let waited = Instant::now();
        self.pressure_pauses += 1;
        self.paused = Some(pressure.describe());
        self.publish_status();
        while !self.stop.load(Ordering::Relaxed) {
            std::thread::sleep(self.pressure_poll);
            match (self.pressure)() {
                Some(now) if !now.is_low() => {
                    self.paused = Some(now.describe());
                    self.publish_status();
                }
                _ => break,
            }
        }
        self.paused = None;
        self.publish_status();
        info!(
            "Resuming the migration after {:.0?} of host pressure",
            waited.elapsed()
        );
    }

    /// Pauses while tsink's in-memory index is well above its level after
    /// the last pause. Inserting faster than tsink compacts grows the index
    /// by about 1 MB per day of data; compaction shrinks it again.
    fn wait_for_compaction(&mut self) {
        let index_bytes = || {
            self.storage
                .observability_snapshot()
                .memory
                .persisted_index_bytes
        };
        let current = index_bytes();
        if current <= self.index_watermark + INDEX_HEADROOM_BYTES {
            return;
        }
        let waited = Instant::now();
        let mut lowest = current;
        let mut last_drop = Instant::now();
        while last_drop.elapsed() < Duration::from_secs(30) && !self.stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(5));
            let now = index_bytes();
            if now + 256 * 1024 < lowest {
                lowest = now;
                last_drop = Instant::now();
            }
        }
        debug!(
            "Waited {:.0?} for compaction: index {:.1} MB -> {:.1} MB",
            waited.elapsed(),
            current as f64 / 1e6,
            lowest as f64 / 1e6
        );
        self.index_watermark = lowest;
    }

    fn publish_status(&self) {
        self.status.set(MigrationState::Running {
            percent: self.percent,
            points_migrated: self.points_migrated,
            paused: self.paused.clone(),
        });
    }

    fn report_progress(&mut self, wal: &LegacyWal, force: bool) {
        let percent = if self.bytes_total == 0 {
            100
        } else {
            ((self.partition_bytes_done + wal.finished_bytes()) * 100 / self.bytes_total).min(100)
                as u8
        };
        self.percent = percent;
        self.publish_status();
        if !force && self.last_progress_log.elapsed() < PROGRESS_LOG_INTERVAL {
            return;
        }
        self.last_progress_log = Instant::now();
        let eta = (percent > 0 && percent < 100).then(|| {
            let elapsed = self.started.elapsed().as_secs();
            Duration::from_secs(elapsed * (100 - u64::from(percent)) / u64::from(percent))
        });
        info!(
            "Migration progress: {}% ({} points{}{})",
            percent,
            self.points_migrated,
            if self.points_rejected > 0 {
                format!(", {} rejected", self.points_rejected)
            } else {
                String::new()
            },
            eta.map(|eta| format!(", about {} min left", eta.as_secs() / 60 + 1))
                .unwrap_or_default()
        );
    }
}

/// Errors for a single point that the storage refuses, as opposed to
/// storage failures that should abort the migration.
fn is_rejected_point(e: &TsinkError) -> bool {
    matches!(
        e,
        TsinkError::LateWritePartitionFanoutExceeded { .. } | TsinkError::OutOfRetention { .. }
    )
}

fn dir_size(path: &Path) -> u64 {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}

/// Removes the legacy directory once nothing is left in it.
fn remove_empty_legacy_dirs(legacy_dir: &Path) {
    for dir in crate::storage::legacy_layout::LEGACY_WAL_DIRS {
        let _ = fs::remove_dir(legacy_dir.join(dir));
    }
    if fs::remove_dir(legacy_dir).is_ok() {
        info!("Removed {:?}", legacy_dir);
    }
}
