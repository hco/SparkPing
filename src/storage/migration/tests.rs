use super::status::{MigrationState, MigrationStatus};
use super::Migrator;
use crate::config::DatabaseConfig;
use crate::pressure::HostPressure;
use crate::storage::legacy_layout::{move_legacy_data_aside, LEGACY_DIR};
use crate::storage::open::open_storage;
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tsink::Storage;
use tsink_legacy::wal::Wal;

const HOUR: i64 = 3600;
const STEP: i64 = 10;

/// (metric, sorted "name=value" labels) -> {(timestamp, value bits)}
type Points = BTreeMap<(String, String), BTreeSet<(i64, u64)>>;

fn series_key(metric: &str, labels: impl Iterator<Item = (String, String)>) -> (String, String) {
    let mut labels: Vec<String> = labels.map(|(n, v)| format!("{}={}", n, v)).collect();
    labels.sort();
    (metric.to_string(), labels.join(","))
}

fn legacy_labels(target: usize, seq: u16) -> Vec<tsink_legacy::Label> {
    vec![
        tsink_legacy::Label::new("target_id", format!("id-{}", target)),
        tsink_legacy::Label::new("target", format!("192.0.2.{}", target)),
        tsink_legacy::Label::new("sequence", seq.to_string()),
        tsink_legacy::Label::new("target_name", format!("Target {}", target)),
    ]
}

/// Ping-like rows for every STEP seconds in [from, to).
fn legacy_rows(from: i64, to: i64) -> Vec<tsink_legacy::Row> {
    let mut rows = Vec::new();
    for ts in (from..to).step_by(STEP as usize) {
        for target in 0..2 {
            for seq in 1..=3u16 {
                let labels = legacy_labels(target, seq);
                let row = if (ts / STEP) % 17 == 0 {
                    tsink_legacy::Row::with_labels(
                        "ping_failed",
                        labels,
                        tsink_legacy::DataPoint::new(ts, 0.0),
                    )
                } else {
                    let latency = (ts % 997) as f64 / 7.0 + f64::from(seq);
                    tsink_legacy::Row::with_labels(
                        "ping_latency",
                        labels,
                        tsink_legacy::DataPoint::new(ts, latency),
                    )
                };
                rows.push(row);
            }
        }
    }
    rows
}

fn add_expected(expected: &mut Points, rows: &[tsink_legacy::Row], cutoff: Option<i64>) {
    for row in rows {
        let point = row.data_point();
        if cutoff.is_some_and(|c| point.timestamp < c) {
            continue;
        }
        let key = series_key(
            row.metric(),
            row.labels()
                .iter()
                .map(|l| (l.name.clone(), l.value.clone())),
        );
        expected
            .entry(key)
            .or_default()
            .insert((point.timestamp, point.value.to_bits()));
    }
}

/// Writes a tsink 0.5 data directory: partitions for [start, start+30h) and
/// WAL segments for [start+28h, start+34h), overlapping the last partition.
fn write_legacy_partitions(data: &Path, rows: &[tsink_legacy::Row]) {
    // tsink 0.5 flushes partitions on detached threads that outlive close()
    // and then delete WAL segments in `<path>/wal`, where tsink 0.10 keeps its
    // WAL later. Build the partitions elsewhere and copy them over.
    let source = data.with_file_name("legacy-source");
    let legacy = tsink_legacy::StorageBuilder::new()
        .with_data_path(&source)
        .with_timestamp_precision(tsink_legacy::TimestampPrecision::Seconds)
        .with_partition_duration(Duration::from_secs(6 * 3600))
        .with_retention(Duration::from_secs(365 * 24 * 3600))
        .build()
        .unwrap();
    for chunk in rows.chunks(5000) {
        legacy.insert_rows(chunk).unwrap();
    }
    legacy.close().unwrap();
    for entry in std::fs::read_dir(&source).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap();
        if name.to_string_lossy().starts_with("p-") {
            copy_dir(&path, &data.join(name));
        }
    }
}

fn write_legacy_fixture(data: &Path, start: i64, cutoff: Option<i64>) -> Points {
    let mut expected = Points::new();

    let rows = legacy_rows(start, start + 30 * HOUR);
    write_legacy_partitions(data, &rows);
    add_expected(&mut expected, &rows, cutoff);

    let wal = tsink_legacy::wal::DiskWal::new(data.join("wal"), 4096).unwrap();
    let rows = legacy_rows(start + 28 * HOUR, start + 34 * HOUR);
    for chunk in rows.chunks(5000) {
        wal.append_rows(chunk).unwrap();
        wal.punctuate().unwrap();
    }
    wal.flush().unwrap();
    add_expected(&mut expected, &rows, cutoff);

    expected
}

