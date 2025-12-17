import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { D3LatencyChart } from '@/components/charts/D3LatencyChart';
import { D3PacketLossChart } from '@/components/charts/D3PacketLossChart';
import { D3CombinedChart } from '@/components/charts/D3CombinedChart';
import { D3RRDStyleChart } from '@/components/charts/D3RRDStyleChart';
import { D3SmokeChart } from '@/components/charts/D3SmokeChart';
import { TimeControls } from '@/components/TimeControls';
import { useTargetPingData } from '@/hooks/useTargetPingData';
import { LoadingState } from '@/components/LoadingState';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { EmptyState } from '@/components/EmptyState';
import { calculateTimeRangeQuery, type TimeRangeOption } from '@/utils/timeRangeUtils';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const TIME_RANGE_VALUES = ['1h', '6h', '12h', '24h', '7d', '30d', 'all'] as const;
const BUCKET_DURATION_VALUES = ['1s', '5s', '10s', '30s', '1m', '5m', '15m', '1h'] as const;

type SearchParams = {
  timeRange?: TimeRangeOption;
  bucket?: string;
  refresh?: boolean;
  interval?: number;
};

export const Route = createFileRoute('/targets/$targetId')({
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const timeRange = TIME_RANGE_VALUES.includes(search.timeRange as TimeRangeOption)
      ? (search.timeRange as TimeRangeOption)
      : '1h';
    const bucket = BUCKET_DURATION_VALUES.includes(search.bucket as (typeof BUCKET_DURATION_VALUES)[number])
      ? (search.bucket as string)
      : '10s';
    const refresh = typeof search.refresh === 'boolean' ? search.refresh : true;
    const interval = typeof search.interval === 'number' && search.interval >= 1 ? search.interval : 5;

    return { timeRange, bucket, refresh, interval };
  },
  component: TargetDetails,
});

function TargetDetails() {
  const { targetId } = Route.useParams();
  const { timeRange, bucket, refresh, interval } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [showLegacyCharts, setShowLegacyCharts] = useState(false);

  const updateSearch = (updates: Partial<SearchParams>) => {
    navigate({
      search: (prev) => ({ ...prev, ...updates }),
      replace: true,
    });
  };

  const timeQuery = useMemo(() => calculateTimeRangeQuery(timeRange!), [timeRange]);

  const {
    data: aggregatedData,
    isLoading,
    error,
    refetch,
  } = useTargetPingData({
    target: targetId,
    bucket: bucket!,
    from: timeQuery.from,
    to: timeQuery.to,
    enabled: true,
    refetchInterval: refresh ? interval! * 1000 : false,
  });

  const targetData = useMemo(() => {
    if (!aggregatedData) return [];
    return aggregatedData.data.filter((bucket) => bucket.target === targetId);
  }, [aggregatedData, targetId]);

  const targetName = useMemo(() => {
    return targetData[0]?.target_name || targetId;
  }, [targetData, targetId]);

  const hasData = targetData.length > 0;
  const isEmpty = aggregatedData && targetData.length === 0;

  return (
    <div className="min-h-screen bg-gray-100 w-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">{targetName}</h1>
          <p className="text-gray-600">Target: {targetId}</p>
        </div>

        {/* Time Controls */}
        <TimeControls
          timeRange={timeRange!}
          onTimeRangeChange={(value) => updateSearch({ timeRange: value })}
          bucketDuration={bucket!}
          onBucketDurationChange={(value) => updateSearch({ bucket: value })}
          autoRefresh={refresh!}
          onAutoRefreshChange={(value) => updateSearch({ refresh: value })}
          refreshInterval={interval!}
          onRefreshIntervalChange={(value) => updateSearch({ interval: value })}
          loading={isLoading}
          onRefresh={() => refetch()}
        />

        {/* Chart Options */}
        <div className="bg-card p-4 rounded-lg border shadow-sm mb-6">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="separate-charts"
              checked={showLegacyCharts}
              onCheckedChange={(checked) => setShowLegacyCharts(checked === true)}
            />
            <Label htmlFor="separate-charts" className="text-sm font-normal cursor-pointer">
              Show Legacy Charts
            </Label>
          </div>
        </div>

        {error && <ErrorDisplay error={error instanceof Error ? error.message : 'Failed to fetch data'} />}

        {isLoading && !aggregatedData ? (
          <LoadingState />
        ) : hasData ? (
          <div className="space-y-6">
            {/* Smoke Chart */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Latency Distribution (Smoke View)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Visualizes individual ping results as smoke-like density, median RTT line, and packet loss severity bars
              </p>
              <div className="w-full" style={{ height: '500px' }}>
                <D3SmokeChart data={targetData} height={500} />
              </div>
            </div>
            {showLegacyCharts && (
              <>
               <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Latency Overview</h2>
                <div className="w-full" style={{ height: '500px' }}>
                  <D3LatencyChart data={targetData} height={500} />
                </div>
             
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Packet Loss</h2>
                <div className="w-full" style={{ height: '300px' }}>
                  <D3PacketLossChart data={targetData} height={300} />
                </div>
                </div>
              {/* Combined Chart - All Metrics */}
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">Combined View - All Metrics</h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Latency ranges shown as color-coded bars (avg markers) with packet loss intensity bars below
                  </p>
                  <div className="w-full" style={{ height: '500px' }}>
                    <D3CombinedChart data={targetData} height={500} />
                  </div>
                </div>

                {/* RRD-Style Chart */}
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">Performance Overview (RRD-Style)</h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Classic network monitoring visualization with latency range shading, average line, and color-coded packet loss indicators
                  </p>
                  <div className="w-full" style={{ height: '500px' }}>
                    <D3RRDStyleChart data={targetData} height={500} />
                  </div>
                </div>
              </>
            )}


            {/* Statistics */}
            {aggregatedData && (
              <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Statistics</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-gray-600">Total Buckets</div>
                    <div className="text-2xl font-bold text-gray-800">{targetData.length}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Bucket Duration</div>
                    <div className="text-2xl font-bold text-gray-800">
                      {aggregatedData.bucket_duration_seconds}s
                    </div>
                  </div>
                  {aggregatedData.query.data_time_range && (
                    <>
                      <div>
                        <div className="text-sm text-gray-600">From</div>
                        <div className="text-sm font-semibold text-gray-800">
                          {new Date(aggregatedData.query.data_time_range.earliest * 1000).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">To</div>
                        <div className="text-sm font-semibold text-gray-800">
                          {new Date(aggregatedData.query.data_time_range.latest * 1000).toLocaleString()}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : isEmpty ? (
          <EmptyState query={{ target: targetId }} onClearTimeFilter={() => updateSearch({ timeRange: 'all' })} />
        ) : null}
      </div>
    </div>
  );
}
