import { useState } from 'react';
import { Statistics } from './components/Statistics';
import { FiltersPanel } from './components/FiltersPanel';
import { ErrorDisplay } from './components/ErrorDisplay';
import { LoadingState } from './components/LoadingState';
import { EmptyState } from './components/EmptyState';
import { ChartGrid } from './components/ChartGrid';
import { usePingData } from './hooks/usePingData';
import { useStatistics } from './hooks/useStatistics';
import { useSynchronizedYDomain } from './hooks/useSynchronizedYDomain';
import { calculateTimeRangeQuery, type TimeRangeOption } from './utils/timeRangeUtils';
import type { PingDataQuery } from './types';
import './App.css';

function App() {
  const [useAggregated, setUseAggregated] = useState(true);
  const [bucketDuration, setBucketDuration] = useState('1m');
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('all');
  const [query, setQuery] = useState<PingDataQuery>(() => ({}));
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [synchronizeYAxis, setSynchronizeYAxis] = useState(false);
  const [limit, setLimit] = useState('');

  const handleTimeRangeChange = (range: TimeRangeOption) => {
    setTimeRange(range);
    const timeQuery = calculateTimeRangeQuery(range);
    setQuery((prev) => ({
      ...prev,
      ...timeQuery,
    }));
  };

  // With relative time ranges, the backend calculates from "now" on each request
  // So we just need to use refetchInterval for auto-refresh
  const shouldUseRefetchInterval = autoRefresh;

  const {
    data,
    aggregatedData,
    loading,
    error,
    refetch,
  } = usePingData({
    useAggregated,
    bucketDuration,
    query,
    enabled: true,
    refetchInterval: shouldUseRefetchInterval ? refreshInterval * 1000 : false,
  });

  const loadData = () => {
    refetch();
  };

  const aggregatedStatistics = useStatistics(aggregatedData);
  const synchronizedYDomain = useSynchronizedYDomain(
    synchronizeYAxis,
    useAggregated,
    aggregatedData,
    data
  );

  const handleLimitChange = (value: string) => {
    setLimit(value);
    setQuery((prev) => ({
      ...prev,
      limit: value ? parseInt(value, 10) : undefined,
    }));
  };

  const handleClearTimeFilter = () => {
    setTimeRange('all');
    setQuery((prev) => {
      const { from, to, ...rest } = prev;
      return rest;
    });
  };

  const hasData = useAggregated
    ? aggregatedData && aggregatedData.data.length > 0
    : data && data.data.length > 0;

  const isEmpty = useAggregated
    ? aggregatedData && aggregatedData.data.length === 0
    : data && data.data.length === 0;

  return (
    <div className="min-h-screen bg-gray-100 w-screen">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">SparkPing Dashboard</h1>
          <p className="text-gray-600">Real-time ping monitoring and visualization</p>
        </header>

        <FiltersPanel
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          useAggregated={useAggregated}
          onUseAggregatedChange={setUseAggregated}
          bucketDuration={bucketDuration}
          onBucketDurationChange={setBucketDuration}
          limit={limit}
          onLimitChange={handleLimitChange}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={setRefreshInterval}
          synchronizeYAxis={synchronizeYAxis}
          onSynchronizeYAxisChange={setSynchronizeYAxis}
          loading={loading}
          onRefresh={loadData}
        />

        {error && <ErrorDisplay error={error instanceof Error ? error.message : 'Failed to fetch data'} />}

        {data && <Statistics statistics={data.statistics} />}
        {aggregatedData && aggregatedStatistics && (
          <Statistics statistics={aggregatedStatistics} />
        )}

        {loading && !data && !aggregatedData ? (
          <LoadingState />
        ) : hasData ? (
          <ChartGrid
            data={data}
            aggregatedData={aggregatedData}
            useAggregated={useAggregated}
            synchronizedYDomain={synchronizedYDomain}
          />
        ) : isEmpty ? (
          <EmptyState query={query} onClearTimeFilter={handleClearTimeFilter} />
        ) : null}
      </div>
    </div>
  );
}

export default App;
