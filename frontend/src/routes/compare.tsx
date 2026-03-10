import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { D3SmokeChart } from '@/components/charts/smoke-chart/D3SmokeChart';
import { TimeRangePicker } from '@/components/TimeRangePicker';
import { TargetStatsBar } from '@/components/TargetStatsBar';
import { useTargetPingData } from '@/hooks/useTargetPingData';
import { useTargetStats } from '@/hooks/useTargetStats';
import { useTimeRangeSearch } from '@/hooks/useTimeRangeSearch';
import { LoadingState } from '@/components/LoadingState';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { type TimeRangeSearchParams, validateTimeRangeSearch } from '@/utils/timeRangeUtils';
import { DurationPicker } from '@/components/DurationPicker';
import { fetchTargets } from '@/api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageLayout } from '@/components/PageLayout';
import { CrossChartHoverProvider, useCrossChartHover } from '@/contexts/CrossChartHoverContext';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Target } from '@/types';

interface CompareSearchParams extends TimeRangeSearchParams {
  targets?: string;
}

export const Route = createFileRoute('/compare')({
  validateSearch: (search: Record<string, unknown>): CompareSearchParams => {
    const base = validateTimeRangeSearch(search);
    return {
      ...base,
      targets: typeof search.targets === 'string' ? search.targets : undefined,
    };
  },
  component: CompareView,
});

function CompareView() {
  const { targets: targetsParam } = Route.useSearch();
  const navigate = Route.useNavigate();

  const selectedTargets = useMemo(
    () => (targetsParam ? targetsParam.split(',').filter(Boolean) : []),
    [targetsParam]
  );

  const setSelectedTargets = useCallback(
    (targets: string[]) => {
      navigate({
        search: (prev) => ({
          ...prev,
          targets: targets.length > 0 ? targets.join(',') : undefined,
        }),
        replace: true,
      });
    },
    [navigate]
  );

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
  } = useTimeRangeSearch(Route.fullPath);

  const { data: allTargets, isLoading: targetsLoading } = useQuery({
    queryKey: ['targets'],
    queryFn: fetchTargets,
  });

  const [pickerOpen, setPickerOpen] = useState(true);

  const toggleTarget = useCallback(
    (address: string) => {
      setSelectedTargets(
        selectedTargets.includes(address)
          ? selectedTargets.filter((t) => t !== address)
          : [...selectedTargets, address]
      );
    },
    [selectedTargets, setSelectedTargets]
  );

  return (
    <PageLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground mb-2">Compare Targets</h1>
        <p className="text-muted-foreground">
          Select targets to compare latency data side-by-side
        </p>
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
          loading={false}
          className="flex-1"
        />
        <DurationPicker
          value={bucket!}
          onChange={setBucket}
          label="Resolution"
          id="bucket-duration"
        />
      </div>

      {/* Target Picker */}
      <Card className="mb-6">
        <CardHeader className="py-3 cursor-pointer" onClick={() => setPickerOpen(!pickerOpen)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Targets ({selectedTargets.length} selected)
            </CardTitle>
            <Button variant="ghost" size="sm">
              {pickerOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </div>
        </CardHeader>
        {pickerOpen && (
          <CardContent className="pt-0">
            {targetsLoading ? (
              <p className="text-muted-foreground text-sm">Loading targets...</p>
            ) : allTargets && allTargets.length > 0 ? (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {allTargets.map((target: Target) => (
                  <label
                    key={target.id}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={selectedTargets.includes(target.address)}
                      onCheckedChange={() => toggleTarget(target.address)}
                    />
                    <span>{target.name || target.address}</span>
                    {target.name && (
                      <span className="text-muted-foreground">({target.address})</span>
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No targets configured</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Charts */}
      {selectedTargets.length === 0 ? (
        <div className="flex items-center justify-center h-48 rounded-lg border border-dashed border-border">
          <p className="text-muted-foreground">Select targets above to compare</p>
        </div>
      ) : (
        <CrossChartHoverProvider>
          <div className="space-y-6">
            {selectedTargets.map((target) => (
              <CompareChartCard
                key={target}
                target={target}
                bucket={bucket!}
                timeQuery={timeQuery}
                refresh={refresh}
                interval={interval}
                setTimeRange={setTimeRange}
              />
            ))}
          </div>
        </CrossChartHoverProvider>
      )}
    </PageLayout>
  );
}

interface CompareChartCardProps {
  target: string;
  bucket: string;
  timeQuery: { from?: number | string; to?: number };
  refresh?: boolean;
  interval?: number;
  setTimeRange: (range: import('@/utils/timeRangeUtils').TimeRange) => void;
}

function CompareChartCard({
  target,
  bucket,
  timeQuery,
  refresh,
  interval,
  setTimeRange,
}: CompareChartCardProps) {
  const { hoverTimestamp, hoverSourceId, setHover } = useCrossChartHover();

  const {
    data: aggregatedData,
    targetData,
    targetName,
    isLoading,
    isFetching,
    error,
  } = useTargetPingData({
    target,
    bucket,
    from: timeQuery.from,
    to: timeQuery.to,
    enabled: true,
    refetchInterval: refresh ? (interval ?? 30) * 1000 : false,
  });

  const stats = useTargetStats(targetData);

  const handleHoverTimestamp = useCallback(
    (timestamp: number | null) => {
      setHover(timestamp, timestamp != null ? target : null);
    },
    [setHover, target]
  );

  // Show crosshair from other charts, not from this one
  const crosshairTimestamp =
    hoverSourceId !== target ? hoverTimestamp : null;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-lg flex items-center gap-2">
          {targetName}
          {targetName !== target && (
            <span className="text-sm font-normal text-muted-foreground">({target})</span>
          )}
          {isFetching && (
            <span className="text-xs text-muted-foreground animate-pulse">loading...</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {error && (
          <ErrorDisplay
            error={error instanceof Error ? error.message : 'Failed to fetch data'}
          />
        )}
        {isLoading && !aggregatedData ? (
          <LoadingState />
        ) : targetData.length > 0 ? (
          <div className="space-y-4">
            <div className="w-full" style={{ height: '400px' }}>
              <D3SmokeChart
                data={targetData}
                height={400}
                crosshairTimestamp={crosshairTimestamp}
                onHoverTimestamp={handleHoverTimestamp}
                onApplyZoomAsTimeRange={(from, to) => {
                  setTimeRange({ type: 'custom', from, to });
                }}
              />
            </div>
            {stats && (
              <TargetStatsBar
                stats={stats}
                dataTimeRange={aggregatedData?.query.data_time_range || undefined}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-24">
            <p className="text-muted-foreground text-sm">No data for this time range</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
