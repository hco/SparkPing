import { useMemo } from 'react';
import type { PingAggregatedResponse, PingStatistics } from '../types';

export function useStatistics(
  aggregatedData: PingAggregatedResponse | null
): PingStatistics | null {
  return useMemo(() => {
    if (!aggregatedData || aggregatedData.data.length === 0) return null;
    
    let totalSuccessful = 0;
    let totalFailed = 0;
    const latencies: number[] = [];
    
    aggregatedData.data.forEach(bucket => {
      totalSuccessful += bucket.successful_count;
      totalFailed += bucket.failed_count;
      
      // Collect latency values for min/max/avg calculation
      if (bucket.min !== null) latencies.push(bucket.min);
      if (bucket.max !== null) latencies.push(bucket.max);
    });
    
    const totalCount = totalSuccessful + totalFailed;
    const successRate = totalCount > 0 ? (totalSuccessful / totalCount) * 100 : 0;
    
    // Calculate weighted average latency from bucket averages
    let weightedSum = 0;
    let totalWeight = 0;
    aggregatedData.data.forEach(bucket => {
      if (bucket.avg !== null && bucket.count > 0) {
        weightedSum += bucket.avg * bucket.count;
        totalWeight += bucket.count;
      }
    });
    const avgLatency = totalWeight > 0 ? weightedSum / totalWeight : null;
    
    // Get min and max from all buckets
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : null;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;
    
    return {
      successful_count: totalSuccessful,
      failed_count: totalFailed,
      avg_latency_ms: avgLatency,
      min_latency_ms: minLatency,
      max_latency_ms: maxLatency,
      success_rate: successRate,
    };
  }, [aggregatedData]);
}

