use crate::config::{AppConfig, Target};
use crate::config_file;
use crate::discovery::{run_mdns_discovery, DiscoveryEvent};
use crate::ping::perform_ping;
use crate::storage::write_ping_result;
use async_stream::stream;
use axum::{
    extract::{Path, Query, State, ConnectInfo},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        Json,
    },
    routing::{get, put},
    Router,
};
use std::net::SocketAddr;
use chrono::{DateTime, Utc};
use futures::Stream;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::RwLock;
use tokio::sync::mpsc;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info, warn};
use tsink::Storage;
use uuid::Uuid;

/// Query parameters for the ping data API
#[derive(Debug)]
pub struct PingDataQuery {
    /// Filter by target address (optional)
    pub target: Option<String>,
    /// Start timestamp (Unix timestamp in seconds) or relative time range (e.g., "24h", "7d")
    /// Can be either a number (absolute timestamp) or a string (relative time range)
    pub from: Option<TimeRangeValue>,
    /// End timestamp (Unix timestamp in seconds, optional)
    pub to: Option<i64>,
    /// Filter by metric type: "latency", "failed", or "all" (default: "all")
    pub metric: Option<String>,
    /// Maximum number of results to return (optional, no limit if not specified)
    pub limit: Option<usize>,
}

/// Represents either an absolute timestamp or a relative time range string
#[derive(Debug, Clone)]
pub enum TimeRangeValue {
    Absolute(i64),
    Relative(String),
}

impl<'de> Deserialize<'de> for PingDataQuery {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct PingDataQueryHelper {
            target: Option<String>,
            #[serde(deserialize_with = "deserialize_time_range")]
            from: Option<TimeRangeValue>,
            to: Option<i64>,
            metric: Option<String>,
            limit: Option<usize>,
        }

        let helper = PingDataQueryHelper::deserialize(deserializer)?;
        Ok(PingDataQuery {
            target: helper.target,
            from: helper.from,
            to: helper.to,
            metric: helper.metric,
            limit: helper.limit,
        })
    }
}

/// Custom deserializer for time range values
/// Tries to parse as i64 first (absolute timestamp), otherwise treats as relative string
fn deserialize_time_range<'de, D>(deserializer: D) -> Result<Option<TimeRangeValue>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;

    struct TimeRangeVisitor;

    impl<'de> serde::de::Visitor<'de> for TimeRangeVisitor {
        type Value = Option<TimeRangeValue>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an integer timestamp or a relative time range string")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(None)
        }

        fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
        where
            D: Deserializer<'de>,
        {
            deserializer.deserialize_any(self)
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(Some(TimeRangeValue::Absolute(value)))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(Some(TimeRangeValue::Absolute(value as i64)))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: Error,
        {
            // Try to parse as i64 first (for backward compatibility)
            if let Ok(timestamp) = value.parse::<i64>() {
                return Ok(Some(TimeRangeValue::Absolute(timestamp)));
            }
            // Otherwise treat as relative time range string
            Ok(Some(TimeRangeValue::Relative(value.to_string())))
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: Error,
        {
            // Try to parse as i64 first (for backward compatibility)
            if let Ok(timestamp) = value.parse::<i64>() {
                return Ok(Some(TimeRangeValue::Absolute(timestamp)));
            }
            // Otherwise treat as relative time range string
            Ok(Some(TimeRangeValue::Relative(value)))
        }
    }

    deserializer.deserialize_option(TimeRangeVisitor)
}

/// Query parameters for the aggregated ping data API
#[derive(Debug)]
pub struct PingAggregatedQuery {
    /// Filter by target address (optional)
    pub target: Option<String>,
    /// Start timestamp (Unix timestamp in seconds) or relative time range (e.g., "24h", "7d")
    /// Can be either a number (absolute timestamp) or a string (relative time range)
    pub from: Option<TimeRangeValue>,
    /// End timestamp (Unix timestamp in seconds, optional)
    pub to: Option<i64>,
    /// Filter by metric type: "latency", "failed", or "all" (default: "all")
    pub metric: Option<String>,
    /// Time bucket duration (e.g., "5m", "1h", "30s"). Default: "5m"
    pub bucket: String,
}

