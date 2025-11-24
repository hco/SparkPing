// Type definitions for the SparkPing API

export interface PingDataPoint {
  timestamp: string;
  timestamp_unix: number;
  target: string;
  target_name: string | null;
  sequence: number;
  success: boolean;
  latency_ms: number | null;
  metric_type: string;
}

export interface PingStatistics {
  successful_count: number;
  failed_count: number;
  avg_latency_ms: number | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
  success_rate: number;
}

export interface TimeRange {
  earliest: number;
  latest: number;
}

export interface QueryMetadata {
  target_filter: string | null;
  from_timestamp: number | null;
  to_timestamp: number | null;
  metric_filter: string | null;
  limit: number | null;
  data_time_range: TimeRange | null;
}

export interface PingDataResponse {
  query: QueryMetadata;
  data: PingDataPoint[];
  statistics: PingStatistics;
  total_count: number;
}

export interface PingDataQuery {
  target?: string;
  from?: number;
  to?: number;
  metric?: 'latency' | 'failed' | 'all';
  limit?: number;
}

export interface BucketDataPoint {
  timestamp: string;
  timestamp_unix: number;
  timestamp_end_unix: number;
  target: string;
  target_name: string | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  successful_count: number;
  failed_count: number;
}

export interface PingAggregatedQuery {
  target?: string;
  from?: number;
  to?: number;
  metric?: 'latency' | 'failed' | 'all';
  bucket?: string;
}

export interface PingAggregatedResponse {
  query: QueryMetadata;
  data: BucketDataPoint[];
  total_count: number;
  bucket_duration_seconds: number;
}

