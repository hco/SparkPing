use super::dto::{
    BucketDataPoint, PartitionMetadata, Percentiles, PingDataPoint, PingStatistics,
    TargetStorageStats, TimeRangeValue,
};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::fs;
use tracing::warn;
use tsink::Storage;

/// Internal query structure with resolved timestamps
pub(super) struct ResolvedPingDataQuery {
    pub target: Option<String>,
    pub from: i64,
    pub to: i64,
    pub metric: Option<String>,
    pub limit: Option<usize>,
}

/// Query ping data with labels properly extracted
pub(super) fn query_ping_data_with_labels(
    storage: &dyn Storage,
    query: &ResolvedPingDataQuery,
) -> Result<Vec<PingDataPoint>, Box<dyn std::error::Error>> {
    let from_ts = query.from;
    let to_ts = query.to;

    let mut all_points = Vec::new();

    // Query both metrics if needed
    let metrics_to_query = match query.metric.as_deref() {
        Some("latency") => vec!["ping_latency"],
        Some("failed") => vec!["ping_failed"],
        _ => vec!["ping_latency", "ping_failed"],
    };

    for metric_name in metrics_to_query {
        if let Some(ref target) = &query.target {
            // Query all label combinations and filter by target
            let all_results = storage.select_all(metric_name, from_ts, to_ts)?;
            for (labels, points) in all_results {
                // Check if this matches our target filter
                let matches_target = labels
                    .iter()
                    .any(|l| l.name == "target" && &l.value == target);

                if matches_target {
                    let target_name = labels
                        .iter()
                        .find(|l| l.name == "target_name")
                        .map(|l| l.value.clone());

                    let sequence = labels
                        .iter()
                        .find(|l| l.name == "sequence")
                        .and_then(|l| l.value.parse::<u16>().ok())
                        .unwrap_or(0);

                    let success = metric_name == "ping_latency";

                    for point in points {
                        all_points.push(PingDataPoint {
                            timestamp: DateTime::from_timestamp(point.timestamp, 0)
                                .unwrap_or_else(|| Utc::now())
                                .to_rfc3339(),
                            timestamp_unix: point.timestamp,
                            target: target.clone(),
                            target_name: target_name.clone(),
                            sequence,
                            success,
                            latency_ms: if success { Some(point.value) } else { None },
                            metric_type: metric_name.to_string(),
                        });
                    }
                }
            }
        } else {
            // Query all label combinations
            let all_results = storage.select_all(metric_name, from_ts, to_ts)?;
            for (labels, points) in all_results {
                let target = labels
                    .iter()
                    .find(|l| l.name == "target")
                    .map(|l| l.value.clone())
                    .unwrap_or_else(|| "unknown".to_string());

                let target_name = labels
                    .iter()
                    .find(|l| l.name == "target_name")
                    .map(|l| l.value.clone());

                let sequence = labels
                    .iter()
                    .find(|l| l.name == "sequence")
                    .and_then(|l| l.value.parse::<u16>().ok())
                    .unwrap_or(0);

                let success = metric_name == "ping_latency";

                for point in points {
                    all_points.push(PingDataPoint {
                        timestamp: DateTime::from_timestamp(point.timestamp, 0)
                            .unwrap_or_else(|| Utc::now())
                            .to_rfc3339(),
                        timestamp_unix: point.timestamp,
                        target: target.clone(),
                        target_name: target_name.clone(),
                        sequence,
                        success,
                        latency_ms: if success { Some(point.value) } else { None },
                        metric_type: metric_name.to_string(),
                    });
                }
            }
        }
    }

    // Sort by timestamp
    all_points.sort_by_key(|p| p.timestamp_unix);

    // Apply limit if specified
    if let Some(limit) = query.limit {
        all_points.truncate(limit);
    }

    Ok(all_points)
}

