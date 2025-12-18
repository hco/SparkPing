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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { chartColorClasses, getPacketLossClass } from '@/lib/chartColors';

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

  // Calculate statistics including percentiles
  const stats = useMemo(() => {
    if (!targetData.length) return null;

    // Collect all average latencies (non-null)
    const latencies = targetData
      .map((d) => d.avg)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    if (latencies.length === 0) return null;

    const percentile = (arr: number[], p: number) => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    const sum = latencies.reduce((a, b) => a + b, 0);
    const totalPings = targetData.reduce((a, d) => a + d.count, 0);
    const totalSuccess = targetData.reduce((a, d) => a + d.successful_count, 0);
    const totalFailed = targetData.reduce((a, d) => a + d.failed_count, 0);

    // Get actual min/max from the buckets
    const minValues = targetData.map((d) => d.min).filter((v): v is number => v !== null);
    const maxValues = targetData.map((d) => d.max).filter((v): v is number => v !== null);

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
  }, [targetData]);

  const hasData = targetData.length > 0;
  const isEmpty = aggregatedData && targetData.length === 0;

  return (
    <div className="min-h-screen bg-background w-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-foreground mb-2">{targetName}</h1>
          <p className="text-muted-foreground">Target: {targetId}</p>
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

        {error && <ErrorDisplay error={error instanceof Error ? error.message : 'Failed to fetch data'} />}

        {isLoading && !aggregatedData ? (
          <LoadingState />
        ) : hasData ? (
          <div className="space-y-6">
            {/* Smoke Chart */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
              <h2 className="text-xl font-semibold text-foreground mb-4">Latency Distribution (Smoke View)</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Visualizes individual ping results as smoke-like density, median RTT line, and packet loss severity bars
              </p>
              <div className="w-full" style={{ height: '580px' }}>
                <D3SmokeChart data={targetData} height={580} />
              </div>
            </div>
            {showLegacyCharts && (
              <>
               <div className="bg-card p-6 rounded-lg shadow border border-border">
                <h2 className="text-xl font-semibold text-foreground mb-4">Latency Overview</h2>
                <div className="w-full" style={{ height: '500px' }}>
                  <D3LatencyChart data={targetData} height={500} />
                </div>
             
                <h2 className="text-xl font-semibold text-foreground mb-4">Packet Loss</h2>
                <div className="w-full" style={{ height: '300px' }}>
                  <D3PacketLossChart data={targetData} height={300} />
                </div>
                </div>
              {/* Combined Chart - All Metrics */}
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                  <h2 className="text-xl font-semibold text-foreground mb-4">Combined View - All Metrics</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Latency ranges shown as color-coded bars (avg markers) with packet loss intensity bars below
                  </p>
                  <div className="w-full" style={{ height: '500px' }}>
                    <D3CombinedChart data={targetData} height={500} />
                  </div>
                </div>

                {/* RRD-Style Chart */}
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                  <h2 className="text-xl font-semibold text-foreground mb-4">Performance Overview (RRD-Style)</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Classic network monitoring visualization with latency range shading, average line, and color-coded packet loss indicators
                  </p>
                  <div className="w-full" style={{ height: '500px' }}>
                    <D3RRDStyleChart data={targetData} height={500} />
                  </div>
                </div>
              </>
            )}


            {/* Statistics */}
            {aggregatedData && stats && (
              <div className="bg-card px-4 py-3 rounded-lg shadow border border-border">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
                  <span className="font-semibold text-foreground">Latency:</span>
                  <span><span className="text-muted-foreground">Avg</span> <span className={`font-medium ${chartColorClasses.avg}`}>{stats.mean.toFixed(1)}ms</span></span>
                  <span><span className="text-muted-foreground">Min</span> <span className={`font-medium ${chartColorClasses.min}`}>{stats.min !== null ? `${stats.min.toFixed(1)}ms` : '—'}</span></span>
                  <span><span className="text-muted-foreground">Max</span> <span className={`font-medium ${chartColorClasses.max}`}>{stats.max !== null ? `${stats.max.toFixed(1)}ms` : '—'}</span></span>
                  <span className="text-border">|</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help"><span className="text-muted-foreground border-b border-dotted border-muted-foreground">P50</span> <span className={`font-light`}>{stats.p50.toFixed(1)}ms</span></span>
                    </TooltipTrigger>
                    <TooltipContent>50th percentile (median): Half of all pings were faster than this</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help"><span className="text-muted-foreground border-b border-dotted border-muted-foreground">P75</span> <span className={`font-light`}>{stats.p75.toFixed(1)}ms</span></span>
                    </TooltipTrigger>
                    <TooltipContent>75th percentile: 75% of pings were faster than this</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help"><span className="text-muted-foreground border-b border-dotted border-muted-foreground">P95</span> <span className={`font-light`}>{stats.p95.toFixed(1)}ms</span></span>
                    </TooltipTrigger>
                    <TooltipContent>95th percentile: 95% of pings were faster than this</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help"><span className="text-muted-foreground border-b border-dotted border-muted-foreground">P99</span> <span className={`font-light`}>{stats.p99.toFixed(1)}ms</span></span>
                    </TooltipTrigger>
                    <TooltipContent>99th percentile: 99% of pings were faster than this (worst-case latency)</TooltipContent>
                  </Tooltip>
                  <span className="text-border">|</span>
                  <span className="font-semibold text-foreground">Packets:</span>
                  <span><span className="text-muted-foreground">Total</span> <span className="font-medium">{stats.totalPings.toLocaleString()}</span></span>
                  <span><span className="text-muted-foreground">Loss</span> <span className={`font-medium ${getPacketLossClass(stats.packetLoss)}`}>{stats.packetLoss.toFixed(2)}%</span></span>
                  {aggregatedData.query.data_time_range && (
                    <>
                      <span className="text-border">|</span>
                      <span className="text-muted-foreground">
                        {new Date(aggregatedData.query.data_time_range.earliest * 1000).toLocaleString()} — {new Date(aggregatedData.query.data_time_range.latest * 1000).toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : isEmpty ? (
          <EmptyState query={{ target: targetId }} onClearTimeFilter={() => updateSearch({ timeRange: 'all' })} />
        ) : null}
        {/* Chart Options */}
        <div className="bg-card p-4 rounded-lg border shadow-sm mt-6">
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
      </div>
    </div>
  );
}
