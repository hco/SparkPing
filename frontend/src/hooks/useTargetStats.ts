import { useMemo } from 'react';
import type { BucketDataPoint } from '../types';

/**
 * Calculated statistics for a target including latency percentiles and packet loss.
 * 
 * Extracted from the target details route to enable isolated testing and reuse
 * across different target visualization views.
 */
export interface TargetStats {
  mean: number;
  min: number | null;
  max: number | null;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  totalPings: number;
  totalSuccess: number;
  totalFailed: number;
  packetLoss: number;
}

/**
 * Calculates latency statistics including percentiles from aggregated ping data.
 * 
 * Extracted to enable isolated testing of statistics calculations and potential
 * reuse across different target visualization views. This hook centralizes the
 * complex percentile calculation logic that was previously embedded in the
 * target details component.
 * 
 * @param data - Array of aggregated bucket data points for the target
 * @returns Calculated statistics or null if no valid data is available
 */
export function useTargetStats(data: BucketDataPoint[]): TargetStats | null {
  return useMemo(() => {
    if (!data.length) return null;

    // Collect all average latencies (non-null)
    const latencies = data
      .map((d) => d.avg)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    if (latencies.length === 0) return null;

    const percentile = (arr: number[], p: number) => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    const sum = latencies.reduce((a, b) => a + b, 0);
    const totalPings = data.reduce((a, d) => a + d.count, 0);
    const totalSuccess = data.reduce((a, d) => a + d.successful_count, 0);
    const totalFailed = data.reduce((a, d) => a + d.failed_count, 0);

    // Get actual min/max from the buckets
    const minValues = data.map((d) => d.min).filter((v): v is number => v !== null);
    const maxValues = data.map((d) => d.max).filter((v): v is number => v !== null);

    return {
      mean: sum / latencies.length,
      min: minValues.length ? Math.min(...minValues) : null,
      max: maxValues.length ? Math.max(...maxValues) : null,
      p50: percentile(latencies, 50),
      p75: percentile(latencies, 75),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      totalPings,
      totalSuccess,
      totalFailed,
      packetLoss: totalPings > 0 ? (totalFailed / totalPings) * 100 : 0,
    };
  }, [data]);
}