impl<'de> Deserialize<'de> for PingAggregatedQuery {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(default)]
        struct PingAggregatedQueryHelper {
            target: Option<String>,
            #[serde(deserialize_with = "deserialize_time_range")]
            from: Option<TimeRangeValue>,
            to: Option<i64>,
            metric: Option<String>,
            bucket: Option<String>,
        }

        impl Default for PingAggregatedQueryHelper {
            fn default() -> Self {
                PingAggregatedQueryHelper {
                    target: None,
                    from: None,
                    to: None,
                    metric: None,
                    bucket: None,
                }
            }
        }

        let helper = PingAggregatedQueryHelper::deserialize(deserializer)?;
        Ok(PingAggregatedQuery {
            target: helper.target,
            from: helper.from,
            to: helper.to,
            metric: helper.metric,
            bucket: helper.bucket.unwrap_or_else(default_bucket),
        })
    }
}

fn default_bucket() -> String {
    "5m".to_string()
}

/// Detailed ping data point with all available information
#[derive(Debug, Serialize)]
pub struct PingDataPoint {
    /// ISO 8601 formatted timestamp
    pub timestamp: String,
    /// Unix timestamp in seconds
    pub timestamp_unix: i64,
    /// Target IP address
    pub target: String,
    /// Target name (if available)
    pub target_name: Option<String>,
    /// Sequence number of the ping
    pub sequence: u16,
    /// Whether the ping was successful
    pub success: bool,
    /// Latency in milliseconds (None if ping failed)
    pub latency_ms: Option<f64>,
    /// Metric type: "ping_latency" or "ping_failed"
    pub metric_type: String,
}

/// Statistics aggregated from the query results
#[derive(Debug, Serialize)]
pub struct PingStatistics {
    /// Total number of successful pings
    pub successful_count: usize,
    /// Total number of failed pings
    pub failed_count: usize,
    /// Average latency in milliseconds (only for successful pings)
    pub avg_latency_ms: Option<f64>,
    /// Minimum latency in milliseconds (only for successful pings)
    pub min_latency_ms: Option<f64>,
    /// Maximum latency in milliseconds (only for successful pings)
    pub max_latency_ms: Option<f64>,
    /// Success rate as a percentage (0-100)
    pub success_rate: f64,
}

/// API response containing ping data and metadata
#[derive(Debug, Serialize)]
pub struct PingDataResponse {
    /// Query metadata
    pub query: QueryMetadata,
    /// Array of ping data points
    pub data: Vec<PingDataPoint>,
    /// Aggregated statistics
    pub statistics: PingStatistics,
    /// Total number of data points returned
    pub total_count: usize,
}

/// Metadata about the query that was executed
#[derive(Debug, Serialize)]
pub struct QueryMetadata {
    /// Target filter applied (if any)
    pub target_filter: Option<String>,
    /// Start timestamp filter (if any)
    pub from_timestamp: Option<i64>,
    /// End timestamp filter (if any)
    pub to_timestamp: Option<i64>,
    /// Metric filter applied (if any)
    pub metric_filter: Option<String>,
    /// Limit applied (if any)
    pub limit: Option<usize>,
    /// Actual time range of returned data
    pub data_time_range: Option<TimeRange>,
}

/// Time range of the actual data returned
#[derive(Debug, Serialize)]
pub struct TimeRange {
    /// Earliest timestamp in the results
    pub earliest: i64,
    /// Latest timestamp in the results
    pub latest: i64,
}

/// Aggregated data point for a time bucket
#[derive(Debug, Serialize, Clone)]
pub struct BucketDataPoint {
    /// ISO 8601 formatted timestamp (start of bucket)
    pub timestamp: String,
    /// Unix timestamp in seconds (start of bucket)
    pub timestamp_unix: i64,
    /// Unix timestamp in seconds (end of bucket)
    pub timestamp_end_unix: i64,
    /// Target IP address
    pub target: String,
    /// Target name (if available)
    pub target_name: Option<String>,
    /// Minimum value in this bucket
    pub min: Option<f64>,
    /// Maximum value in this bucket
    pub max: Option<f64>,
    /// Average value in this bucket
    pub avg: Option<f64>,
    /// Number of data points in this bucket
    pub count: usize,
    /// Number of successful pings in this bucket
    pub successful_count: usize,
    /// Number of failed pings in this bucket
    pub failed_count: usize,
}

