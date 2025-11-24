import { useState, useEffect, useCallback } from 'react';
import { fetchPingData, fetchPingAggregated } from '../api';
import type { PingDataResponse, PingDataQuery, PingAggregatedResponse, PingAggregatedQuery } from '../types';

interface UsePingDataOptions {
  useAggregated: boolean;
  bucketDuration: string;
  query: PingDataQuery;
}

export function usePingData({
  useAggregated,
  bucketDuration,
  query,
}: UsePingDataOptions) {
  const [data, setData] = useState<PingDataResponse | null>(null);
  const [aggregatedData, setAggregatedData] = useState<PingAggregatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (useAggregated) {
        console.log('Loading aggregated data with query:', query, 'bucket:', bucketDuration);
        const aggregatedQuery: PingAggregatedQuery = {
          from: query.from,
          to: query.to,
          bucket: bucketDuration,
        };
        const response = await fetchPingAggregated(aggregatedQuery);
        console.log('Received aggregated response:', response);
        console.log('Buckets:', response.data.length);
        setAggregatedData(response);
        setData(null); // Clear raw data when using aggregated
      } else {
        console.log('Loading raw data with query:', query);
        const response = await fetchPingData(query);
        console.log('Received response:', response);
        console.log('Data points:', response.data.length);
        setData(response);
        setAggregatedData(null); // Clear aggregated data when using raw
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      console.error('Error fetching ping data:', err);
    } finally {
      setLoading(false);
    }
  }, [query, useAggregated, bucketDuration]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    data,
    aggregatedData,
    loading,
    error,
    loadData,
  };
}

