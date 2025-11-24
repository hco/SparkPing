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

export function getTimeRangeSeconds(range: TimeRangeOption): number | null {
  switch (range) {
    case '1h': return 60 * 60;
    case '6h': return 6 * 60 * 60;
    case '12h': return 12 * 60 * 60;
    case '24h': return 24 * 60 * 60;
    case '7d': return 7 * 24 * 60 * 60;
    case '30d': return 30 * 24 * 60 * 60;
    case 'all': return null;
    default: return 24 * 60 * 60; // Default to 24h
  }
}

export function calculateTimeRangeQuery(range: TimeRangeOption): { from?: string; to?: number } {
  if (range === 'all') {
    return {}; // No time filter for 'all'
  }
  // Return relative time range string instead of calculating timestamp
  return {
    from: range,
    to: undefined,
  };
}