/// API response containing aggregated ping data
#[derive(Debug, Serialize)]
pub struct PingAggregatedResponse {
    /// Query metadata
    pub query: QueryMetadata,
    /// Array of aggregated bucket data points
    pub data: Vec<BucketDataPoint>,
    /// Total number of buckets returned
    pub total_count: usize,
    /// Bucket duration in seconds
    pub bucket_duration_seconds: i64,
}

/// Internal query structure with resolved timestamps
struct ResolvedPingDataQuery {
    target: Option<String>,
    from: i64,
    to: i64,
    metric: Option<String>,
    limit: Option<usize>,
}

/// Query ping data with labels properly extracted
fn query_ping_data_with_labels(
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
fn parse_bucket_duration(bucket_str: &str) -> Result<i64, String> {
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
fn parse_relative_time_range(range_str: &str) -> Result<i64, String> {
    parse_bucket_duration(range_str)
}

/// Resolve a TimeRangeValue to an absolute timestamp
/// If it's already absolute, return it as-is
/// If it's relative, parse it and calculate: current_time - seconds
fn resolve_time_range_value(value: &TimeRangeValue) -> Result<i64, String> {
    match value {
        TimeRangeValue::Absolute(timestamp) => Ok(*timestamp),
        TimeRangeValue::Relative(range_str) => {
            let seconds = parse_relative_time_range(range_str)?;
            let now = Utc::now().timestamp();
            Ok(now - seconds)
        }
    }
}

/// Aggregate ping data points into time buckets, grouped by target
fn aggregate_into_buckets(
    points: &[PingDataPoint],
    bucket_duration_seconds: i64,
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
            let latencies: Vec<f64> = successful.iter().filter_map(|p| p.latency_ms).collect();

            let min = latencies.iter().copied().reduce(f64::min);
            let max = latencies.iter().copied().reduce(f64::max);
            let avg = if !latencies.is_empty() {
                Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
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
fn calculate_statistics(points: &[PingDataPoint]) -> PingStatistics {
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

/// HTTP handler for GET /api/ping/data
pub async fn get_ping_data(
    State(state): State<AppState>,
    Query(query): Query<PingDataQuery>,
) -> Result<Json<PingDataResponse>, (StatusCode, String)> {
    let storage = &*state.storage;
    info!("Querying ping data: {:?}", query);

    // Resolve relative time range to absolute timestamp
    let resolved_from = if let Some(ref from_value) = query.from {
        resolve_time_range_value(from_value).map_err(|e| {
            error!("Invalid time range: {}", e);
            (StatusCode::BAD_REQUEST, e)
        })?
    } else {
        0
    };
    let resolved_to = query.to.unwrap_or(i64::MAX);

    // Store resolved timestamp for response metadata
    let resolved_from_timestamp = Some(resolved_from);

    // Create resolved query for internal use
    let resolved_query = ResolvedPingDataQuery {
        target: query.target.clone(),
        from: resolved_from,
        to: resolved_to,
        metric: query.metric.clone(),
        limit: query.limit,
    };

    let points = query_ping_data_with_labels(storage, &resolved_query).map_err(|e| {
        error!("Error querying ping data: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let statistics = calculate_statistics(&points);

    let data_time_range = if !points.is_empty() {
        Some(TimeRange {
            earliest: points.first().unwrap().timestamp_unix,
            latest: points.last().unwrap().timestamp_unix,
        })
    } else {
        None
    };

    let response = PingDataResponse {
        query: QueryMetadata {
            target_filter: query.target.clone(),
            from_timestamp: resolved_from_timestamp,
            to_timestamp: query.to,
            metric_filter: query.metric.clone(),
            limit: query.limit,
            data_time_range,
        },
        data: points,
        statistics,
        total_count: 0, // Will be set below
    };

    // Set total_count after creating response
    let total_count = response.data.len();
    let mut response = response;
    response.total_count = total_count;

    Ok(Json(response))
}

/// HTTP handler for GET /api/ping/aggregated
pub async fn get_ping_aggregated(
    State(state): State<AppState>,
    Query(query): Query<PingAggregatedQuery>,
) -> Result<Json<PingAggregatedResponse>, (StatusCode, String)> {
    let storage = &*state.storage;
    info!("Querying aggregated ping data: {:?}", query);

    // Parse bucket duration
    let bucket_duration_seconds = parse_bucket_duration(&query.bucket).map_err(|e| {
        error!("Invalid bucket duration: {}", e);
        (StatusCode::BAD_REQUEST, e)
    })?;

    // Resolve relative time range to absolute timestamp
    let resolved_from = if let Some(ref from_value) = query.from {
        resolve_time_range_value(from_value).map_err(|e| {
            error!("Invalid time range: {}", e);
            (StatusCode::BAD_REQUEST, e)
        })?
    } else {
        0
    };
    let resolved_to = query.to.unwrap_or(i64::MAX);

    // Store resolved timestamp for response metadata
    let resolved_from_timestamp = Some(resolved_from);

    // Create resolved query for internal use
    let resolved_query = ResolvedPingDataQuery {
        target: query.target.clone(),
        from: resolved_from,
        to: resolved_to,
        metric: query.metric.clone(),
        limit: None, // No limit for aggregation
    };

    let points = query_ping_data_with_labels(storage, &resolved_query).map_err(|e| {
        error!("Error querying ping data: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Aggregate into buckets
    let bucket_data = aggregate_into_buckets(&points, bucket_duration_seconds);

    let data_time_range = if !points.is_empty() {
        Some(TimeRange {
            earliest: points.first().unwrap().timestamp_unix,
            latest: points.last().unwrap().timestamp_unix,
        })
    } else {
        None
    };

    let total_count = bucket_data.len();

    let response = PingAggregatedResponse {
        query: QueryMetadata {
            target_filter: query.target.clone(),
            from_timestamp: resolved_from_timestamp,
            to_timestamp: query.to,
            metric_filter: query.metric.clone(),
            limit: None,
            data_time_range,
        },
        data: bucket_data,
        total_count,
        bucket_duration_seconds,
    };

    Ok(Json(response))
}

/// Start a ping task for a target and return its abort handle
fn start_ping_task(
    target: &Target,
    storage: Arc<dyn Storage>,
    socket_type: crate::config::SocketType,
) -> tokio::task::AbortHandle {
    let target_id = target.id.clone();
    let target_address = target.address.clone();
    let target_name = target.name.clone();
    let ping_count = target.ping_count;
    let ping_interval = target.ping_interval;

    let handle = tokio::spawn(async move {
        loop {
            // Perform ping_count pings back-to-back (no delay between them)
            for sequence in 1..=ping_count {
                let result =
                    perform_ping(&target_id, &target_address, sequence, &target_name, socket_type).await;

                // Write result to tsink
                if let Err(e) = write_ping_result(&*storage, &result) {
                    error!("Error writing ping result to tsink: {}", e);
                }
            }

            // Wait ping_interval seconds before next batch of pings
            tokio::time::sleep(std::time::Duration::from_secs(ping_interval)).await;
        }
    })
    .abort_handle();

    handle
}

/// Application state for API routes
#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub config: Arc<RwLock<AppConfig>>,
    pub task_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
    pub write_flag: Arc<AtomicBool>,
    pub config_path: PathBuf,
}

/// Request body for creating/updating a target
#[derive(Debug, Deserialize)]
pub struct TargetRequest {
    pub id: Option<String>,
    pub address: String,
    pub name: Option<String>,
    pub ping_count: Option<u16>,
    pub ping_interval: Option<u64>,
}

/// HTTP handler for GET /api/targets
pub async fn get_targets(
    State(state): State<AppState>,
) -> Result<Json<Vec<Target>>, (StatusCode, String)> {
    let config = state.config.read().map_err(|e| {
        error!("Failed to read config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read configuration".to_string(),
        )
    })?;

    Ok(Json(config.targets.clone()))
}

/// HTTP handler for POST /api/targets
pub async fn create_target(
    State(state): State<AppState>,
    Json(request): Json<TargetRequest>,
) -> Result<Json<Target>, (StatusCode, String)> {
    // Validate address
    if request.address.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Address is required".to_string()));
    }

    // Read current config
    let mut config = state.config.write().map_err(|e| {
        error!("Failed to write config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access configuration".to_string(),
        )
    })?;

    // Generate ID if not provided
    let id = request.id.unwrap_or_else(|| Uuid::new_v4().to_string());

    // Check if ID already exists
    if config.targets.iter().any(|t| t.id == id) {
        return Err((
            StatusCode::CONFLICT,
            format!("Target with id '{}' already exists", id),
        ));
    }

    // Create new target
    let new_target = Target {
        id: id.clone(),
        address: request.address,
        name: request.name,
        ping_count: request.ping_count.unwrap_or(3),
        ping_interval: request.ping_interval.unwrap_or(1),
    };

    // Read config file
    let mut doc = config_file::read_config_file(&state.config_path).map_err(|e| {
        error!("Failed to read config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config file: {}", e),
        )
    })?;

    // Add target to document
    config_file::add_target(&mut doc, &new_target).map_err(|e| {
        error!("Failed to add target: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to add target: {}", e),
        )
    })?;

    // Write config file
    config_file::write_config_file(&state.config_path, &doc, &state.write_flag).map_err(|e| {
        error!("Failed to write config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write config file: {}", e),
        )
    })?;

    // Update in-memory config
    config.targets.push(new_target.clone());
    drop(config);

    // Start ping task immediately
    {
        let config = state.config.read().map_err(|e| {
            error!("Failed to read config: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access config".to_string(),
            )
        })?;
        let socket_type = config.ping.socket_type;
        drop(config);

        let mut handles = state.task_handles.write().map_err(|e| {
            error!("Failed to write task handles: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access task handles".to_string(),
            )
        })?;
        let handle = start_ping_task(&new_target, Arc::clone(&state.storage), socket_type);
        handles.insert(new_target.id.clone(), handle);
    }

    Ok(Json(new_target))
}

/// HTTP handler for PUT /api/targets/{id}
pub async fn update_target(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<TargetRequest>,
) -> Result<Json<Target>, (StatusCode, String)> {
    // Validate address
    if request.address.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Address is required".to_string()));
    }

    // Read current config
    let mut config = state.config.write().map_err(|e| {
        error!("Failed to write config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access configuration".to_string(),
        )
    })?;

    // Find target
    let target_idx = config
        .targets
        .iter()
        .position(|t| t.id == id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Target with id '{}' not found", id),
            )
        })?;

    // Create updated target
    let updated_target = Target {
        id: request
            .id
            .unwrap_or_else(|| config.targets[target_idx].id.clone()),
        address: request.address,
        name: request.name,
        ping_count: request
            .ping_count
            .unwrap_or(config.targets[target_idx].ping_count),
        ping_interval: request
            .ping_interval
            .unwrap_or(config.targets[target_idx].ping_interval),
    };

    // Read config file
    let mut doc = config_file::read_config_file(&state.config_path).map_err(|e| {
        error!("Failed to read config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config file: {}", e),
        )
    })?;

    // Update target in document
    config_file::update_target(&mut doc, &id, &updated_target).map_err(|e| {
        error!("Failed to update target: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update target: {}", e),
        )
    })?;

    // Write config file
    config_file::write_config_file(&state.config_path, &doc, &state.write_flag).map_err(|e| {
        error!("Failed to write config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write config file: {}", e),
        )
    })?;

    // Update in-memory config and get socket_type before dropping
    config.targets[target_idx] = updated_target.clone();
    let socket_type = config.ping.socket_type;
    drop(config);

    // Restart ping task immediately
    {
        let mut handles = state.task_handles.write().map_err(|e| {
            error!("Failed to write task handles: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access task handles".to_string(),
            )
        })?;
        if let Some(old_handle) = handles.remove(&id) {
            old_handle.abort();
        }
        let handle = start_ping_task(&updated_target, Arc::clone(&state.storage), socket_type);
        handles.insert(updated_target.id.clone(), handle);
    }

    Ok(Json(updated_target))
}

