use super::dto::{StorageStatsResponse, TargetStorageStats};
use std::collections::HashMap;
use std::path::Path;
use tsink::{QueryOptions, Storage};

/// Windows (seconds back from now) searched for a target's latest point.
/// Scanning the full history would decode every point of a series.
const LATEST_POINT_WINDOWS: [i64; 3] = [3600, 24 * 3600, 7 * 24 * 3600];

/// Storage statistics: total size on disk and the time range covered per target.
pub(super) fn calculate_storage_stats(
    storage: &dyn Storage,
    data_path: &Path,
) -> Result<StorageStatsResponse, Box<dyn std::error::Error + Send + Sync>> {
    let now = chrono::Utc::now().timestamp();
    let mut target_stats: HashMap<String, TargetStorageStats> = HashMap::new();

    for series in storage.list_metrics()? {
        let Some(target_id) = series
            .labels
            .iter()
            .find(|l| l.name == "target_id")
            .map(|l| l.value.clone())
        else {
            continue;
        };

        // Paginated raw reads stop after the first point instead of decoding
        // the whole series.
        let earliest = storage
            .select_with_options(
                &series.name,
                QueryOptions::new(0, i64::MAX)
                    .with_labels(series.labels.clone())
                    .with_pagination(0, Some(1)),
            )?
            .first()
            .map(|p| p.timestamp);

        let mut latest = None;
        for window in LATEST_POINT_WINDOWS {
            let points = storage.select(&series.name, &series.labels, now - window, now + 60)?;
            if let Some(ts) = points.iter().map(|p| p.timestamp).max() {
                latest = Some(ts);
                break;
            }
        }

        let stats = target_stats
            .entry(target_id.clone())
            .or_insert(TargetStorageStats {
                target_id,
                earliest_timestamp: None,
                latest_timestamp: None,
            });
        stats.earliest_timestamp = min_option(stats.earliest_timestamp, earliest);
        stats.latest_timestamp = stats.latest_timestamp.max(latest);
    }

    let mut targets: Vec<TargetStorageStats> = target_stats.into_values().collect();
    targets.sort_by(|a, b| a.target_id.cmp(&b.target_id));

    Ok(StorageStatsResponse {
        total_size_bytes: directory_size(data_path),
        targets,
    })
}

fn min_option(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

/// Total size of all files below `path`; unreadable entries count as zero.
fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => directory_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}
