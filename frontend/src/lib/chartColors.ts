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
  p99: '#8b5cf6', // violet-500

  // Status colors
  success: '#22c55e', // green-500
  warning: '#eab308', // yellow-500
  error: '#ef4444', // red-500

  // Packet loss severity
  packetLoss: {
    none: '#22c55e', // green-500 (0%)
    low: '#60a5fa', // blue-400 (≤5%)
    medium: '#8b5cf6', // violet-500 (5-20%)
    high: '#ef4444', // red-500 (>20%)
  },

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

export const lightThemeColors: ThemeColors = {
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

export const darkThemeColors: ThemeColors = {
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

/**
 * Detect if dark mode is active by checking for .dark class on document
 */
export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
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
  p99: 'text-violet-500',

  // Status colors
  success: 'text-green-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
} as const;

/**
 * Get packet loss color based on percentage
 */
export function getPacketLossColor(percent: number): string {
  if (percent === 0) return chartColors.packetLoss.none;
  if (percent <= 5) return chartColors.packetLoss.low;
  if (percent <= 20) return chartColors.packetLoss.medium;
  return chartColors.packetLoss.high;
}

/**
 * Get packet loss Tailwind class based on percentage
 */
export function getPacketLossClass(percent: number): string {
  if (percent === 0) return 'text-green-500';
  if (percent <= 1) return 'text-yellow-500';
  return 'text-red-500';
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