/// Parse bucket duration string (e.g., "5m", "1h", "30s") into seconds
pub(super) fn parse_bucket_duration(bucket_str: &str) -> Result<i64, String> {
    if bucket_str.is_empty() {
        return Err("Bucket duration cannot be empty".to_string());
    }

    let bucket_str = bucket_str.trim().to_lowercase();
    let (number_str, unit) = if let Some(pos) = bucket_str.chars().position(|c| c.is_alphabetic()) {
        let (num, unit) = bucket_str.split_at(pos);
        (num, unit)
    } else {
        return Err(format!(
            "Invalid bucket format: '{}'. Expected format like '5m', '1h', '30s'",
            bucket_str
        ));
    };

    let number: i64 = number_str
        .parse()
        .map_err(|_| format!("Invalid number in bucket duration: '{}'", number_str))?;

    let seconds = match unit {
        "s" | "sec" | "second" | "seconds" => number,
        "m" | "min" | "minute" | "minutes" => number * 60,
        "h" | "hour" | "hours" => number * 3600,
        "d" | "day" | "days" => number * 86400,
        _ => {
            return Err(format!(
                "Unknown time unit: '{}'. Supported: s, m, h, d",
                unit
            ))
        }
    };

    if seconds <= 0 {
        return Err("Bucket duration must be positive".to_string());
    }

    Ok(seconds)
}

/// Parse relative time range string (e.g., "1h", "24h", "7d") into seconds
/// Uses the same logic as parse_bucket_duration for consistency
pub(super) fn parse_relative_time_range(range_str: &str) -> Result<i64, String> {
    parse_bucket_duration(range_str)
}

/// Resolve a TimeRangeValue to an absolute timestamp
/// If it's already absolute, return it as-is
/// If it's relative, parse it and calculate: current_time - seconds
pub(super) fn resolve_time_range_value(value: &TimeRangeValue) -> Result<i64, String> {
    match value {
        TimeRangeValue::Absolute(timestamp) => Ok(*timestamp),
        TimeRangeValue::Relative(range_str) => {
            let seconds = parse_relative_time_range(range_str)?;
            let now = Utc::now().timestamp();
            Ok(now - seconds)
        }
    }
}

/// Calculate percentiles from a sorted vector of values
fn calculate_percentiles(sorted_values: &[f64]) -> Option<Percentiles> {
    if sorted_values.is_empty() {
        return None;
    }

    let percentile = |p: f64| -> f64 {
        let index = (p * (sorted_values.len() - 1) as f64).round() as usize;
        sorted_values[index.min(sorted_values.len() - 1)]
    };

    Some(Percentiles {
        p50: percentile(0.50),
        p75: percentile(0.75),
        p90: percentile(0.90),
        p95: percentile(0.95),
        p99: percentile(0.99),
    })
}

/// Aggregate ping data points into time buckets, grouped by target
pub(super) fn aggregate_into_buckets(
    points: &[PingDataPoint],
    bucket_duration_seconds: i64,
    include_percentiles: bool,
) -> Vec<BucketDataPoint> {
    if points.is_empty() || bucket_duration_seconds <= 0 {
        return Vec::new();
    }

    // Create buckets grouped by (target, bucket_start)
    let mut buckets: HashMap<(String, i64), Vec<&PingDataPoint>> = HashMap::new();

    for point in points {
        // Calculate which bucket this point belongs to
        let bucket_start =
            (point.timestamp_unix / bucket_duration_seconds) * bucket_duration_seconds;
        let key = (point.target.clone(), bucket_start);
        buckets.entry(key).or_insert_with(Vec::new).push(point);
    }

    // Convert buckets to sorted vector of BucketDataPoint
    let mut bucket_points: Vec<_> = buckets
        .into_iter()
        .map(|((target, bucket_start), bucket_points)| {
            let bucket_end = bucket_start + bucket_duration_seconds;

            // Get target_name from first point (should be same for all points with same target)
            let target_name = bucket_points.first().and_then(|p| p.target_name.clone());

            // Separate successful and failed pings
            let successful: Vec<_> = bucket_points.iter().filter(|p| p.success).collect();
            let failed: Vec<_> = bucket_points.iter().filter(|p| !p.success).collect();

            // Calculate min, max, avg for successful pings (latency)
            let mut latencies: Vec<f64> = successful.iter().filter_map(|p| p.latency_ms).collect();

            let min = latencies.iter().copied().reduce(f64::min);
            let max = latencies.iter().copied().reduce(f64::max);
            let avg = if !latencies.is_empty() {
                Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
            } else {
                None
            };

            // Calculate percentiles if requested
            let percentiles = if include_percentiles && !latencies.is_empty() {
                latencies.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                calculate_percentiles(&latencies)
            } else {
                None
            };

            BucketDataPoint {
                timestamp: DateTime::from_timestamp(bucket_start, 0)
                    .unwrap_or_else(|| Utc::now())
                    .to_rfc3339(),
                timestamp_unix: bucket_start,
                timestamp_end_unix: bucket_end,
                target,
                target_name,
                min,
                max,
                avg,
                percentiles,
                count: bucket_points.len(),
                successful_count: successful.len(),
                failed_count: failed.len(),
            }
        })
        .collect();

    // Sort by target, then by timestamp
    bucket_points.sort_by(|a, b| {
        a.target
            .cmp(&b.target)
            .then_with(|| a.timestamp_unix.cmp(&b.timestamp_unix))
    });

    bucket_points
}

