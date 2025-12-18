import type { ChartVisibilityOptions } from './types';

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
  { key: 'showSmokeBars', label: 'Smoke Bars', colorClass: 'text-gray-600' },
  { key: 'showPacketLoss', label: 'Packet Loss', colorClass: 'text-blue-600' },
];

const lineControls: ControlItem[] = [
  { key: 'showMedianLine', label: 'Median', colorClass: 'text-green-600' },
  { key: 'showMinLine', label: 'Min', colorClass: 'text-blue-600' },
  { key: 'showMaxLine', label: 'Max', colorClass: 'text-red-600' },
  { key: 'showAvgLine', label: 'Avg', colorClass: 'text-amber-600' },
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
            className={`w-4 h-4 ${control.colorClass} border-gray-300 rounded focus:ring-${control.colorClass.split('-')[1]}-500`}
          />
          <span className="ml-2 text-sm text-gray-700">{control.label}</span>
        </label>
      ))}
      <span className="text-gray-300">|</span>
      {lineControls.map((control) => (
        <label key={control.key} className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={visibility[control.key]}
            onChange={(e) => onToggle(control.key, e.target.checked)}
            className={`w-4 h-4 ${control.colorClass} border-gray-300 rounded focus:ring-${control.colorClass.split('-')[1]}-500`}
          />
          <span className="ml-2 text-sm text-gray-700">{control.label}</span>
        </label>
      ))}
    </div>
  );
}

