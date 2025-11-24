import { useQuery } from '@tanstack/react-query';
import { fetchPingData, fetchPingAggregated } from '../api';
import type { PingDataQuery, PingAggregatedQuery } from '../types';

interface UsePingDataOptions {
  useAggregated: boolean;
  bucketDuration: string;
  query: PingDataQuery;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function usePingData({
  useAggregated,
  bucketDuration,
  query,
  enabled = true,
  refetchInterval = false,
}: UsePingDataOptions) {
  const rawDataQuery = useQuery({
    queryKey: ['pingData', 'raw', query],
    queryFn: () => fetchPingData(query),
    enabled: enabled && !useAggregated,
    refetchInterval,
  });

  const aggregatedQuery: PingAggregatedQuery = {
    from: query.from,
    to: query.to,
    bucket: bucketDuration,
  };

  const aggregatedDataQuery = useQuery({
    queryKey: ['pingData', 'aggregated', aggregatedQuery],
    queryFn: () => fetchPingAggregated(aggregatedQuery),
    enabled: enabled && useAggregated,
    refetchInterval,
  });

  return {
    data: rawDataQuery.data ?? null,
    aggregatedData: aggregatedDataQuery.data ?? null,
    loading: useAggregated ? aggregatedDataQuery.isLoading : rawDataQuery.isLoading,
    error: useAggregated 
      ? aggregatedDataQuery.error 
      : rawDataQuery.error,
    refetch: useAggregated 
      ? aggregatedDataQuery.refetch 
      : rawDataQuery.refetch,
  };
}
