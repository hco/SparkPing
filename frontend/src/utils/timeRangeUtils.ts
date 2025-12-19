import { format, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';

// Preset time range options (relative)
export const PRESET_RANGES = [
  { value: '5m', label: '5m', duration: { minutes: 5 } },
  { value: '15m', label: '15m', duration: { minutes: 15 } },
  { value: '30m', label: '30m', duration: { minutes: 30 } },
  { value: '1h', label: '1h', duration: { hours: 1 } },
  { value: '3h', label: '3h', duration: { hours: 3 } },
  { value: '6h', label: '6h', duration: { hours: 6 } },
  { value: '12h', label: '12h', duration: { hours: 12 } },
  { value: '24h', label: '24h', duration: { hours: 24 } },
  { value: '7d', label: '7d', duration: { days: 7 } },
  { value: '30d', label: '30d', duration: { days: 30 } },
] as const;

export type PresetValue = (typeof PRESET_RANGES)[number]['value'];

// Time range can be either a preset or a custom range
export interface TimeRange {
  type: 'preset' | 'custom';
  preset?: PresetValue;
  from?: Date;
  to?: Date; // undefined means "now" (live)
}

// Legacy type for backwards compatibility
export type TimeRangeOption = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | 'all';

export const TIME_RANGE_OPTIONS: { value: TimeRangeOption; label: string }[] = [
  { value: '1h', label: 'Last 1 Hour' },
  { value: '6h', label: 'Last 6 Hours' },
  { value: '12h', label: 'Last 12 Hours' },
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'all', label: 'All Time' },
];

export const BUCKET_DURATION_OPTIONS = [
  { value: '1s', label: '1 second' },
  { value: '5s', label: '5 seconds' },
  { value: '10s', label: '10 seconds' },
  { value: '30s', label: '30 seconds' },
  { value: '1m', label: '1 minute' },
  { value: '5m', label: '5 minutes' },
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
] as const;

export type BucketDuration = (typeof BUCKET_DURATION_OPTIONS)[number]['value'];

// Get the duration in milliseconds for a preset
export function getPresetDurationMs(preset: PresetValue): number {
  const range = PRESET_RANGES.find(r => r.value === preset);
  if (!range) return 60 * 60 * 1000; // default 1h
  
  const { duration } = range;
  let ms = 0;
  if ('minutes' in duration) ms = duration.minutes * 60 * 1000;
  if ('hours' in duration) ms = duration.hours * 60 * 60 * 1000;
  if ('days' in duration) ms = duration.days * 24 * 60 * 60 * 1000;
  return ms;
}

// Calculate absolute from/to dates from a TimeRange
export function resolveTimeRange(range: TimeRange): { from: Date; to: Date } {
  const now = new Date();
  
  if (range.type === 'custom' && range.from) {
    return {
      from: range.from,
      to: range.to || now,
    };
  }
  
  // Preset range
  const preset = range.preset || '1h';
  const durationMs = getPresetDurationMs(preset);
  return {
    from: new Date(now.getTime() - durationMs),
    to: now,
  };
}

// Get display label for a time range
export function getTimeRangeLabel(range: TimeRange): string {
  if (range.type === 'preset') {
    return `Last ${range.preset || '1h'}`;
  }
  
  if (range.from && range.to) {
    // Custom range with end time
    return `${format(range.from, 'MMM d HH:mm')} → ${format(range.to, 'MMM d HH:mm')}`;
  }
  
  if (range.from) {
    // Custom range to now
    return `${format(range.from, 'MMM d HH:mm')} → Now`;
  }
  
  return 'Select range';
}

// Get a short label for display in compact mode
export function getTimeRangeShortLabel(range: TimeRange): string {
  if (range.type === 'preset') {
    return range.preset || '1h';
  }
  
  const { from, to } = resolveTimeRange(range);
  const diffMinutes = differenceInMinutes(to, from);
  
  if (diffMinutes < 60) return `${diffMinutes}m`;
  
  const diffHours = differenceInHours(to, from);
  if (diffHours < 24) return `${diffHours}h`;
  
  const diffDays = differenceInDays(to, from);
  return `${diffDays}d`;
}

// Shift time range forward or backward
export function shiftTimeRange(range: TimeRange, direction: 'forward' | 'backward'): TimeRange {
  const { from, to } = resolveTimeRange(range);
  const durationMs = to.getTime() - from.getTime();
  const shiftMs = direction === 'forward' ? durationMs : -durationMs;
  
  const newFrom = new Date(from.getTime() + shiftMs);
  const newTo = new Date(to.getTime() + shiftMs);
  
  // Don't allow shifting into the future
  const now = new Date();
  if (newTo > now) {
    // If we're trying to go forward past now, snap to preset mode
    if (range.type === 'preset') {
      return range; // Already at latest
    }
    return {
      type: 'preset',
      preset: findClosestPreset(durationMs),
    };
  }
  
  return {
    type: 'custom',
    from: newFrom,
    to: newTo,
  };
}

