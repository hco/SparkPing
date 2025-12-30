import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchPingAggregated } from '../api';
import type { PingAggregatedQuery } from '../types';

interface UseTargetPingDataOptions {
  target: string;
  bucket?: string;
  from?: number | string;
  to?: number;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useTargetPingData({
  target,
  bucket = '1m',
  from,
  to,
  enabled = true,
  refetchInterval = false,
}: UseTargetPingDataOptions) {
  const query: PingAggregatedQuery = {
    target,
    bucket,
    from,
    to,
  };

  const result = useQuery({
    queryKey: ['targetPingData', target, query],
    queryFn: () => fetchPingAggregated(query),
    enabled: enabled && !!target,
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const targetData = result.data?.data.filter((bucket) => bucket.target === target) ?? [];
  const targetName = targetData[0]?.target_name || target;

  return {
    ...result,
    targetData,
    targetName,
  };
}


