use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

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
pub struct PartitionMetadata {
    #[allow(dead_code)]
    pub min_timestamp: i64,
    #[allow(dead_code)]
    pub max_timestamp: i64,
    #[allow(dead_code)]
    pub num_data_points: u64,
    pub metrics: HashMap<String, MetricMetadata>,
}

#[derive(Debug, Deserialize)]
pub struct MetricMetadata {
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub offset: u64,
    pub encoded_size: u64,
    #[allow(dead_code)]
    pub min_timestamp: i64,
    #[allow(dead_code)]
    pub max_timestamp: i64,
    pub num_data_points: u64,
}
