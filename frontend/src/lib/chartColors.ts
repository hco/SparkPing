/**
 * Shared color palette for charts and statistics displays.
 * Update colors here to change them across the entire application.
 */

// Latency stat colors (hex values for D3/SVG)
export const chartColors = {
  // Latency metrics
  median: '#22c55e', // green-500
  avg: '#f59e0b', // amber-500
  min: '#3b82f6', // blue-500
  max: '#ef4444', // red-500

  // Percentiles
  p50: '#22c55e', // green-500 (same as median)
  p95: '#8b5cf6', // violet-500
  p99: '#ec4899', // pink-500

  // Status colors
  success: '#22c55e', // green-500
  warning: '#eab308', // yellow-500
  error: '#ef4444', // red-500

  // Text colors (light mode)
  text: {
    primary: '#111827', // gray-900
    secondary: '#374151', // gray-700
    muted: '#6b7280', // gray-500
  },
} as const;

// Theme-aware colors for charts
export interface ThemeColors {
  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // Background colors
  panelBg: string;
  panelBorder: string;
  tooltipBg: string;
  tooltipBorder: string;
  // Grid and axis
  gridLine: string;
  axisDomain: string;
  axisText: string;
  axisLabel: string;
  // Divider
  divider: string;
}

const lightThemeColors: ThemeColors = {
  textPrimary: '#111827',   // gray-900
  textSecondary: '#374151', // gray-700
  textMuted: '#6b7280',     // gray-500
  panelBg: '#f9fafb',       // gray-50
  panelBorder: '#e5e7eb',   // gray-200
  tooltipBg: '#ffffff',
  tooltipBorder: '#d1d5db', // gray-300
  gridLine: '#e5e7eb',      // gray-200
  axisDomain: '#d1d5db',    // gray-300
  axisText: '#6b7280',      // gray-500
  axisLabel: '#374151',     // gray-700
  divider: '#e5e7eb',       // gray-200
};

const darkThemeColors: ThemeColors = {
  textPrimary: '#f9fafb',   // gray-50
  textSecondary: '#d1d5db', // gray-300
  textMuted: '#9ca3af',     // gray-400
  panelBg: '#1f2937',       // gray-800
  panelBorder: '#374151',   // gray-700
  tooltipBg: '#1f2937',     // gray-800
  tooltipBorder: '#4b5563', // gray-600
  gridLine: '#374151',      // gray-700
  axisDomain: '#4b5563',    // gray-600
  axisText: '#9ca3af',      // gray-400
  axisLabel: '#d1d5db',     // gray-300
  divider: '#374151',       // gray-700
};

/**
 * Get theme colors based on current theme
 */
export function getThemeColors(isDark: boolean): ThemeColors {
  return isDark ? darkThemeColors : lightThemeColors;
}

// Tailwind class equivalents for React components
export const chartColorClasses = {
  // Latency metrics
  median: 'text-green-500',
  avg: 'text-amber-500',
  min: 'text-blue-500',
  max: 'text-red-500',

  // Percentiles
  p50: 'text-green-500',
  p95: 'text-violet-500',
  p99: 'text-pink-500',

  // Status colors
  success: 'text-green-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
} as const;

/**
 * Packet loss severity buckets. Loss distributions are heavily skewed toward
 * tiny values, so thresholds are log-spaced to keep the low end distinguishable.
 * 0% intentionally has no bucket: it renders without any tint so that even
 * faint loss stands out against a clean background.
 */
export interface PacketLossBucket {
  /** Upper bound in percent (inclusive) */
  max: number;
  label: string;
  /** Chart background fill */
  fill: string;
  fillOpacity: number;
  /** Readable text color for stats/tooltips */
  text: string;
  /** Tailwind class equivalent of `text` */
  textClass: string;
}

export const packetLossBuckets: PacketLossBucket[] = [
  { max: 0.5, label: '<0.5%', fill: '#eab308', fillOpacity: 0.12, text: '#eab308', textClass: 'text-yellow-500' }, // yellow-500
  { max: 2, label: '0.5–2%', fill: '#f59e0b', fillOpacity: 0.15, text: '#f59e0b', textClass: 'text-amber-500' }, // amber-500
  { max: 5, label: '2–5%', fill: '#f97316', fillOpacity: 0.18, text: '#f97316', textClass: 'text-orange-500' }, // orange-500
  { max: 20, label: '5–20%', fill: '#ef4444', fillOpacity: 0.22, text: '#ef4444', textClass: 'text-red-500' }, // red-500
  { max: Infinity, label: '>20%', fill: '#b91c1c', fillOpacity: 0.3, text: '#b91c1c', textClass: 'text-red-700' }, // red-700
];

/**
 * Get the severity bucket for a packet loss percentage, or null when there is
 * no loss (0% draws no tint on charts).
 */
export function getPacketLossBucket(percent: number): PacketLossBucket | null {
  if (percent <= 0) return null;
  return packetLossBuckets.find((bucket) => percent <= bucket.max) ?? null;
}

/**
 * Get packet loss text color based on percentage
 */
export function getPacketLossColor(percent: number): string {
  return getPacketLossBucket(percent)?.text ?? chartColors.success;
}

/**
 * Get packet loss Tailwind class based on percentage
 */
export function getPacketLossClass(percent: number): string {
  return getPacketLossBucket(percent)?.textClass ?? 'text-green-500';
}

/**
 * Get latency status color based on latency value and failure status
 * Returns a hex color for the status indicator
 */
export function getLatencyStatusColor(latencyMs: number | null, hadFailures: boolean): string {
  if (latencyMs === null) return chartColors.error;
  if (hadFailures) return chartColors.warning;
  if (latencyMs < 50) return chartColors.success;
  if (latencyMs < 200) return chartColors.warning;
  return chartColors.error;
}