fn read_all(storage: &dyn Storage) -> Points {
    let mut points = Points::new();
    for metric in ["ping_latency", "ping_failed"] {
        for (labels, series) in storage.select_all(metric, 0, i64::MAX).unwrap() {
            let key = series_key(metric, labels.into_iter().map(|l| (l.name, l.value)));
            let set = points.entry(key).or_default();
            for p in series {
                set.insert((p.timestamp, p.value.as_f64().unwrap().to_bits()));
            }
        }
    }
    points
}

fn count(points: &Points) -> usize {
    points.values().map(|s| s.len()).sum()
}

fn config(data: &Path, retention_days: Option<u32>) -> DatabaseConfig {
    DatabaseConfig {
        path: data.to_string_lossy().into_owned(),
        retention_days,
    }
}

struct Outcome {
    points_rejected: u64,
    failed_partitions: usize,
    state: MigrationState,
}

fn migrate(storage: &dyn Storage, legacy: &Path, retention_days: Option<u32>) -> Outcome {
    let stop = AtomicBool::new(false);
    let status = MigrationStatus::new(MigrationState::NotNeeded);
    let mut migrator = Migrator::new(storage, &stop, &status, retention_days);
    if let Err(e) = migrator.run(legacy) {
        panic!(
            "migration failed: {}, storage health: {:?}",
            e,
            storage.observability_snapshot().health
        );
    }
    Outcome {
        points_rejected: migrator.points_rejected,
        failed_partitions: migrator.failed_partitions,
        state: status.get(),
    }
}

fn start_time() -> i64 {
    // Aligned so partition boundaries are predictable, and recent enough for
    // the retention test.
    let now = chrono::Utc::now().timestamp();
    (now - 40 * HOUR) / HOUR * HOUR
}

#[test]
fn migrates_partitions_and_overlapping_wal_exactly() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let expected = write_legacy_fixture(&data, start_time(), None);
    assert!(count(&expected) > 50_000);

    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();
    let storage = open_storage(&config(&data, None)).unwrap();
    let migrator = migrate(storage.as_ref(), &legacy, None);

    assert_eq!(migrator.points_rejected, 0);
    assert_eq!(migrator.failed_partitions, 0);
    assert!(matches!(
        migrator.state,
        MigrationState::Completed {
            failed_partitions: 0,
            ..
        }
    ));
    assert!(
        !data.join(LEGACY_DIR).exists(),
        "legacy data should be removed"
    );
    assert_eq!(read_all(storage.as_ref()), expected);
    storage.close().unwrap();

    // Survives a restart, and series are still listed (storage stats use this).
    let storage = open_storage(&config(&data, None)).unwrap();
    assert_eq!(read_all(storage.as_ref()), expected);
    assert_eq!(storage.list_metrics().unwrap().len(), expected.len());
    storage.close().unwrap();
}

#[test]
fn migration_pauses_while_the_host_is_under_pressure() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let expected = write_legacy_fixture(&data, start_time(), None);
    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();
    let storage = open_storage(&config(&data, None)).unwrap();

    let stop = AtomicBool::new(false);
    let status = MigrationStatus::new(MigrationState::NotNeeded);
    let checks = Cell::new(0);
    let paused_seen = Cell::new(false);
    let mut migrator = Migrator::new(storage.as_ref(), &stop, &status, None);
    migrator.pressure_poll = Duration::from_millis(10);
    migrator.pressure = Box::new(|| {
        checks.set(checks.get() + 1);
        if let MigrationState::Running {
            paused: Some(reason),
            ..
        } = status.get()
        {
            paused_seen.set(paused_seen.get() || reason.contains("disk IO 70%"));
        }
        // High twice, then in between the thresholds (still paused), then low.
        let io = match checks.get() {
            1 | 2 => 70.0,
            3 => 30.0,
            _ => 1.0,
        };
        Some(HostPressure { memory: 0.0, io })
    });
    migrator.run(&legacy).unwrap();

    assert_eq!(migrator.pressure_pauses, 1);
    assert!(checks.get() > 4);
    assert!(paused_seen.get());
    assert!(matches!(
        status.get(),
        MigrationState::Completed {
            failed_partitions: 0,
            ..
        }
    ));
    assert_eq!(read_all(storage.as_ref()), expected);
    storage.close().unwrap();
}

#[test]
fn partitions_with_two_values_for_one_timestamp_are_migrated() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let start = start_time();
    let mut rows = Vec::new();
    for ts in (start..start + HOUR).step_by(STEP as usize) {
        for value in [1.0, 2.0] {
            rows.push(tsink_legacy::Row::with_labels(
                "ping_latency",
                legacy_labels(0, 1),
                tsink_legacy::DataPoint::new(ts, value),
            ));
        }
    }
    write_legacy_partitions(&data, &rows);
    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();

    let storage = open_storage(&config(&data, None)).unwrap();
    let migrator = migrate(storage.as_ref(), &legacy, None);

    assert_eq!(migrator.failed_partitions, 0);
    assert!(!legacy.exists());
    storage.close().unwrap();
}

