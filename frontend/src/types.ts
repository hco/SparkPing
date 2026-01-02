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
  from?: number | string; // Can be absolute timestamp (number) or relative time range (string like "24h", "7d")
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
  from?: number | string; // Can be absolute timestamp (number) or relative time range (string like "24h", "7d")
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

export interface Target {
  id: string;
  address: string;
  name?: string | null;
  ping_count: number;
  ping_interval: number;
}

export interface TargetRequest {
  id?: string;
  address: string;
  name?: string | null;
  ping_count?: number;
  ping_interval?: number;
}

export interface TargetStorageStats {
  target_id: string;
  size_bytes: number;
  data_point_count: number;
  earliest_timestamp: number | null;
  latest_timestamp: number | null;
}

export interface StorageStatsResponse {
  total_size_bytes: number;
  targets: TargetStorageStats[];
}

// Device discovery types

export interface DiscoveredService {
  /** Service type (e.g., "_http._tcp.local.") */
  service_type: string;
  /** Full DNS name of the service (e.g., "MyDevice._http._tcp.local.") */
  fullname: string;
  /** Service instance name (e.g., "MyDevice") */
  instance_name: string;
  /** Port number the service is running on */
  port: number;
  /** TXT record properties as key-value pairs */
  txt_properties: Record<string, string>;
}

export interface DiscoveredDevice {
  /** Human-readable name of the device (primary name) */
  name: string;
  /** Primary IP address of the device (first IPv4, or first IPv6 if no IPv4) */
  address: string;
  /** All IP addresses (IPv4 and IPv6) */
  addresses: string[];
  /** Hostname of the device (e.g., "device.local.") */
  hostname: string;
  /** All services discovered on this device */
  services: DiscoveredService[];
  /** Combined TXT properties from all services (merged) */
  txt_properties: Record<string, string>;
  /** TTL (Time To Live) if available */
  ttl: number | null;
  /** The method used to discover this device */
  discovery_method: string;
}

export type DiscoveryEvent =
  | { event_type: 'device_found'; device: DiscoveredDevice }
  | { event_type: 'device_updated'; device: DiscoveredDevice }
  | { event_type: 'started'; message: string }
  | { event_type: 'completed'; message: string; device_count: number }
  | { event_type: 'error'; message: string };

// IP Scan Discovery types

export interface SubnetSuggestion {
  /** Human-readable label for this subnet */
  label: string;
  /** The subnet in CIDR notation (e.g., "192.168.1.0/24") */
  cidr: string;
  /** Subnet mask (e.g., "255.255.255.0") */
  subnet_mask: string;
  /** First usable IP in the range */
  start_ip: string;
  /** Last usable IP in the range */
  end_ip: string;
  /** Number of hosts in this subnet */
  host_count: number;
  /** Source of this suggestion (e.g., "local", "traceroute") */
  source: string;
}
