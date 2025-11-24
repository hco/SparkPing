import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TIME_RANGE_OPTIONS, type TimeRangeOption } from '../utils/timeRangeUtils';

interface FiltersPanelProps {
  timeRange: TimeRangeOption;
  onTimeRangeChange: (range: TimeRangeOption) => void;
  useAggregated: boolean;
  onUseAggregatedChange: (value: boolean) => void;
  bucketDuration: string;
  onBucketDurationChange: (value: string) => void;
  limit: string;
  onLimitChange: (value: string) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  refreshInterval: number;
  onRefreshIntervalChange: (value: number) => void;
  synchronizeYAxis: boolean;
  onSynchronizeYAxisChange: (value: boolean) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function FiltersPanel({
  timeRange,
  onTimeRangeChange,
  useAggregated,
  onUseAggregatedChange,
  bucketDuration,
  onBucketDurationChange,
  limit,
  onLimitChange,
  autoRefresh,
  onAutoRefreshChange,
  refreshInterval,
  onRefreshIntervalChange,
  synchronizeYAxis,
  onSynchronizeYAxisChange,
  loading,
  onRefresh,
}: FiltersPanelProps) {
  return (
    <div className="bg-card p-6 rounded-lg border shadow-sm mb-6">
      <h2 className="text-xl font-semibold mb-6">Filters</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="space-y-2">
          <Label htmlFor="time-range">Time Range</Label>
          <Select value={timeRange} onValueChange={onTimeRangeChange}>
            <SelectTrigger id="time-range">
              <SelectValue placeholder="Select time range" />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="data-mode">Data Mode</Label>
          <Select 
            value={useAggregated ? 'aggregated' : 'raw'} 
            onValueChange={(value: string) => onUseAggregatedChange(value === 'aggregated')}
          >
            <SelectTrigger id="data-mode">
              <SelectValue placeholder="Select data mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aggregated">Aggregated (Buckets)</SelectItem>
              <SelectItem value="raw">Raw Data</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {useAggregated && (
          <div className="space-y-2">
            <Label htmlFor="bucket-duration">Bucket Duration</Label>
            <Input
              id="bucket-duration"
              type="text"
              placeholder="1m"
              value={bucketDuration}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onBucketDurationChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">e.g., 5m, 1h, 30s, 2d</p>
          </div>
        )}
        {!useAggregated && (
          <div className="space-y-2">
            <Label htmlFor="limit">Limit Results</Label>
            <Input
              id="limit"
              type="number"
              placeholder="No limit"
              min="1"
              value={limit}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onLimitChange(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>Auto Refresh</Label>
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked: boolean) => onAutoRefreshChange(checked === true)}
              />
              <Label htmlFor="auto-refresh" className="text-sm font-normal cursor-pointer">
                Enabled
              </Label>
            </div>
            {autoRefresh && (
              <>
                <Input
                  type="number"
                  value={refreshInterval}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onRefreshIntervalChange(parseInt(e.target.value, 10) || 5)}
                  min="1"
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">seconds</span>
              </>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Chart Options</Label>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="synchronize-y-axis"
              checked={synchronizeYAxis}
              onCheckedChange={(checked: boolean) => onSynchronizeYAxisChange(checked === true)}
            />
            <Label htmlFor="synchronize-y-axis" className="text-sm font-normal cursor-pointer">
              Synchronize Y-Axis
            </Label>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Button
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh Now'}
        </Button>
      </div>
    </div>
  );
}

