import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { D3LatencyChart } from '@/components/charts/D3LatencyChart';
import { D3PacketLossChart } from '@/components/charts/D3PacketLossChart';
import { D3CombinedChart } from '@/components/charts/D3CombinedChart';
import { D3RRDStyleChart } from '@/components/charts/D3RRDStyleChart';
import { useTargetPingData } from '@/hooks/useTargetPingData';
import { LoadingState } from '@/components/LoadingState';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { EmptyState } from '@/components/EmptyState';
import { calculateTimeRangeQuery, type TimeRangeOption } from '@/utils/timeRangeUtils';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';

export const Route = createFileRoute('/targets/$targetId')({
  component: TargetDetails,
});

function TargetDetails() {
  const { targetId } = Route.useParams();
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('24h');
  const [bucketDuration, setBucketDuration] = useState('1m');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [showSeparateCharts, setShowSeparateCharts] = useState(true);

  const timeQuery = useMemo(() => calculateTimeRangeQuery(timeRange), [timeRange]);

  const {
    data: aggregatedData,
    isLoading,
    error,
    refetch,
  } = useTargetPingData({
    target: targetId,
    bucket: bucketDuration,
    from: timeQuery.from,
    to: timeQuery.to,
    enabled: true,
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
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

        {/* Controls */}
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Range</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as TimeRangeOption)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1h">Last Hour</option>
                <option value="6h">Last 6 Hours</option>
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="all">All Time</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bucket Duration</label>
              <select
                value={bucketDuration}
                onChange={(e) => setBucketDuration(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="30s">30 seconds</option>
                <option value="1m">1 minute</option>
                <option value="5m">5 minutes</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoRefresh"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="autoRefresh" className="text-sm font-medium text-gray-700">
                Auto Refresh
              </label>
            </div>

            {autoRefresh && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Refresh Interval (seconds)
                </label>
                <input
                  type="number"
                  min="1"
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(parseInt(e.target.value, 10) || 5)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="separateCharts"
                checked={showSeparateCharts}
                onChange={(e) => setShowSeparateCharts(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="separateCharts" className="text-sm font-medium text-gray-700">
                Separate Charts
              </label>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Refreshing...' : 'Refresh Now'}
            </button>
          </div>
        </div>

        {error && <ErrorDisplay error={error instanceof Error ? error.message : 'Failed to fetch data'} />}

        {isLoading && !aggregatedData ? (
          <LoadingState />
        ) : hasData ? (
          <div className="space-y-6">
            {showSeparateCharts ? (
              <>
                {/* Latency Chart */}
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">Latency (Min/Max/Average)</h2>
                  <div className="w-full" style={{ height: '500px' }}>
                    <D3LatencyChart data={targetData} height={500} />
                  </div>
                </div>

                {/* Packet Loss Chart */}
                <div className="bg-white p-6 rounded-lg shadow">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">Packet Loss</h2>
                  <div className="w-full" style={{ height: '300px' }}>
                    <D3PacketLossChart data={targetData} height={300} />
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Latency Overview</h2>
                <div className="w-full" style={{ height: '500px' }}>
                  <D3LatencyChart data={targetData} height={500} />
                </div>
              </div>
            )}

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
          <EmptyState query={{ target: targetId }} onClearTimeFilter={() => setTimeRange('all')} />
        ) : null}
      </div>
    </div>
  );
}

