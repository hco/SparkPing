import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, useCallback } from 'react';
import { D3LatencyChart } from '@/components/charts/D3LatencyChart';
import { D3PacketLossChart } from '@/components/charts/D3PacketLossChart';
import { D3CombinedChart } from '@/components/charts/D3CombinedChart';
import { D3RRDStyleChart } from '@/components/charts/D3RRDStyleChart';
import { D3SmokeChart } from '@/components/charts/D3SmokeChart';
import { TimeRangePicker } from '@/components/TimeRangePicker';
import { TargetStatsBar } from '@/components/TargetStatsBar';
import { useTargetPingData } from '@/hooks/useTargetPingData';
import { useTargetStats } from '@/hooks/useTargetStats';
import { LoadingState } from '@/components/LoadingState';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { EmptyState } from '@/components/EmptyState';
import {
  type TimeRange,
  type TimeRangeSearchParams,
  validateTimeRangeSearch,
  searchParamsToTimeRange,
  timeRangeToSearchParams,
  timeRangeToApiQuery,
  BUCKET_DURATION_OPTIONS,
} from '@/utils/timeRangeUtils';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const Route = createFileRoute('/targets/$targetId')({
  validateSearch: (search: Record<string, unknown>): TimeRangeSearchParams => {
    return validateTimeRangeSearch(search);
  },
  component: TargetDetails,
});

function TargetDetails() {
  const { targetId } = Route.useParams();
  const { preset, from, to, bucket, refresh, interval } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [showLegacyCharts, setShowLegacyCharts] = useState(false);

  const updateSearch = useCallback(
    (updates: Partial<TimeRangeSearchParams>) => {
      navigate({
        search: (prev) => ({ ...prev, ...updates }),
        replace: true,
      });
    },
    [navigate]
  );

  // Convert URL params to TimeRange object
  const timeRange: TimeRange = useMemo(() => {
    return searchParamsToTimeRange({ preset, from, to });
  }, [preset, from, to]);

  // Handle time range changes from picker
  const handleTimeRangeChange = useCallback(
    (range: TimeRange) => {
      updateSearch(timeRangeToSearchParams(range));
    },
    [updateSearch]
  );

  // Calculate time query for API
  const timeQuery = useMemo(() => {
    return timeRangeToApiQuery(timeRange);
  }, [timeRange]);

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
  const stats = useTargetStats(targetData);

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

        {/* Time Range & Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <TimeRangePicker
            value={timeRange}
            onChange={handleTimeRangeChange}
            autoRefresh={refresh}
            onAutoRefreshChange={(value) => updateSearch({ refresh: value })}
            refreshInterval={interval}
            onRefreshIntervalChange={(value) => updateSearch({ interval: value })}
            loading={isLoading}
            onRefresh={() => refetch()}
            className="flex-1"
          />
          
          {/* Bucket Duration Selector */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card/50 backdrop-blur-sm shadow-sm">
            <Label htmlFor="bucket-duration" className="text-sm text-muted-foreground whitespace-nowrap">
              Resolution
            </Label>
            <Select value={bucket} onValueChange={(value) => updateSearch({ bucket: value })}>
              <SelectTrigger id="bucket-duration" className="w-24 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUCKET_DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <ErrorDisplay error={error instanceof Error ? error.message : 'Failed to fetch data'} />}

        {isLoading && !aggregatedData ? (
          <LoadingState />
        ) : hasData ? (
          <div className="space-y-6">
            {/* Smoke Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Latency Distribution (Smoke View)</CardTitle>
                <CardDescription>
                  Visualizes individual ping results as smoke-like density, median RTT line, and packet loss severity bars
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="w-full" style={{ height: '580px' }}>
                  <D3SmokeChart data={targetData} height={580} />
                </div>
              </CardContent>
            </Card>
            {showLegacyCharts && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Latency Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="w-full" style={{ height: '500px' }}>
                      <D3LatencyChart data={targetData} height={500} />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground">Packet Loss</h3>
                    <div className="w-full" style={{ height: '300px' }}>
                      <D3PacketLossChart data={targetData} height={300} />
                    </div>
                  </CardContent>
                </Card>

                {/* Combined Chart - All Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Combined View - All Metrics</CardTitle>
                    <CardDescription>
                      Latency ranges shown as color-coded bars (avg markers) with packet loss intensity bars below
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="w-full" style={{ height: '500px' }}>
                      <D3CombinedChart data={targetData} height={500} />
                    </div>
                  </CardContent>
                </Card>

                {/* RRD-Style Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Performance Overview (RRD-Style)</CardTitle>
                    <CardDescription>
                      Classic network monitoring visualization with latency range shading, average line, and color-coded packet loss indicators
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="w-full" style={{ height: '500px' }}>
                      <D3RRDStyleChart data={targetData} height={500} />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}


            {/* Statistics */}
            {aggregatedData && stats && (
              <TargetStatsBar
                stats={stats}
                dataTimeRange={aggregatedData.query.data_time_range || undefined}
              />
            )}
          </div>
        ) : isEmpty ? (
          <EmptyState query={{ target: targetId }} onClearTimeFilter={() => updateSearch({ preset: '30d', from: undefined, to: undefined })} />
        ) : null}
        {/* Chart Options */}
        <Card className="mt-6">
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
