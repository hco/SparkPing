import * as React from 'react';
import { format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Calendar as CalendarIcon,
  Clock,
  Play,
  RotateCcw,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type TimeRange,
  type PresetValue,
  resolveTimeRange,
  getTimeRangeLabel,
  shiftTimeRange,
  zoomTimeRange,
  isLiveRange,
  createDefaultTimeRange,
} from '@/utils/timeRangeUtils';
import { useIsSmScreen, useIsMdScreen, useIsLgScreen } from '@/hooks/useMediaQuery';
import type { DateRange } from 'react-day-picker';

// Preset groups for visual organization
const QUICK_PRESETS: PresetValue[] = ['5m', '15m', '30m', '1h', '3h', '6h'];
const EXTENDED_PRESETS: PresetValue[] = ['12h', '24h', '7d', '30d'];
// Preset labels for the dropdown
const PRESET_LABELS: Record<PresetValue, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '3h': '3 hours',
  '6h': '6 hours',
  '12h': '12 hours',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  refreshInterval?: number;
  onRefreshIntervalChange?: (seconds: number) => void;
  onRefresh?: () => void;
  loading?: boolean;
  className?: string;
  /** Compact mode - shows only essential controls */
  compact?: boolean;
}

export function TimeRangePicker({
  value,
  onChange,
  autoRefresh = false,
  onAutoRefreshChange,
  refreshInterval = 5,
  onRefreshIntervalChange,
  onRefresh,
  loading = false,
  className,
  compact = false,
}: TimeRangePickerProps) {
  const [customRangeOpen, setCustomRangeOpen] = React.useState(false);
  const [customDateRange, setCustomDateRange] = React.useState<DateRange | undefined>();
  const [customTimeFrom, setCustomTimeFrom] = React.useState('00:00');
  const [customTimeTo, setCustomTimeTo] = React.useState('23:59');

  // Responsive breakpoints
  const isSmScreen = useIsSmScreen();
  const isMdScreen = useIsMdScreen();
  const isLgScreen = useIsLgScreen();

  const isLive = isLiveRange(value);
  const resolvedRange = resolveTimeRange(value);

  // Handle preset selection
  const handlePresetChange = (preset: string) => {
    if (!preset) return;
    onChange({ type: 'preset', preset: preset as PresetValue });
  };

  // Handle custom range apply
  const handleApplyCustomRange = () => {
    if (!customDateRange?.from) return;

    const [fromHours, fromMinutes] = customTimeFrom.split(':').map(Number);
    const [toHours, toMinutes] = customTimeTo.split(':').map(Number);

    const from = new Date(customDateRange.from);
    from.setHours(fromHours, fromMinutes, 0, 0);

    let to: Date | undefined;
    if (customDateRange.to) {
      to = new Date(customDateRange.to);
      to.setHours(toHours, toMinutes, 59, 999);
    }

    onChange({
      type: 'custom',
      from,
      to: to || undefined, // undefined = live/now
    });
    setCustomRangeOpen(false);
  };

  // Reset custom range picker when opening
  const handleCustomRangeOpen = (open: boolean) => {
    if (open) {
      // Pre-populate with current range
      setCustomDateRange({
        from: resolvedRange.from,
        to: resolvedRange.to,
      });
      setCustomTimeFrom(format(resolvedRange.from, 'HH:mm'));
      setCustomTimeTo(format(resolvedRange.to, 'HH:mm'));
    }
    setCustomRangeOpen(open);
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if no input is focused
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      // Arrow keys for time shifting (with Shift)
      if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        onChange(shiftTimeRange(value, 'backward'));
      } else if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        onChange(shiftTimeRange(value, 'forward'));
      }
      // Zoom with + and -
      else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        onChange(zoomTimeRange(value, 'in'));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        onChange(zoomTimeRange(value, 'out'));
      }
      // Quick presets with number keys
      else if (e.key >= '1' && e.key <= '6' && !e.ctrlKey && !e.metaKey) {
        const index = parseInt(e.key) - 1;
        if (QUICK_PRESETS[index]) {
          e.preventDefault();
          onChange({ type: 'preset', preset: QUICK_PRESETS[index] });
        }
      }
      // Refresh with R
      else if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onRefresh?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [value, onChange, onRefresh]);

  const currentPreset = value.type === 'preset' ? value.preset : null;

  // Responsive button sizes for better touch targets
  const buttonSize = isSmScreen ? 'h-8 w-8' : 'h-10 w-10';
  const iconSize = isSmScreen ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 rounded-lg border bg-card/50 backdrop-blur-sm',
          'shadow-sm transition-all duration-200',
          'overflow-x-auto',
          className
        )}
      >
        {/* Time shift backward */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(buttonSize, 'shrink-0')}
              onClick={() => onChange(shiftTimeRange(value, 'backward'))}
            >
              <ChevronLeft className={iconSize} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Shift backward (Shift+←)</p>
          </TooltipContent>
        </Tooltip>

        {/* Mobile: Dropdown selector for all presets */}
        {!isSmScreen && (
          <Select value={currentPreset || ''} onValueChange={handlePresetChange}>
            <SelectTrigger size="sm" className="h-10 min-w-[70px]">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Quick</SelectLabel>
                {QUICK_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {PRESET_LABELS[preset]}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Extended</SelectLabel>
                {EXTENDED_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {PRESET_LABELS[preset]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {/* Desktop sm+: Quick presets as toggle group */}
        {isSmScreen && (
          <ToggleGroup
            type="single"
            value={currentPreset || ''}
            onValueChange={handlePresetChange}
          >
            {QUICK_PRESETS.map((preset) => (
              <ToggleGroupItem
                key={preset}
                value={preset}
                size="sm"
                className={cn(
                  'px-2.5 h-8 text-xs font-medium transition-colors',
                  'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
                  'hover:bg-muted'
                )}
              >
                {preset}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        {!compact && (
          <>
            {isSmScreen && <Separator orientation="vertical" className="h-6" />}

            {/* Extended presets - md+ only */}
            {isMdScreen && (
              <ToggleGroup
                type="single"
                value={currentPreset || ''}
                onValueChange={handlePresetChange}
              >
                {EXTENDED_PRESETS.map((preset) => (
                  <ToggleGroupItem
                    key={preset}
                    value={preset}
                    size="sm"
                    className={cn(
                      'px-2.5 h-8 text-xs font-medium transition-colors',
                      'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
                      'hover:bg-muted'
                    )}
                  >
                    {preset}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </>
        )}

        <Separator orientation="vertical" className="h-6" />

        {/* Custom range popover */}
        <Popover open={customRangeOpen} onOpenChange={handleCustomRangeOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={value.type === 'custom' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                isSmScreen ? 'h-8' : 'h-10',
                'gap-2 px-3 font-medium',
                value.type === 'custom' && 'bg-secondary'
              )}
            >
              <CalendarIcon className={cn(isSmScreen ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
              <span className={cn(isLgScreen ? 'inline' : 'hidden')}>
                {value.type === 'custom' ? getTimeRangeLabel(value) : 'Custom'}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-0 max-w-[95vw]"
            align="end"
            sideOffset={8}
            collisionPadding={16}
          >
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Select Date Range</h4>
                <Calendar
                  mode="range"
                  selected={customDateRange}
                  onSelect={setCustomDateRange}
                  numberOfMonths={isMdScreen ? 2 : 1}
                  disabled={(date) => date > new Date()}
                  className="rounded-md border"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="time-from" className="text-xs">
                    Start Time
                  </Label>
                  <div className="relative">
                    <Clock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="time-from"
                      type="time"
                      value={customTimeFrom}
                      onChange={(e) => setCustomTimeFrom(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time-to" className="text-xs">
                    End Time
                  </Label>
                  <div className="relative">
                    <Clock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="time-to"
                      type="time"
                      value={customTimeTo}
                      onChange={(e) => setCustomTimeTo(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange(createDefaultTimeRange());
                    setCustomRangeOpen(false);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset
                </Button>
                <Button size="sm" onClick={handleApplyCustomRange} disabled={!customDateRange?.from}>
                  Apply Range
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Time shift forward */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(buttonSize, 'shrink-0')}
              onClick={() => onChange(shiftTimeRange(value, 'forward'))}
              disabled={isLive}
            >
              <ChevronRight className={iconSize} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Shift forward (Shift+→)</p>
          </TooltipContent>
        </Tooltip>

        {!compact && (
          <>
            {isSmScreen && <Separator orientation="vertical" className="h-6" />}

            {/* Zoom controls - sm+ */}
            {isSmScreen && (
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onChange(zoomTimeRange(value, 'out'))}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Zoom out (-)</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onChange(zoomTimeRange(value, 'in'))}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Zoom in (+)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

            <Separator orientation="vertical" className="h-6" />

            {/* Live mode / Auto-refresh */}
            {onAutoRefreshChange && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={autoRefresh ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      isSmScreen ? 'h-8' : 'h-10',
                      'gap-2 px-3 font-medium transition-all',
                      autoRefresh && 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    )}
                    onClick={() => onAutoRefreshChange(!autoRefresh)}
                  >
                    {autoRefresh ? (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                        </span>
                        <span className={cn(isSmScreen ? 'inline' : 'hidden')}>Live</span>
                      </>
                    ) : (
                      <>
                        <Play className={cn(isSmScreen ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                        <span className={cn(isSmScreen ? 'inline' : 'hidden')}>Live</span>
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{autoRefresh ? `Auto-refreshing every ${refreshInterval}s` : 'Enable auto-refresh'}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Refresh interval selector (only when live) - lg+ */}
            {autoRefresh && onRefreshIntervalChange && isLgScreen && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={300}
                  value={refreshInterval}
                  onChange={(e) => onRefreshIntervalChange(parseInt(e.target.value, 10) || 5)}
                  className="h-8 w-14 text-center text-xs"
                />
                <span className="text-xs text-muted-foreground">s</span>
              </div>
            )}
          </>
        )}

        {/* Manual refresh */}
        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(buttonSize, 'shrink-0', loading && 'animate-spin')}
                onClick={onRefresh}
                disabled={loading}
              >
                <RotateCcw className={iconSize} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Refresh now (R)</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
