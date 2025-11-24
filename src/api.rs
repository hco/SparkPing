use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::collections::HashMap;
use tsink::Storage;
use tracing::{error, info};

/// Query parameters for the ping data API
#[derive(Debug, Deserialize)]
pub struct PingDataQuery {
    /// Filter by target address (optional)
    pub target: Option<String>,
    /// Start timestamp (Unix timestamp in seconds, optional)
    pub from: Option<i64>,
    /// End timestamp (Unix timestamp in seconds, optional)
    pub to: Option<i64>,
    /// Filter by metric type: "latency", "failed", or "all" (default: "all")
    pub metric: Option<String>,
    /// Maximum number of results to return (optional, no limit if not specified)
    pub limit: Option<usize>,
}

/// Query parameters for the aggregated ping data API
#[derive(Debug, Deserialize)]
pub struct PingAggregatedQuery {
    /// Filter by target address (optional)
    pub target: Option<String>,
    /// Start timestamp (Unix timestamp in seconds, optional)
    pub from: Option<i64>,
    /// End timestamp (Unix timestamp in seconds, optional)
    pub to: Option<i64>,
    /// Filter by metric type: "latency", "failed", or "all" (default: "all")
    pub metric: Option<String>,
    /// Time bucket duration (e.g., "5m", "1h", "30s"). Default: "5m"
    #[serde(default = "default_bucket")]
    pub bucket: String,
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

/// Query ping data with labels properly extracted
fn query_ping_data_with_labels(
    storage: &dyn Storage,
    query: &PingDataQuery,
) -> Result<Vec<PingDataPoint>, Box<dyn std::error::Error>> {
    let from_ts = query.from.unwrap_or(0);
    let to_ts = query.to.unwrap_or(i64::MAX);
    
    let mut all_points = Vec::new();
    
    // Query both metrics if needed
    let metrics_to_query = match query.metric.as_deref() {
        Some("latency") => vec!["ping_latency"],
        Some("failed") => vec!["ping_failed"],
        _ => vec!["ping_latency", "ping_failed"],
    };
    
    for metric_name in metrics_to_query {
        if let Some(ref target) = query.target {
            // Query all label combinations and filter by target
            let all_results = storage.select_all(metric_name, from_ts, to_ts)?;
            for (labels, points) in all_results {
                // Check if this matches our target filter
                let matches_target = labels.iter().any(|l| {
                    l.name == "target" && &l.value == target
                });
                
                if matches_target {
                    let target_name = labels.iter()
                        .find(|l| l.name == "target_name")
                        .map(|l| l.value.clone());
                    
                    let sequence = labels.iter()
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
                let target = labels.iter()
                    .find(|l| l.name == "target")
                    .map(|l| l.value.clone())
                    .unwrap_or_else(|| "unknown".to_string());
                
                let target_name = labels.iter()
                    .find(|l| l.name == "target_name")
                    .map(|l| l.value.clone());
                
                let sequence = labels.iter()
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
        return Err(format!("Invalid bucket format: '{}'. Expected format like '5m', '1h', '30s'", bucket_str));
    };
    
    let number: i64 = number_str.parse()
        .map_err(|_| format!("Invalid number in bucket duration: '{}'", number_str))?;
    
    let seconds = match unit {
        "s" | "sec" | "second" | "seconds" => number,
        "m" | "min" | "minute" | "minutes" => number * 60,
        "h" | "hour" | "hours" => number * 3600,
        "d" | "day" | "days" => number * 86400,
        _ => return Err(format!("Unknown time unit: '{}'. Supported: s, m, h, d", unit)),
    };
    
    if seconds <= 0 {
        return Err("Bucket duration must be positive".to_string());
    }
    
    Ok(seconds)
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
        let bucket_start = (point.timestamp_unix / bucket_duration_seconds) * bucket_duration_seconds;
        let key = (point.target.clone(), bucket_start);
        buckets.entry(key).or_insert_with(Vec::new).push(point);
    }
    
    // Convert buckets to sorted vector of BucketDataPoint
    let mut bucket_points: Vec<_> = buckets
        .into_iter()
        .map(|((target, bucket_start), bucket_points)| {
            let bucket_end = bucket_start + bucket_duration_seconds;
            
            // Get target_name from first point (should be same for all points with same target)
            let target_name = bucket_points.first()
                .and_then(|p| p.target_name.clone());
            
            // Separate successful and failed pings
            let successful: Vec<_> = bucket_points.iter()
                .filter(|p| p.success)
                .collect();
            let failed: Vec<_> = bucket_points.iter()
                .filter(|p| !p.success)
                .collect();
            
            // Calculate min, max, avg for successful pings (latency)
            let latencies: Vec<f64> = successful.iter()
                .filter_map(|p| p.latency_ms)
                .collect();
            
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
        a.target.cmp(&b.target)
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
    
    let latencies: Vec<f64> = successful.iter()
        .filter_map(|p| p.latency_ms)
        .collect();
    
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
    State(storage): State<Arc<dyn Storage>>,
    Query(query): Query<PingDataQuery>,
) -> Result<Json<PingDataResponse>, (StatusCode, String)> {
    info!("Querying ping data: {:?}", query);
    
    let points = query_ping_data_with_labels(&*storage, &query)
        .map_err(|e| {
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
            from_timestamp: query.from,
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
    State(storage): State<Arc<dyn Storage>>,
    Query(query): Query<PingAggregatedQuery>,
) -> Result<Json<PingAggregatedResponse>, (StatusCode, String)> {
    info!("Querying aggregated ping data: {:?}", query);
    
    // Parse bucket duration
    let bucket_duration_seconds = parse_bucket_duration(&query.bucket)
        .map_err(|e| {
            error!("Invalid bucket duration: {}", e);
            (StatusCode::BAD_REQUEST, e)
        })?;
    
    // Get raw data points
    let ping_query = PingDataQuery {
        target: query.target.clone(),
        from: query.from,
        to: query.to,
        metric: query.metric.clone(),
        limit: None, // No limit for aggregation
    };
    
    let points = query_ping_data_with_labels(&*storage, &ping_query)
        .map_err(|e| {
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
            from_timestamp: query.from,
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

/// Create the API router
pub fn create_router(storage: Arc<dyn Storage>) -> Router {
    Router::new()
        .route("/api/ping/data", get(get_ping_data))
        .route("/api/ping/aggregated", get(get_ping_aggregated))
        .with_state(storage)
}

