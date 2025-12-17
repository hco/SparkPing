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
import { TIME_RANGE_OPTIONS, BUCKET_DURATION_OPTIONS, type TimeRangeOption } from '@/utils/timeRangeUtils';

export interface TimeControlsProps {
  timeRange: TimeRangeOption;
  onTimeRangeChange: (range: TimeRangeOption) => void;
  bucketDuration: string;
  onBucketDurationChange: (value: string) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  refreshInterval: number;
  onRefreshIntervalChange: (value: number) => void;
  loading?: boolean;
  onRefresh?: () => void;
}

export function TimeControls({
  timeRange,
  onTimeRangeChange,
  bucketDuration,
  onBucketDurationChange,
  autoRefresh,
  onAutoRefreshChange,
  refreshInterval,
  onRefreshIntervalChange,
  loading = false,
  onRefresh,
}: TimeControlsProps) {
  return (
    <div className="bg-card p-4 rounded-lg border shadow-sm mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
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
          <Label htmlFor="bucket-duration">Bucket Duration</Label>
          <Select value={bucketDuration} onValueChange={onBucketDurationChange}>
            <SelectTrigger id="bucket-duration">
              <SelectValue placeholder="Select bucket duration" />
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

        <div className="space-y-2">
          <Label>Auto Refresh</Label>
          <div className="flex items-center gap-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked) => onAutoRefreshChange(checked === true)}
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
                  onChange={(e) => onRefreshIntervalChange(parseInt(e.target.value, 10) || 5)}
                  min="1"
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">sec</span>
              </>
            )}
          </div>
        </div>

        {onRefresh && (
          <div>
            <Button onClick={onRefresh} disabled={loading} className="w-full md:w-auto">
              {loading ? 'Refreshing...' : 'Refresh Now'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

