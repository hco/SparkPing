import type { ChartVisibilityOptions } from './types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ChartControlsProps {
  visibility: ChartVisibilityOptions;
  onToggle: (key: keyof ChartVisibilityOptions, value: boolean) => void;
}

interface ControlItem {
  key: keyof ChartVisibilityOptions;
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

export function ChartControls({ visibility, onToggle }: ChartControlsProps) {
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