/// Calculate statistics from ping data points
pub(super) fn calculate_statistics(points: &[PingDataPoint]) -> PingStatistics {
    let successful: Vec<_> = points.iter().filter(|p| p.success).collect();
    let failed: Vec<_> = points.iter().filter(|p| !p.success).collect();

    let successful_count = successful.len();
    let failed_count = failed.len();
    let total = successful_count + failed_count;

    let success_rate = if total > 0 {
        (successful_count as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    let latencies: Vec<f64> = successful.iter().filter_map(|p| p.latency_ms).collect();

    let avg_latency_ms = if !latencies.is_empty() {
        Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
    } else {
        None
    };

    let min_latency_ms = latencies.iter().copied().reduce(f64::min);
    let max_latency_ms = latencies.iter().copied().reduce(f64::max);

    PingStatistics {
        successful_count,
        failed_count,
        avg_latency_ms,
        min_latency_ms,
        max_latency_ms,
        success_rate,
    }
}

/// Extract target_id from a hex-encoded metric name
/// The format is: 2-byte LE length + metric_name, then pairs of (2-byte LE length + label_name, 2-byte LE length + label_value)
fn extract_target_id_from_metric_name(hex_name: &str) -> Option<String> {
    // Decode hex to bytes
    let bytes = hex::decode(hex_name).ok()?;

    let mut pos = 0;

    // Helper to read a 2-byte little-endian length and the following string
    let read_string = |bytes: &[u8], pos: &mut usize| -> Option<String> {
        if *pos + 2 > bytes.len() {
            return None;
        }
        let len = (bytes[*pos] as usize) | ((bytes[*pos + 1] as usize) << 8);
        *pos += 2;

        if *pos + len > bytes.len() {
            return None;
        }
        let s = String::from_utf8_lossy(&bytes[*pos..*pos + len]).to_string();
        *pos += len;
        Some(s)
    };

    // Skip the metric name (first string)
    read_string(&bytes, &mut pos)?;

    // Read label pairs
    while pos < bytes.len() {
        let label_name = read_string(&bytes, &mut pos)?;
        let label_value = read_string(&bytes, &mut pos)?;

        if label_name == "target_id" {
            return Some(label_value);
        }
    }

    None
}

/// Calculate storage statistics per target by reading tsink partition metadata
pub(super) fn calculate_storage_stats(
    data_path: &str,
) -> Result<super::dto::StorageStatsResponse, Box<dyn std::error::Error>> {
    use super::dto::StorageStatsResponse;

    let data_dir = std::path::Path::new(data_path);
    let mut target_stats: HashMap<String, TargetStorageStats> = HashMap::new();
    let mut total_size: u64 = 0;

    // Read all partition directories
    if data_dir.exists() {
        for entry in fs::read_dir(data_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Skip non-directories and the wal directory
            if !path.is_dir() {
                continue;
            }

            let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if dir_name == "wal" || !dir_name.starts_with("p-") {
                continue;
            }

            // Read meta.json
            let meta_path = path.join("meta.json");
            if !meta_path.exists() {
                continue;
            }

            // Also add the data file size
            let data_path = path.join("data");
            if data_path.exists() {
                if let Ok(metadata) = fs::metadata(&data_path) {
                    total_size += metadata.len();
                }
            }

            let meta_content = match fs::read_to_string(&meta_path) {
                Ok(content) => content,
                Err(e) => {
                    warn!("Failed to read meta.json at {:?}: {}", meta_path, e);
                    continue;
                }
            };

            let partition_meta: PartitionMetadata = match serde_json::from_str(&meta_content) {
                Ok(meta) => meta,
                Err(e) => {
                    warn!("Failed to parse meta.json at {:?}: {}", meta_path, e);
                    continue;
                }
            };

            // Process each metric in the partition
            for (_metric_key, metric_meta) in partition_meta.metrics {
                // Extract target_id from the metric name (which is hex-encoded)
                if let Some(target_id) = extract_target_id_from_metric_name(&metric_meta.name) {
                    let stats =
                        target_stats
                            .entry(target_id.clone())
                            .or_insert(TargetStorageStats {
                                target_id,
                                size_bytes: 0,
                                data_point_count: 0,
                                earliest_timestamp: None,
                                latest_timestamp: None,
                            });
                    stats.size_bytes += metric_meta.encoded_size;
                    stats.data_point_count += metric_meta.num_data_points;

                    // Update earliest timestamp
                    stats.earliest_timestamp = Some(match stats.earliest_timestamp {
                        Some(current) => current.min(metric_meta.min_timestamp),
                        None => metric_meta.min_timestamp,
                    });

                    // Update latest timestamp
                    stats.latest_timestamp = Some(match stats.latest_timestamp {
                        Some(current) => current.max(metric_meta.max_timestamp),
                        None => metric_meta.max_timestamp,
                    });
                }
            }
        }
    }

    // Add WAL size to total
    let wal_dir = data_dir.join("wal");
    if wal_dir.exists() {
        for entry in fs::read_dir(&wal_dir)? {
            let entry = entry?;
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    total_size += metadata.len();
                }
            }
        }
    }

    // If we don't have partition data contributing to total, sum up target sizes
    if total_size == 0 {
        total_size = target_stats.values().map(|s| s.size_bytes).sum();
    }

    let mut targets: Vec<TargetStorageStats> = target_stats.into_values().collect();
    targets.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    Ok(StorageStatsResponse {
        total_size_bytes: total_size,
        targets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_percentiles() {
        // Test with a simple sorted array
        let values = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let percentiles = calculate_percentiles(&values).unwrap();

        // Check that percentiles are in ascending order
        assert!(percentiles.p50 <= percentiles.p75);
        assert!(percentiles.p75 <= percentiles.p90);
        assert!(percentiles.p90 <= percentiles.p95);
        assert!(percentiles.p95 <= percentiles.p99);

        // Check approximate values (median should be around 5.5)
        assert!((percentiles.p50 - 5.5).abs() < 1.0);
        assert!(percentiles.p99 > percentiles.p50);
    }

    #[test]
    fn test_calculate_percentiles_empty() {
        let values: Vec<f64> = vec![];
        let percentiles = calculate_percentiles(&values);
        assert!(percentiles.is_none());
    }

    #[test]
    fn test_calculate_percentiles_single_value() {
        let values = vec![42.0];
        let percentiles = calculate_percentiles(&values).unwrap();

        // All percentiles should be the same value
        assert_eq!(percentiles.p50, 42.0);
        assert_eq!(percentiles.p75, 42.0);
        assert_eq!(percentiles.p90, 42.0);
        assert_eq!(percentiles.p95, 42.0);
        assert_eq!(percentiles.p99, 42.0);
    }
}
