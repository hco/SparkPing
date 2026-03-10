import type { ChartVisibilityOptions, SmokeBarStyle } from './types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { chartColorClasses } from '@/lib/chartColors';

// Extract only the boolean keys from ChartVisibilityOptions for checkbox controls
type BooleanVisibilityKey = {
  [K in keyof ChartVisibilityOptions]: ChartVisibilityOptions[K] extends boolean ? K : never;
}[keyof ChartVisibilityOptions];

interface ChartControlsProps {
  visibility: ChartVisibilityOptions;
  onToggle: (key: BooleanVisibilityKey, value: boolean) => void;
  onStyleChange: (style: SmokeBarStyle) => void;
}

interface ControlItem {
  key: BooleanVisibilityKey;
  label: string;
  colorClass: string;
}

const controls: ControlItem[] = [
  { key: 'showSmokeBars', label: 'Smoke Bars', colorClass: 'text-foreground' },
  { key: 'showPacketLoss', label: 'Packet Loss', colorClass: 'text-blue-500' },
];

const lineControls: ControlItem[] = [
  { key: 'showMedianLine', label: 'Median', colorClass: chartColorClasses.median },
  { key: 'showMinLine', label: 'Min', colorClass: chartColorClasses.min },
  { key: 'showMaxLine', label: 'Max', colorClass: chartColorClasses.max },
  { key: 'showAvgLine', label: 'Avg', colorClass: chartColorClasses.avg },
  { key: 'showP95Line', label: 'P95', colorClass: chartColorClasses.p95 },
  { key: 'showP99Line', label: 'P99', colorClass: chartColorClasses.p99 },
];

const smokeBarStyleOptions: { value: SmokeBarStyle; label: string; description: string }[] = [
  { value: 'classic', label: 'Classic', description: 'Simple min-max range with darker band around average' },
  { value: 'gradient', label: 'Gradient', description: 'Gaussian-like gradient centered on average' },
  { value: 'percentile', label: 'Percentile', description: 'Multi-band gradient showing estimated percentile ranges' },
  { value: 'histogram', label: 'Histogram', description: 'Discrete vertical bands with density coloring' },
];

function getActiveLineCount(visibility: ChartVisibilityOptions): number {
  return lineControls.filter((c) => visibility[c.key]).length;
}

export function ChartControls({ visibility, onToggle, onStyleChange }: ChartControlsProps) {
  const activeCount = getActiveLineCount(visibility);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-2">
      {controls.map((control) => (
        <label key={control.key} className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={visibility[control.key]}
            onChange={(e) => onToggle(control.key, e.target.checked)}
            className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
          />
          <span className="ml-2 text-sm text-foreground">{control.label}</span>
        </label>
      ))}
      {visibility.showSmokeBars && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Select value={visibility.smokeBarStyle} onValueChange={onStyleChange}>
                <SelectTrigger size="sm" className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {smokeBarStyleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {smokeBarStyleOptions.find(o => o.value === visibility.smokeBarStyle)?.description}
          </TooltipContent>
        </Tooltip>
      )}
      <span className="text-muted-foreground">|</span>
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 cursor-pointer">
            Lines
            {activeCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-medium rounded-full bg-primary text-primary-foreground">
                {activeCount}
              </span>
            )}
            <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-2" align="start">
          <div className="flex flex-col gap-1">
            {lineControls.map((control) => (
              <label
                key={control.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={visibility[control.key]}
                  onCheckedChange={(checked) => onToggle(control.key, checked === true)}
                />
                <span className={`text-sm font-medium ${control.colorClass}`}>
                  {control.label}
                </span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <div className="flex-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={visibility.clipToP99}
              onChange={(e) => onToggle('clipToP99', e.target.checked)}
              className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
            />
            <span className="ml-2 text-sm text-muted-foreground">Clip to P99</span>
          </label>
        </TooltipTrigger>
        <TooltipContent>
          Hide the slowest 1% of pings to focus on typical latency values.
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={visibility.showStatsPanel}
              onChange={(e) => onToggle('showStatsPanel', e.target.checked)}
              className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
            />
            <span className="ml-2 text-sm text-muted-foreground">Stats</span>
          </label>
        </TooltipTrigger>
        <TooltipContent>
          Show or hide the statistics panel on the right side of the chart.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
