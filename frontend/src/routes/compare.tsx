import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { D3SmokeChart } from '@/components/charts/smoke-chart/D3SmokeChart';
import { ChartControls } from '@/components/charts/smoke-chart/ChartControls';
import { TimeRangePicker } from '@/components/TimeRangePicker';
import { useTargetPingData } from '@/hooks/useTargetPingData';
import { useTimeRangeSearch } from '@/hooks/useTimeRangeSearch';
import { useUserPreferences } from '@/hooks/useUserPreferences';
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
import type { ChartVisibilityOptions, SmokeBarStyle } from '@/components/charts/smoke-chart/types';

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
          <CompareCharts
            selectedTargets={selectedTargets}
            bucket={bucket!}
            timeQuery={timeQuery}
            refresh={refresh}
            interval={interval}
            setTimeRange={setTimeRange}
          />
        </CrossChartHoverProvider>
      )}
    </PageLayout>
  );
}

interface CompareChartsProps {
  selectedTargets: string[];
  bucket: string;
  timeQuery: { from?: number | string; to?: number };
  refresh?: boolean;
  interval?: number;
  setTimeRange: (range: import('@/utils/timeRangeUtils').TimeRange) => void;
}

function CompareCharts({
  selectedTargets,
  bucket,
  timeQuery,
  refresh,
  interval,
  setTimeRange,
}: CompareChartsProps) {
  const { preferences, setPreference } = useUserPreferences();

  const visibility: ChartVisibilityOptions = useMemo(() => ({
    showMedianLine: preferences.showMedianLine,
    showMinLine: preferences.showMinLine,
    showMaxLine: preferences.showMaxLine,
    showAvgLine: preferences.showAvgLine,
    showP95Line: preferences.showP95Line,
    showP99Line: preferences.showP99Line,
    showSmokeBars: preferences.showSmokeBars,
    showPacketLoss: preferences.showPacketLoss,
    showStatsPanel: preferences.showStatsPanel,
    clipToP99: preferences.clipToP99,
    smokeBarStyle: preferences.smokeBarStyle,
  }), [
    preferences.showMedianLine,
    preferences.showMinLine,
    preferences.showMaxLine,
    preferences.showAvgLine,
    preferences.showP95Line,
    preferences.showP99Line,
    preferences.showSmokeBars,
    preferences.showPacketLoss,
    preferences.showStatsPanel,
    preferences.clipToP99,
    preferences.smokeBarStyle,
  ]);

  type BooleanVisibilityKey = Exclude<keyof ChartVisibilityOptions, 'smokeBarStyle'>;

  const handleToggle = (key: BooleanVisibilityKey, value: boolean) => {
    setPreference(key, value);
  };

  const handleStyleChange = (style: SmokeBarStyle) => {
    setPreference('smokeBarStyle', style);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <ChartControls visibility={visibility} onToggle={handleToggle} onStyleChange={handleStyleChange} />
        <div>
          {selectedTargets.map((target) => (
            <CompareChartEntry
              key={target}
              target={target}
              bucket={bucket}
              timeQuery={timeQuery}
              refresh={refresh}
              interval={interval}
              setTimeRange={setTimeRange}
              visibility={visibility}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface CompareChartEntryProps {
  target: string;
  bucket: string;
  timeQuery: { from?: number | string; to?: number };
  refresh?: boolean;
  interval?: number;
  setTimeRange: (range: import('@/utils/timeRangeUtils').TimeRange) => void;
  visibility: ChartVisibilityOptions;
}

function CompareChartEntry({
  target,
  bucket,
  timeQuery,
  refresh,
  interval,
  setTimeRange,
  visibility,
}: CompareChartEntryProps) {
  const crosshairRef = useRef<((ts: number | null) => void) | null>(null);

  const setHover = useCrossChartHover(target, (timestamp) => {
    crosshairRef.current?.(timestamp);
  });

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

  const handleHoverTimestamp = useCallback(
    (timestamp: number | null) => {
      setHover(timestamp, timestamp != null ? target : null);
    },
    [setHover, target]
  );

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 px-2 mb-1">
        <span className="text-sm font-medium">{targetName}</span>
        {targetName !== target && (
          <span className="text-xs text-muted-foreground">({target})</span>
        )}
        {isFetching && (
          <span className="text-xs text-muted-foreground animate-pulse">loading...</span>
        )}
      </div>
      {error && (
        <ErrorDisplay
          error={error instanceof Error ? error.message : 'Failed to fetch data'}
        />
      )}
      {isLoading && !aggregatedData ? (
        <LoadingState />
      ) : targetData.length > 0 ? (
        <div className="w-full" style={{ height: '250px' }}>
          <D3SmokeChart
            data={targetData}
            height={250}
            hideControls
            compact
            visibility={visibility}
            onHoverTimestamp={handleHoverTimestamp}
            onCrosshairRef={crosshairRef}
            onApplyZoomAsTimeRange={(from, to) => {
              setTimeRange({ type: 'custom', from, to });
            }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center h-24">
          <p className="text-muted-foreground text-sm">No data for this time range</p>
        </div>
      )}
    </div>
  );
}