/// Storage statistics per target
#[derive(Debug, Serialize, Clone)]
pub struct TargetStorageStats {
    /// Target ID
    pub target_id: String,
    /// Total storage size in bytes
    pub size_bytes: u64,
    /// Total number of data points
    pub data_point_count: u64,
    /// Earliest data point timestamp (Unix seconds)
    pub earliest_timestamp: Option<i64>,
    /// Latest data point timestamp (Unix seconds)
    pub latest_timestamp: Option<i64>,
}

/// API response for storage statistics
#[derive(Debug, Serialize)]
pub struct StorageStatsResponse {
    /// Total storage size in bytes (all targets)
    pub total_size_bytes: u64,
    /// Storage stats per target
    pub targets: Vec<TargetStorageStats>,
}

/// Metadata structure for tsink partition files
#[derive(Debug, Deserialize)]
struct PartitionMetadata {
    #[allow(dead_code)]
    min_timestamp: i64,
    #[allow(dead_code)]
    max_timestamp: i64,
    #[allow(dead_code)]
    num_data_points: u64,
    metrics: HashMap<String, MetricMetadata>,
}

#[derive(Debug, Deserialize)]
struct MetricMetadata {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    offset: u64,
    encoded_size: u64,
    #[allow(dead_code)]
    min_timestamp: i64,
    #[allow(dead_code)]
    max_timestamp: i64,
    num_data_points: u64,
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
fn calculate_storage_stats(data_path: &str) -> Result<StorageStatsResponse, Box<dyn std::error::Error>> {
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
                    let stats = target_stats.entry(target_id.clone()).or_insert(TargetStorageStats {
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

/// HTTP handler for GET /api/storage/stats
pub async fn get_storage_stats(
    State(state): State<AppState>,
) -> Result<Json<StorageStatsResponse>, (StatusCode, String)> {
    let config = state.config.read().map_err(|e| {
        error!("Failed to read config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read configuration".to_string(),
        )
    })?;
    
    let data_path = config.database.path.clone();
    drop(config);
    
    let stats = calculate_storage_stats(&data_path).map_err(|e| {
        error!("Failed to calculate storage stats: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to calculate storage stats: {}", e),
        )
    })?;
    
    Ok(Json(stats))
}

/// HTTP handler for DELETE /api/targets/{id}
pub async fn delete_target(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Read current config
    let mut config = state.config.write().map_err(|e| {
        error!("Failed to write config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access configuration".to_string(),
        )
    })?;

    // Check if target exists
    if !config.targets.iter().any(|t| t.id == id) {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Target with id '{}' not found", id),
        ));
    }

    // Read config file
    let mut doc = config_file::read_config_file(&state.config_path).map_err(|e| {
        error!("Failed to read config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config file: {}", e),
        )
    })?;