// Zoom in (narrow the range) or zoom out (widen the range)
export function zoomTimeRange(range: TimeRange, direction: 'in' | 'out'): TimeRange {
  const { from, to } = resolveTimeRange(range);
  const durationMs = to.getTime() - from.getTime();
  const factor = direction === 'in' ? 0.5 : 2;
  const newDurationMs = durationMs * factor;
  
  // Clamp to reasonable bounds (1 minute to 90 days)
  const minDuration = 60 * 1000; // 1 minute
  const maxDuration = 90 * 24 * 60 * 60 * 1000; // 90 days
  const clampedDuration = Math.max(minDuration, Math.min(maxDuration, newDurationMs));
  
  // Try to find a matching preset
  const closestPreset = findClosestPreset(clampedDuration);
  if (closestPreset && Math.abs(getPresetDurationMs(closestPreset) - clampedDuration) < clampedDuration * 0.1) {
    return { type: 'preset', preset: closestPreset };
  }
  
  // Center the zoom on the midpoint
  const midpoint = new Date((from.getTime() + to.getTime()) / 2);
  const halfDuration = clampedDuration / 2;
  
  let newTo = new Date(midpoint.getTime() + halfDuration);
  const now = new Date();
  
  // Don't go past now
  if (newTo > now) {
    newTo = now;
  }
  
  return {
    type: 'custom',
    from: new Date(newTo.getTime() - clampedDuration),
    to: newTo,
  };
}

// Find the closest preset to a given duration
function findClosestPreset(durationMs: number): PresetValue | undefined {
  let closest: PresetValue | undefined = undefined;
  let closestDiff = Infinity;
  
  for (const preset of PRESET_RANGES) {
    const presetMs = getPresetDurationMs(preset.value);
    const diff = Math.abs(presetMs - durationMs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = preset.value;
    }
  }
  
  return closest;
}

// Convert new TimeRange to legacy format for API compatibility
export function timeRangeToLegacy(range: TimeRange): TimeRangeOption {
  if (range.type === 'preset') {
    const preset = range.preset || '1h';
    // Map to closest legacy option
    if (['5m', '15m', '30m', '1h'].includes(preset)) return '1h';
    if (['3h', '6h'].includes(preset)) return '6h';
    if (preset === '12h') return '12h';
    if (preset === '24h') return '24h';
    if (preset === '7d') return '7d';
    if (preset === '30d') return '30d';
    return '24h';
  }
  
  // For custom ranges, find closest legacy option
  const { from, to } = resolveTimeRange(range);
  const diffHours = differenceInHours(to, from);
  
  if (diffHours <= 1) return '1h';
  if (diffHours <= 6) return '6h';
  if (diffHours <= 12) return '12h';
  if (diffHours <= 24) return '24h';
  if (diffHours <= 168) return '7d'; // 7 days
  return '30d';
}

// Convert legacy option to new TimeRange format
export function legacyToTimeRange(legacy: TimeRangeOption): TimeRange {
  const mapping: Record<TimeRangeOption, PresetValue | null> = {
    '1h': '1h',
    '6h': '6h',
    '12h': '12h',
    '24h': '24h',
    '7d': '7d',
    '30d': '30d',
    'all': null,
  };
  
  const preset = mapping[legacy];
  if (!preset) {
    return { type: 'preset', preset: '30d' };
  }
  return { type: 'preset', preset };
}

// Legacy functions for backwards compatibility
export function getTimeRangeSeconds(range: TimeRangeOption): number | null {
  switch (range) {
    case '1h': return 60 * 60;
    case '6h': return 6 * 60 * 60;
    case '12h': return 12 * 60 * 60;
    case '24h': return 24 * 60 * 60;
    case '7d': return 7 * 24 * 60 * 60;
    case '30d': return 30 * 24 * 60 * 60;
    case 'all': return null;
    default: return 24 * 60 * 60;
  }
}

export function calculateTimeRangeQuery(range: TimeRangeOption): { from?: string; to?: number } {
  if (range === 'all') {
    return {};
  }
  return {
    from: range,
    to: undefined,
  };
}

// Calculate time range query from new TimeRange format
export function calculateTimeRangeQueryNew(range: TimeRange): { from?: string; to?: number } {
  if (range.type === 'preset') {
    return {
      from: range.preset,
      to: undefined,
    };
  }
  
  // For custom ranges, return timestamps
  const { from, to } = resolveTimeRange(range);
  return {
    from: Math.floor(from.getTime() / 1000).toString(),
    to: Math.floor(to.getTime() / 1000),
  };
}

// Check if range is "live" (tracking current time)
export function isLiveRange(range: TimeRange): boolean {
  return range.type === 'preset' || !range.to;
}

// Create a default time range
export function createDefaultTimeRange(): TimeRange {
  return { type: 'preset', preset: '1h' };
}
