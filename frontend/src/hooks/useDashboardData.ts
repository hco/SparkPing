import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchTargets, fetchPingAggregated } from '../api';
import type { BucketDataPoint, Target } from '../types';

export interface TargetStats {
  target: Target;
  displayName: string;
  latency: {
    min: number | null;
    max: number | null;
    median: number | null;
    avg: number | null;
  };
  packetLoss: number;
  totalPings: number;
  recentData: BucketDataPoint[];
}

interface UseDashboardDataOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useDashboardData({
  enabled = true,
  refetchInterval = 5000,
}: UseDashboardDataOptions = {}) {
  // Fetch all targets
  const targetsQuery = useQuery({
    queryKey: ['targets'],
    queryFn: fetchTargets,
    enabled,
    refetchInterval,
  });

  // Fetch aggregated data for the last hour with 1-minute buckets
  const aggregatedQuery = useQuery({
    queryKey: ['dashboard', 'aggregated', '1h', '1m'],
    queryFn: () => fetchPingAggregated({ from: '1h', bucket: '1m' }),
    enabled,
    refetchInterval,
  });

  // Calculate per-target statistics
  const targetStats = useMemo<TargetStats[]>(() => {
    if (!targetsQuery.data || !aggregatedQuery.data) return [];

    const dataByTarget = new Map<string, BucketDataPoint[]>();
    
    // Group data by target
    for (const bucket of aggregatedQuery.data.data) {
      const existing = dataByTarget.get(bucket.target) || [];
      existing.push(bucket);
      dataByTarget.set(bucket.target, existing);
    }

    return targetsQuery.data.map((target) => {
      const recentData = (dataByTarget.get(target.address) || []).sort(
        (a, b) => a.timestamp_unix - b.timestamp_unix
      );

      if (recentData.length === 0) {
        return {
          target,
          displayName: target.name || target.address,
          latency: { min: null, max: null, median: null, avg: null },
          packetLoss: 0,
          totalPings: 0,
          recentData: [],
        };
      }

      // Calculate statistics from recent data
      const latencies = recentData
        .map((d) => d.avg)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      const minValues = recentData.map((d) => d.min).filter((v): v is number => v !== null);
      const maxValues = recentData.map((d) => d.max).filter((v): v is number => v !== null);

      const totalPings = recentData.reduce((sum, d) => sum + d.count, 0);
      const totalFailed = recentData.reduce((sum, d) => sum + d.failed_count, 0);

      const median = latencies.length > 0 
        ? latencies[Math.floor(latencies.length / 2)] 
        : null;
      
      const avg = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : null;

      return {
        target,
        displayName: target.name || target.address,
        latency: {
          min: minValues.length > 0 ? Math.min(...minValues) : null,
          max: maxValues.length > 0 ? Math.max(...maxValues) : null,
          median,
          avg,
        },
        packetLoss: totalPings > 0 ? (totalFailed / totalPings) * 100 : 0,
        totalPings,
        recentData,
      };
    });
  }, [targetsQuery.data, aggregatedQuery.data]);

  return {
    targetStats,
    isLoading: targetsQuery.isLoading || aggregatedQuery.isLoading,
    error: targetsQuery.error || aggregatedQuery.error,
    refetch: () => {
      targetsQuery.refetch();
      aggregatedQuery.refetch();
    },
  };
}


