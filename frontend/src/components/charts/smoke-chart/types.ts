import type { BucketDataPoint } from '../../../types';

/**
 * Style options for smoke bar visualization:
 * - 'classic': Simple min-max range with darker band around average (original)
 * - 'gradient': Gaussian-like gradient centered on average (SmokePing-inspired)
 * - 'percentile': Multi-band gradient showing estimated percentile ranges
 * - 'histogram': Discrete vertical bands with density-based coloring
 */
export type SmokeBarStyle = 'classic' | 'gradient' | 'percentile' | 'histogram';

export interface D3SmokeChartProps {
  data: BucketDataPoint[];
  width?: number;
  height?: number;
  margin?: ChartMargin;
}

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartDataPoint {
  timestamp: number;
  timestampEnd: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  successfulCount: number;
  failedCount: number;
  packetLossPercent: number;
}

export interface ChartStats {
  medianRTT: number;
  avgRTT: number;
  minRTT: number;
  maxRTT: number;
  currentRTT: number;
  stdDev: number;
  avgPacketLoss: number;
  maxPacketLoss: number;
  minPacketLoss: number;
  currentPacketLoss: number;
  totalPings: number;
  totalBuckets: number;
  lastSampleTime: number;
}

export interface ChartVisibilityOptions {
  showMedianLine: boolean;
  showMinLine: boolean;
  showMaxLine: boolean;
  showAvgLine: boolean;
  showSmokeBars: boolean;
  showPacketLoss: boolean;
  showStatsPanel: boolean;
  clipToP99: boolean;
  smokeBarStyle: SmokeBarStyle;
}

export interface ChartScales {
  xScale: d3.ScaleTime<number, number>;
  yScale: d3.ScaleLinear<number, number>;
}
