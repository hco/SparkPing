use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tracing::info;

/// Directory inside the data path that holds tsink 0.5 data awaiting migration.
pub const LEGACY_DIR: &str = "legacy-v05";

/// WAL directories written by tsink 0.5 (`wal-recovery` came from SparkPing's
/// own streaming recovery). Listed oldest first.
pub const LEGACY_WAL_DIRS: [&str; 2] = ["wal-recovery", "wal"];

/// Moves tsink 0.5 data (`p-*` partitions and `*.wal` segments) out of the way
/// so tsink 0.10 never opens a directory containing the old format.
///
/// Safe to run on every start and after an interrupted run: whatever is still
/// in the old place is moved, whatever already moved stays. Partition
/// directories left completely empty by failed flushes are deleted.
///
/// Returns the legacy directory if it holds data to migrate.
pub fn move_legacy_data_aside(data_path: &Path) -> io::Result<Option<PathBuf>> {
    let legacy_dir = data_path.join(LEGACY_DIR);
    if !data_path.exists() {
        return Ok(None);
    }

    let mut moved_partitions = 0usize;
    let mut removed_empty = 0usize;
    for entry in fs::read_dir(data_path)? {
        let entry = entry?;
        let name = entry.file_name();
        if !entry.file_type()?.is_dir() || !name.to_string_lossy().starts_with("p-") {
            continue;
        }
        let path = entry.path();
        if fs::read_dir(&path)?.next().is_none() {
            fs::remove_dir(&path)?;
            removed_empty += 1;
            continue;
        }
        fs::create_dir_all(&legacy_dir)?;
        fs::rename(&path, legacy_dir.join(&name))?;
        moved_partitions += 1;
    }

    let mut moved_segments = 0usize;
    for wal_dir_name in LEGACY_WAL_DIRS {
        let wal_dir = data_path.join(wal_dir_name);
        if !wal_dir.is_dir() {
            continue;
        }
        for segment in legacy_wal_segments(&wal_dir)? {
            let target_dir = legacy_dir.join(wal_dir_name);
            fs::create_dir_all(&target_dir)?;
            fs::rename(&segment, unused_path(&target_dir, &segment))?;
            moved_segments += 1;
        }
        // tsink 0.10 recreates `wal/` with its own files; only the
        // SparkPing-specific recovery directory is removed once empty.
        if wal_dir_name != "wal" && fs::read_dir(&wal_dir)?.next().is_none() {
            fs::remove_dir(&wal_dir)?;
        }
    }

    if moved_partitions + moved_segments + removed_empty > 0 {
        info!(
            "Moved tsink 0.5 data to {:?}: {} partitions, {} WAL segments ({} empty partitions removed)",
            legacy_dir, moved_partitions, moved_segments, removed_empty
        );
    }

    if legacy_dir.is_dir() && fs::read_dir(&legacy_dir)?.next().is_some() {
        Ok(Some(legacy_dir))
    } else {
        Ok(None)
    }
}

/// Target path for `source` in `dir` that does not overwrite an existing file.
/// tsink 0.5 restarts segment numbering in an empty WAL directory, so a
/// segment name can repeat if the old version ran again after an upgrade.
fn unused_path(dir: &Path, source: &Path) -> PathBuf {
    let mut candidate = dir.join(source.file_name().unwrap_or_default());
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{}-{}.wal", stem, n));
        n += 1;
    }
    candidate
}

/// Returns tsink 0.5 WAL segments (`NNNNNN.wal`) in `dir`, oldest first.
/// tsink 0.10 names its segments `wal-*.log`, so they are never matched.
pub fn legacy_wal_segments(dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut segments: Vec<((u64, u64), PathBuf)> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().is_some_and(|ext| ext == "wal") {
            let order = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(segment_order)
                .unwrap_or((u64::MAX, 0));
            segments.push((order, path));
        }
    }
    segments.sort();
    Ok(segments.into_iter().map(|(_, path)| path).collect())
}

/// Sort key for a segment stem: `000002` is (2, 0), and `000002-1`, renamed by
/// `unused_path` because it was moved later, is (2, 1).
fn segment_order(stem: &str) -> (u64, u64) {
    let (index, suffix) = stem.split_once('-').unwrap_or((stem, "0"));
    (
        index.parse().unwrap_or(u64::MAX),
        suffix.parse().unwrap_or(u64::MAX),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn missing_data_dir_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let result = move_legacy_data_aside(&dir.path().join("missing")).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn moves_partitions_and_segments_and_drops_empty_partitions() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        touch(&data.join("p-100-200/meta.json"));
        touch(&data.join("p-100-200/data"));
        fs::create_dir_all(data.join("p-300-400")).unwrap();
        touch(&data.join("wal/000002.wal"));
        touch(&data.join("wal/000010.wal"));
        touch(&data.join("wal-recovery/000001.wal"));
        // tsink 0.10 files must stay where they are
        touch(&data.join("wal/wal-0000000000000000.log"));
        touch(&data.join("series_index.bin"));

        let legacy = move_legacy_data_aside(data).unwrap().unwrap();

        assert_eq!(legacy, data.join(LEGACY_DIR));
        assert!(legacy.join("p-100-200/meta.json").exists());
        assert!(!data.join("p-100-200").exists());
        assert!(!data.join("p-300-400").exists());
        assert!(!legacy.join("p-300-400").exists());
        assert_eq!(
            legacy_wal_segments(&legacy.join("wal")).unwrap(),
            vec![legacy.join("wal/000002.wal"), legacy.join("wal/000010.wal")]
        );
        assert!(legacy.join("wal-recovery/000001.wal").exists());
        assert!(!data.join("wal-recovery").exists());
        assert!(data.join("wal/wal-0000000000000000.log").exists());
        assert!(data.join("series_index.bin").exists());
    }

    #[test]
    fn rerunning_after_a_partial_move_finishes_it() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        touch(&data.join(LEGACY_DIR).join("p-100-200/data"));
        touch(&data.join("p-300-400/data"));

        let legacy = move_legacy_data_aside(data).unwrap().unwrap();
        assert!(legacy.join("p-100-200/data").exists());
        assert!(legacy.join("p-300-400/data").exists());

        // Nothing left to move: still reports the pending legacy data.
        assert_eq!(move_legacy_data_aside(data).unwrap(), Some(legacy));
    }

    #[test]
    fn repeated_segment_names_are_kept_and_ordered_by_move() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        touch(&data.join(LEGACY_DIR).join("wal/000002.wal"));
        touch(&data.join(LEGACY_DIR).join("wal/000003.wal"));
        touch(&data.join("wal/000002.wal"));

        let legacy = move_legacy_data_aside(data).unwrap().unwrap();

        assert_eq!(
            legacy_wal_segments(&legacy.join("wal")).unwrap(),
            vec![
                legacy.join("wal/000002.wal"),
                legacy.join("wal/000002-1.wal"),
                legacy.join("wal/000003.wal"),
            ]
        );
    }

    #[test]
    fn fresh_tsink_010_directory_has_no_legacy_data() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        touch(&data.join("wal/wal-0000000000000000.log"));
        touch(&data.join("lane_numeric/x"));

        assert_eq!(move_legacy_data_aside(data).unwrap(), None);
        assert!(!data.join(LEGACY_DIR).exists());
    }
}
