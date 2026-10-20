use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tsink_legacy::disk::DiskPartition;
use tsink_legacy::partition::Partition;
use tsink_legacy::TsinkError;

/// Metrics SparkPing writes; anything else in a partition fails the
/// completeness check and keeps the partition.
const METRICS: [&str; 2] = ["ping_latency", "ping_failed"];

/// A tsink 0.5 partition directory (`p-<min>-<max>`).
#[derive(Debug)]
pub struct LegacyPartition {
    pub path: PathBuf,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

/// One series of a legacy partition, with points sorted by timestamp and
/// exact duplicates removed (tsink 0.10 deduplicates them as well).
#[derive(Debug)]
pub struct LegacySeries {
    pub metric: &'static str,
    pub labels: Vec<tsink::Label>,
    pub points: Vec<(i64, f64)>,
}

/// Lists partitions oldest first.
pub fn list_partitions(legacy_dir: &Path) -> io::Result<Vec<LegacyPartition>> {
    let mut partitions = Vec::new();
    for entry in std::fs::read_dir(legacy_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some((min, max)) = parse_partition_name(&name.to_string_lossy()) else {
            continue;
        };
        if entry.file_type()?.is_dir() {
            partitions.push(LegacyPartition {
                path: entry.path(),
                min_timestamp: min,
                max_timestamp: max,
            });
        }
    }
    partitions.sort_by_key(|p| (p.min_timestamp, p.max_timestamp));
    Ok(partitions)
}

fn parse_partition_name(name: &str) -> Option<(i64, i64)> {
    let (min, max) = name.strip_prefix("p-")?.split_once('-')?;
    Some((min.parse().ok()?, max.parse().ok()?))
}

#[derive(Debug)]
pub enum ReadError {
    /// The partition has no data file content; nothing to migrate.
    Empty,
    Legacy(TsinkError),
    /// Fewer points were read than the partition metadata lists.
    Incomplete {
        read: usize,
        expected: usize,
    },
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::Empty => write!(f, "partition is empty"),
            ReadError::Legacy(e) => write!(f, "{}", e),
            ReadError::Incomplete { read, expected } => {
                write!(f, "read {} of {} points (unknown metrics?)", read, expected)
            }
        }
    }
}

/// Reads all series of a legacy partition. Opens only this partition, so it
/// holds a single file descriptor.
pub fn read_partition(path: &Path) -> Result<Vec<LegacySeries>, ReadError> {
    // A zero retention disables tsink 0.5's expiry check.
    let partition = match DiskPartition::open(path, Duration::ZERO) {
        Ok(partition) => partition,
        Err(TsinkError::NoDataPoints { .. }) => return Err(ReadError::Empty),
        Err(e) => return Err(ReadError::Legacy(e)),
    };

    let mut series = Vec::new();
    let mut read = 0usize;
    for metric in METRICS {
        let selected = partition
            .select_all_labels(metric, i64::MIN, i64::MAX)
            .map_err(ReadError::Legacy)?;
        for (labels, points) in selected {
            read += points.len();
            let mut points: Vec<(i64, f64)> =
                points.iter().map(|p| (p.timestamp, p.value)).collect();
            points.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.to_bits().cmp(&b.1.to_bits())));
            points.dedup_by(|a, b| a.0 == b.0 && a.1.to_bits() == b.1.to_bits());
            series.push(LegacySeries {
                metric,
                labels: labels
                    .iter()
                    .map(|l| tsink::Label::new(&l.name, &l.value))
                    .collect(),
                points,
            });
        }
    }

    let expected = partition.size();
    if read < expected {
        return Err(ReadError::Incomplete { read, expected });
    }
    Ok(series)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_partition_names() {
        assert_eq!(parse_partition_name("p-100-200"), Some((100, 200)));
        assert_eq!(parse_partition_name("p-100"), None);
        assert_eq!(parse_partition_name("wal"), None);
        assert_eq!(parse_partition_name("p-a-b"), None);
    }
}