    // Remove target from document
    config_file::remove_target(&mut doc, &id).map_err(|e| {
        error!("Failed to remove target: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to remove target: {}", e),
        )
    })?;

    // Write config file
    config_file::write_config_file(&state.config_path, &doc, &state.write_flag).map_err(|e| {
        error!("Failed to write config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write config file: {}", e),
        )
    })?;

    // Update in-memory config
    config.targets.retain(|t| t.id != id);
    drop(config);

    // Stop ping task
    {
        let mut handles = state.task_handles.write().map_err(|e| {
            error!("Failed to write task handles: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access task handles".to_string(),
            )
        })?;
        if let Some(handle) = handles.remove(&id) {
            handle.abort();
        }
    }

    Ok(StatusCode::NO_CONTENT)
}


/// HTTP handler for GET /api/discovery/start (SSE endpoint)
///
/// Starts device discovery and streams discovered devices as SSE events.
/// Discovery runs indefinitely until the client closes the connection.
pub async fn start_discovery() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    info!("Starting indefinite device discovery");

    let stream = stream! {
        let (tx, mut rx) = mpsc::channel::<DiscoveryEvent>(100);

        // Spawn the discovery task
        tokio::spawn(async move {
            run_mdns_discovery(tx).await;
        });

        // Stream events as they arrive
        // Discovery runs until the client disconnects (which closes rx)
        while let Some(event) = rx.recv().await {
            match serde_json::to_string(&event) {
                Ok(json) => {
                    yield Ok(Event::default().data(json));
                }
                Err(e) => {
                    error!("Failed to serialize discovery event: {}", e);
                }
            }

            // If this was an error event, we're done
            if matches!(event, DiscoveryEvent::Error { .. }) {
                break;
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Home Assistant ingress IP addresses
/// The ingress gateway can be at either 172.30.32.1 or 172.30.32.2 depending on the setup
const HA_INGRESS_IPS: &[&str] = &["172.30.32.1", "172.30.32.2"];

/// Create the API router
pub fn create_router(
    storage: Arc<dyn Storage>,
    config: Arc<RwLock<AppConfig>>,
    task_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
    write_flag: Arc<AtomicBool>,
    config_path: PathBuf,
    static_dir: Option<PathBuf>,
) -> Router {
    // Convert config_path to actual file path (config crate uses path without extension)
    // The API needs the full path with .toml extension to read/write the file
    let config_file_path = if config_path.extension().is_none() {
        config_path.with_extension("toml")
    } else {
        config_path
    };
    
    let state = AppState {
        storage,
        config,
        task_handles,
        write_flag,
        config_path: config_file_path,
    };

    // Check if ingress-only filtering is enabled
    let ingress_only_enabled = {
        let config = state.config.read().ok();
        config.map(|c| c.server.home_assistant_ingress_only).unwrap_or(false)
    };

    let mut router = Router::new()
        .route("/api/ping/data", get(get_ping_data))
        .route("/api/ping/aggregated", get(get_ping_aggregated))
        .route("/api/targets", get(get_targets).post(create_target))
        .route("/api/targets/:id", put(update_target).delete(delete_target))
        .route("/api/storage/stats", get(get_storage_stats))
        .route("/api/discovery/start", get(start_discovery))
        .with_state(state);

    // Apply IP filtering middleware if home_assistant_ingress_only is enabled
    if ingress_only_enabled {
        info!("Home Assistant ingress-only mode enabled - restricting access to {:?}", HA_INGRESS_IPS);
        // Create a middleware that captures the ingress_only_enabled value
        router = router.layer(axum::middleware::from_fn(
            move |req: axum::http::Request<axum::body::Body>,
                  next: axum::middleware::Next| {
                let ingress_enabled = ingress_only_enabled;
                async move {
                    if ingress_enabled {
                        // Determine the remote peer IP from the connection info.
                        // In Home Assistant ingress mode, the TCP peer should be the
                        // supervisor's ingress proxy (typically 172.30.32.1 or 172.30.32.2).
                        // The original client (browser) IP is usually forwarded via
                        // X-Forwarded-For; we log it for diagnostics but do not use
                        // it for access control.
                        let peer_ip = req
                            .extensions()
                            .get::<ConnectInfo<SocketAddr>>()
                            .map(|ci| ci.ip());

                        let forwarded_for = req
                            .headers()
                            .get("x-forwarded-for")
                            .and_then(|h| h.to_str().ok())
                            .map(|s| s.to_string());

                        // Check if peer IP matches any of the allowed ingress IPs
                        let is_allowed = if let Some(ip) = peer_ip {
                            let ip_str = ip.to_string();
                            HA_INGRESS_IPS.contains(&ip_str.as_str())
                        } else {
                            // Fallback: if ConnectInfo is not available, check X-Forwarded-For
                            // The last IP in the chain should be the ingress gateway
                            if let Some(ref xff) = forwarded_for {
                                let ips: Vec<&str> = xff.split(',').map(|s| s.trim()).collect();
                                // Check if any IP in the chain matches an ingress IP
                                ips.iter().any(|ip| HA_INGRESS_IPS.contains(ip))
                            } else {
                                false
                            }
                        };

                        if !is_allowed {
                            warn!(
                                "Rejected request - peer IP: {:?}, X-Forwarded-For: {:?}",
                                peer_ip.map(|ip| ip.to_string()),
                                forwarded_for
                            );
                            return Err(StatusCode::FORBIDDEN);
                        }
                    }
                    Ok(next.run(req).await)
                }
            },
        ));
    }

    // Add static file serving if static directory is provided
    if let Some(static_path) = static_dir {
        let index_path = static_path.join("index.html");
        
        // Serve static files with fallback to index.html for SPA routing
        let serve_dir = ServeDir::new(&static_path)
            .not_found_service(ServeFile::new(&index_path));
        
        router = router.nest_service("/", serve_dir);
    }

    router
}