#[test]
fn partitions_with_rejected_points_are_kept() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    // Older than the storage's retention; the migrator does not know about
    // it, so tsink refuses the points.
    let start = start_time() - 30 * 24 * HOUR;
    write_legacy_partitions(&data, &legacy_rows(start, start + HOUR));
    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();

    let storage = open_storage(&config(&data, Some(2))).unwrap();
    let migrator = migrate(storage.as_ref(), &legacy, None);

    assert!(migrator.points_rejected > 0);
    assert_eq!(migrator.failed_partitions, 1);
    assert!(std::fs::read_dir(&legacy).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("p-")));
    storage.close().unwrap();
}

#[test]
fn migrating_a_partition_again_does_not_duplicate_points() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let expected = write_legacy_fixture(&data, start_time(), None);
    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();

    // Keep a copy of one partition to simulate a crash before its deletion.
    let partition = std::fs::read_dir(&legacy)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.file_name().unwrap().to_string_lossy().starts_with("p-"))
        .unwrap();
    let backup = dir.path().join("backup");
    copy_dir(&partition, &backup);

    let storage = open_storage(&config(&data, None)).unwrap();
    migrate(storage.as_ref(), &legacy, None);

    copy_dir(&backup, &legacy.join(partition.file_name().unwrap()));
    let migrator = migrate(storage.as_ref(), &legacy, None);

    assert_eq!(migrator.failed_partitions, 0);
    assert!(!legacy.exists());
    assert_eq!(read_all(storage.as_ref()), expected);
    storage.close().unwrap();
}

#[test]
fn live_writes_during_migration_are_not_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let mut expected = write_legacy_fixture(&data, start_time(), None);
    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();
    let storage = open_storage(&config(&data, None)).unwrap();

    let writer_storage = Arc::clone(&storage);
    let done = Arc::new(AtomicBool::new(false));
    let writer_done = Arc::clone(&done);
    let now = chrono::Utc::now().timestamp();
    let writer = std::thread::spawn(move || {
        let mut ts = now;
        let mut written = Vec::new();
        while !writer_done.load(std::sync::atomic::Ordering::Relaxed) || written.len() < 50 {
            let rows: Vec<tsink::Row> = legacy_rows(ts, ts + 1)
                .iter()
                .map(|r| {
                    tsink::Row::with_labels(
                        r.metric(),
                        r.labels()
                            .iter()
                            .map(|l| tsink::Label::new(&l.name, &l.value))
                            .collect(),
                        tsink::DataPoint::new(ts, r.data_point().value),
                    )
                })
                .collect();
            writer_storage.insert_rows(&rows).unwrap();
            written.push(ts);
            ts += STEP;
            std::thread::sleep(Duration::from_millis(2));
        }
        written
    });

    let migrator = migrate(storage.as_ref(), &legacy, None);
    done.store(true, std::sync::atomic::Ordering::Relaxed);
    let written = writer.join().unwrap();

    assert_eq!(migrator.points_rejected, 0);
    assert_eq!(migrator.failed_partitions, 0);
    for ts in written {
        add_expected(&mut expected, &legacy_rows(ts, ts + 1), None);
    }
    assert_eq!(read_all(storage.as_ref()), expected);
    storage.close().unwrap();
}

#[test]
fn points_beyond_retention_are_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    // retention_days = 2 keeps a day of margin: points older than 1 day go.
    let cutoff = chrono::Utc::now().timestamp() - 24 * HOUR;
    let expected = write_legacy_fixture(&data, start_time(), Some(cutoff + 60));
    let legacy = move_legacy_data_aside(&data).unwrap().unwrap();
    let storage = open_storage(&config(&data, Some(2))).unwrap();

    let migrator = migrate(storage.as_ref(), &legacy, Some(2));

    assert_eq!(migrator.failed_partitions, 0);
    assert!(!legacy.exists());
    let migrated = read_all(storage.as_ref());
    let oldest = migrated
        .values()
        .filter_map(|s| s.first())
        .map(|p| p.0)
        .min()
        .unwrap();
    assert!(oldest >= cutoff, "found point older than the cutoff");
    // The cutoff is taken a few ms apart from the test's; compare the stable part.
    let stable = |points: &Points| -> Points {
        points
            .iter()
            .map(|(k, s)| {
                (
                    k.clone(),
                    s.iter().filter(|p| p.0 >= cutoff + 60).copied().collect(),
                )
            })
            .collect()
    };
    assert_eq!(stable(&migrated), stable(&expected));
    storage.close().unwrap();
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
    }
}
