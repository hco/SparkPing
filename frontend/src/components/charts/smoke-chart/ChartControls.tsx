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
  { key: 'showMedianLine', label: 'Median', colorClass: 'text-green-500' },
  { key: 'showMinLine', label: 'Min', colorClass: 'text-blue-500' },
  { key: 'showMaxLine', label: 'Max', colorClass: 'text-red-500' },
  { key: 'showAvgLine', label: 'Avg', colorClass: 'text-amber-500' },
];

const smokeBarStyleOptions: { value: SmokeBarStyle; label: string; description: string }[] = [
  { value: 'classic', label: 'Classic', description: 'Simple min-max range with darker band around average' },
  { value: 'gradient', label: 'Gradient', description: 'Gaussian-like gradient centered on average' },
  { value: 'percentile', label: 'Percentile', description: 'Multi-band gradient showing estimated percentile ranges' },
  { value: 'histogram', label: 'Histogram', description: 'Discrete vertical bands with density coloring' },
];

export function ChartControls({ visibility, onToggle, onStyleChange }: ChartControlsProps) {
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
      {lineControls.map((control) => (
        <label key={control.key} className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={visibility[control.key]}
            onChange={(e) => onToggle(control.key, e.target.checked)}
            className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
          />
          <span className={`ml-2 text-sm ${control.colorClass}`}>{control.label}</span>
        </label>
      ))}
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
