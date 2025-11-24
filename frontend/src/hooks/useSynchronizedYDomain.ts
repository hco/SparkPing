import { useMemo } from 'react';
import type { PingDataResponse, PingAggregatedResponse } from '../types';

export function useSynchronizedYDomain(
  synchronizeYAxis: boolean,
  useAggregated: boolean,
  aggregatedData: PingAggregatedResponse | null,
  data: PingDataResponse | null
): [number, number] | null {
  return useMemo(() => {
    if (!synchronizeYAxis) return null;
    
    const allLatencies: number[] = [];
    
    if (useAggregated && aggregatedData) {
      aggregatedData.data.forEach(bucket => {
        if (bucket.avg !== null) allLatencies.push(bucket.avg);
        if (bucket.min !== null) allLatencies.push(bucket.min);
        if (bucket.max !== null) allLatencies.push(bucket.max);
      });
    } else if (data) {
      // For raw data, we need to calculate min/max/avg per timestamp
      const grouped = new Map<number, typeof data.data>();
      data.data.forEach(point => {
        const key = point.timestamp_unix;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(point);
      });
      
      grouped.forEach(points => {
        const successful = points.filter(p => p.success);
        if (successful.length > 0) {
          const latencies = successful.map(p => p.latency_ms || 0);
          allLatencies.push(...latencies);
        }
      });
    }
    
    if (allLatencies.length === 0) return null;
    
    const maxLatency = Math.max(...allLatencies);
    return [0, maxLatency + 10] as [number, number];
  }, [synchronizeYAxis, useAggregated, aggregatedData, data]);
}

