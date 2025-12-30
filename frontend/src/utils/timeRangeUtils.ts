import { format } from 'date-fns';
import { BUCKET_DURATION_OPTIONS, type BucketDuration } from '@/components/DurationPicker';

/**
 * Maps bucket duration string values to their equivalent in seconds.
 * Used for calculating acceptable bucket ranges based on time range duration.
 */
const BUCKET_DURATIONS_SECONDS: Record<BucketDuration, number> = {
  '1s': 1,
  '5s': 5,
  '10s': 10,
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
};

// Preset time range options (relative)
const PRESET_RANGES = [
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

// Get the duration in milliseconds for a preset
function getPresetDurationMs(preset: PresetValue): number {
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

// Check if range is "live" (tracking current time)
export function isLiveRange(range: TimeRange): boolean {
  return range.type === 'preset' || !range.to;
}

/**
 * Calculate the acceptable range of bucket durations for a given time range.
 * 
 * We want to have a reasonable number of data points for visualization:
 * - Minimum ~50 points (not too sparse)
 * - Maximum ~2000 points (not too dense, also efficient)
 * 
 * @param timeRangeMs - The time range duration in milliseconds
 * @returns Object with minBucketSeconds and maxBucketSeconds
 */
function getAcceptableBucketRange(timeRangeMs: number): { minSeconds: number; maxSeconds: number } {
  const timeRangeSeconds = timeRangeMs / 1000;
  
  // minBucket = timeRange / maxPoints (don't exceed ~2000 points)
  // maxBucket = timeRange / minPoints (have at least ~50 points)
  const minBucketSeconds = timeRangeSeconds / 2000;
  const maxBucketSeconds = timeRangeSeconds / 50;
  
  return {
    minSeconds: minBucketSeconds,
    maxSeconds: maxBucketSeconds,
  };
}

/**
 * Suggests an adjusted bucket duration when the time range changes.
 * 
 * Returns the current bucket if it's still reasonable for the new time range.
 * Otherwise, returns the closest acceptable bucket duration.
 * 
 * @param timeRange - The new time range
 * @param currentBucket - The current bucket duration value
 * @returns The suggested bucket duration (same as current if acceptable, or adjusted)
 */
export function suggestBucketForTimeRange(
  timeRange: TimeRange,
  currentBucket: BucketDuration
): BucketDuration {
  const { from, to } = resolveTimeRange(timeRange);
  const durationMs = to.getTime() - from.getTime();
  
  const { minSeconds, maxSeconds } = getAcceptableBucketRange(durationMs);
  const currentBucketSeconds = BUCKET_DURATIONS_SECONDS[currentBucket];
  
  // If current bucket is within acceptable range, keep it
  if (currentBucketSeconds >= minSeconds && currentBucketSeconds <= maxSeconds) {
    return currentBucket;
  }
  
  // Find the closest acceptable bucket
  const bucketOptions = BUCKET_DURATION_OPTIONS.map(opt => ({
    value: opt.value as BucketDuration,
    seconds: BUCKET_DURATIONS_SECONDS[opt.value as BucketDuration],
  }));
  
  // Filter to acceptable buckets
  const acceptableBuckets = bucketOptions.filter(
    b => b.seconds >= minSeconds && b.seconds <= maxSeconds
  );
  
  if (acceptableBuckets.length > 0) {
    // Pick the one closest to current bucket
    let closest = acceptableBuckets[0];
    let closestDiff = Math.abs(Math.log(closest.seconds / currentBucketSeconds));
    
    for (const bucket of acceptableBuckets) {
      const diff = Math.abs(Math.log(bucket.seconds / currentBucketSeconds));
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = bucket;
      }
    }
    
    return closest.value;
  }
  
  // No acceptable buckets in range - pick the closest one to the acceptable range
  if (currentBucketSeconds < minSeconds) {
    // Current bucket is too small - find smallest bucket >= minSeconds
    const larger = bucketOptions.filter(b => b.seconds >= minSeconds);
    if (larger.length > 0) {
      return larger[0].value;
    }
    // Fall back to largest available
    return bucketOptions[bucketOptions.length - 1].value;
  } else {
    // Current bucket is too large - find largest bucket <= maxSeconds
    const smaller = bucketOptions.filter(b => b.seconds <= maxSeconds);
    if (smaller.length > 0) {
      return smaller[smaller.length - 1].value;
    }
    // Fall back to smallest available
    return bucketOptions[0].value;
  }
}

// Create a default time range
export function createDefaultTimeRange(): TimeRange {
  return { type: 'preset', preset: '1h' };
}

// Export preset and bucket duration values for URL validation
const PRESET_VALUES = PRESET_RANGES.map((r) => r.value);
const BUCKET_DURATION_VALUES = BUCKET_DURATION_OPTIONS.map((b) => b.value);

/**
 * Shared shape for URL search parameters related to time range selection.
 * 
 * Enables any route to add URL-persisted time range support while keeping
 * TimeRangePicker routing-agnostic and routes explicit about their URL contracts.
 */
export type TimeRangeSearchParams = {
  // Preset range like '1h', '6h', etc.
  preset?: PresetValue;
  // Custom range timestamps (epoch seconds)
  from?: number;
  to?: number;
  // Bucket duration for aggregation
  bucket?: string;
  // Auto-refresh settings
  refresh?: boolean;
  interval?: number;
};

/**
 * Validates and normalizes time range search parameters from URL.
 * 
 * Reusable validateSearch function for TanStack Router routes that need
 * time range picker support. This enables routes to add URL-persisted time
 * range selection with consistent validation and defaults.
 * 
 * @param search - Raw search parameters from the URL
 * @param defaults - Optional default values to use when parameters are missing
 * @returns Validated and normalized search parameters
 */
export function validateTimeRangeSearch(
  search: Record<string, unknown>,
  defaults?: Partial<TimeRangeSearchParams>
): TimeRangeSearchParams {
  const preset = PRESET_VALUES.includes(search.preset as PresetValue)
    ? (search.preset as PresetValue)
    : undefined;
  const from = typeof search.from === 'number' ? search.from : undefined;
  const to = typeof search.to === 'number' ? search.to : undefined;
  const bucket = BUCKET_DURATION_VALUES.includes(search.bucket as BucketDuration)
    ? (search.bucket as BucketDuration)
    : defaults?.bucket ?? '10s';
  const refresh = typeof search.refresh === 'boolean' ? search.refresh : defaults?.refresh ?? true;
  const interval = typeof search.interval === 'number' && search.interval >= 1
    ? search.interval
    : defaults?.interval ?? 5;

  // Default to 1h preset if no time params specified
  return {
    preset: !preset && !from ? (defaults?.preset ?? '1h') : preset,
    from,
    to,
    bucket,
    refresh,
    interval,
  };
}

/**
 * Converts URL search parameters to a TimeRange object for use with TimeRangePicker.
 * 
 * Enables routes to convert URL-persisted time range parameters into the
 * TimeRange format expected by TimeRangePicker, keeping the picker component
 * routing-agnostic.
 * 
 * @param params - Validated search parameters from the URL
 * @returns TimeRange object for the picker component
 */
export function searchParamsToTimeRange(params: TimeRangeSearchParams): TimeRange {
  if (params.from) {
    return {
      type: 'custom',
      from: new Date(params.from * 1000),
      to: params.to ? new Date(params.to * 1000) : undefined,
    };
  }
  return { type: 'preset', preset: params.preset || '1h' };
}

/**
 * Converts a TimeRange object to URL search parameters for navigation updates.
 * 
 * Enables routes to update URL parameters when the time range picker changes,
 * maintaining URL-persisted state while keeping TimeRangePicker routing-agnostic.
 * 
 * @param range - TimeRange from the picker component
 * @returns Partial search parameters to update in the URL
 */
export function timeRangeToSearchParams(range: TimeRange): Partial<TimeRangeSearchParams> {
  if (range.type === 'preset') {
    return { preset: range.preset, from: undefined, to: undefined };
  }
  const resolved = resolveTimeRange(range);
  return {
    preset: undefined,
    from: Math.floor(resolved.from.getTime() / 1000),
    to: range.to ? Math.floor(resolved.to.getTime() / 1000) : undefined,
  };
}

/**
 * Converts a TimeRange object to API query parameters for data fetching.
 * 
 * Transforms the TimeRange format used by the picker into the format expected
 * by the API, handling both preset strings and absolute timestamps.
 * 
 * @param range - TimeRange from the picker component
 * @returns API query parameters with from/to values
 */
export function timeRangeToApiQuery(range: TimeRange): { from: string; to?: number } {
  if (range.type === 'preset') {
    return { from: range.preset || '1h', to: undefined };
  }
  const resolved = resolveTimeRange(range);
  return {
    from: Math.floor(resolved.from.getTime() / 1000).toString(),
    to: Math.floor(resolved.to.getTime() / 1000),
  };
}
