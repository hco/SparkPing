import type { BucketDataPoint } from '../../../types';

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

interface ChartDimensions {
  width: number;
  height: number;
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
  clipToP99: boolean;
}

export interface ChartScales {
  xScale: d3.ScaleTime<number, number>;
  yScale: d3.ScaleLinear<number, number>;
}

interface ChartContext {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>;
  scales: ChartScales;
  dimensions: {
    innerWidth: number;
    innerHeight: number;
    chartHeight: number;
  };
  chartData: ChartDataPoint[];
  validLatencyData: ChartDataPoint[];
  bucketInterval: number;
}


