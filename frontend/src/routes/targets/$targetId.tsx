import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { D3LatencyChart } from '@/components/charts/D3LatencyChart';
import { D3PacketLossChart } from '@/components/charts/D3PacketLossChart';
import { D3CombinedChart } from '@/components/charts/D3CombinedChart';
import { D3RRDStyleChart } from '@/components/charts/D3RRDStyleChart';
import { D3SmokeChart } from '@/components/charts/smoke-chart/D3SmokeChart';
import { TimeRangePicker } from '@/components/TimeRangePicker';
import { TargetStatsBar } from '@/components/TargetStatsBar';
import { useTargetPingData } from '@/hooks/useTargetPingData';
import { useTargetStats } from '@/hooks/useTargetStats';
import { useTimeRangeSearch } from '@/hooks/useTimeRangeSearch';
import { LoadingState } from '@/components/LoadingState';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { EmptyState } from '@/components/EmptyState';
import { type TimeRangeSearchParams, validateTimeRangeSearch } from '@/utils/timeRangeUtils';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DurationPicker } from '@/components/DurationPicker';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageLayout } from '@/components/PageLayout';

export const Route = createFileRoute('/targets/$targetId')({
  validateSearch: (search: Record<string, unknown>): TimeRangeSearchParams => {
    return validateTimeRangeSearch(search);
  },
  component: TargetDetails,
});

function TargetDetails() {
  const { targetId } = Route.useParams();
  const [showLegacyCharts, setShowLegacyCharts] = useState(false);

  const {
    bucket,
    refresh,
    interval,
    timeRange,
    timeQuery,
    setTimeRange,
    setAutoRefresh,
    setRefreshInterval,
    setBucket,
    resetTimeFilter,
  } = useTimeRangeSearch(Route.fullPath);

  const {
    data: aggregatedData,
    targetData,
    targetName,
    isLoading,
    isFetching,
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

  // Calculate statistics including percentiles
  const stats = useTargetStats(targetData);

  const hasData = targetData.length > 0;
  const isEmpty = aggregatedData && targetData.length === 0;

  return (
    <PageLayout>
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
            onChange={setTimeRange}
            autoRefresh={refresh}
            onAutoRefreshChange={setAutoRefresh}
            refreshInterval={interval}
            onRefreshIntervalChange={setRefreshInterval}
            loading={isFetching}
            onRefresh={() => refetch()}
            className="flex-1"
          />
          
          <DurationPicker
            value={bucket!}
            onChange={setBucket}
            label="Resolution"
            id="bucket-duration"
          />
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
          <EmptyState query={{ target: targetId }} onClearTimeFilter={resetTimeFilter} />
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
    </PageLayout>
  );
}
