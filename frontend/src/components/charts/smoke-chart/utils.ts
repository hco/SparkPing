import { format, differenceInHours, differenceInDays } from 'date-fns';
import * as d3 from 'd3';
import type { BucketDataPoint } from '../../../types';
import type { ChartDataPoint, ChartStats } from './types';

/**
 * Get time axis format based on time range
 */
export function getTimeFormat(
  startTime: number,
  endTime: number
): (date: Date) => string {
  const hours = differenceInHours(endTime, startTime);
  const days = differenceInDays(endTime, startTime);

  if (hours <= 1) {
    return (d: Date) => format(d, 'HH:mm:ss');
  } else if (hours <= 24) {
    return (d: Date) => format(d, 'HH:mm');
  } else if (days <= 7) {
    return (d: Date) => format(d, 'MMM dd HH:mm');
  } else {
    return (d: Date) => format(d, 'MMM dd');
  }
}

/**
 * Transform raw bucket data into chart-ready data points
 */
export function prepareChartData(data: BucketDataPoint[]): ChartDataPoint[] {
  return data
    .map((bucket) => {
      const total = bucket.count;
      const packetLossPercent =
        total > 0 ? (bucket.failed_count / total) * 100 : 0;
      return {
        timestamp: bucket.timestamp_unix * 1000,
        timestampEnd: bucket.timestamp_end_unix * 1000,
        min: bucket.min,
        max: bucket.max,
        avg: bucket.avg,
        count: bucket.count,
        successfulCount: bucket.successful_count,
        failedCount: bucket.failed_count,
        packetLossPercent,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Filter data points that have valid latency values
 */
export function filterValidLatencyData(data: ChartDataPoint[]): ChartDataPoint[] {
  return data.filter(
    (d) => d.min !== null && d.max !== null && d.avg !== null
  );
}

/**
 * Calculate the median interval between data points
 */
export function calculateBucketInterval(chartData: ChartDataPoint[]): number {
  if (chartData.length < 2) return 0;
  
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(chartData.length, 20); i++) {
    intervals.push(chartData[i].timestamp - chartData[i - 1].timestamp);
  }
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)] || 0;
}

/**
 * Calculate all chart statistics from the data
 */
export function calculateChartStats(
  chartData: ChartDataPoint[],
  validLatencyData: ChartDataPoint[]
): ChartStats {
  const allAvgValues = validLatencyData
    .map((d) => d.avg!)
    .sort((a, b) => a - b);
  
  const medianRTT =
    allAvgValues.length > 0
      ? allAvgValues.length % 2 === 0
        ? (allAvgValues[allAvgValues.length / 2 - 1] +
            allAvgValues[allAvgValues.length / 2]) /
          2
        : allAvgValues[Math.floor(allAvgValues.length / 2)]
      : 0;

  const avgRTT =
    validLatencyData.length > 0
      ? d3.mean(validLatencyData, (d) => d.avg!) ?? 0
      : 0;

  const stdDev =
    validLatencyData.length > 0
      ? (() => {
          const mean = d3.mean(validLatencyData, (d) => d.avg!) ?? 0;
          const variance =
            d3.mean(validLatencyData, (d) => Math.pow(d.avg! - mean, 2)) ?? 0;
          return Math.sqrt(variance);
        })()
      : 0;

  return {
    medianRTT,
    avgRTT,
    minRTT:
      validLatencyData.length > 0
        ? d3.min(validLatencyData, (d) => d.min!) ?? 0
        : 0,
    maxRTT:
      validLatencyData.length > 0
        ? d3.max(validLatencyData, (d) => d.max!) ?? 0
        : 0,
    currentRTT:
      validLatencyData.length > 0
        ? validLatencyData[validLatencyData.length - 1].avg ?? 0
        : 0,
    stdDev,
    avgPacketLoss: d3.mean(chartData, (d) => d.packetLossPercent) ?? 0,
    maxPacketLoss: d3.max(chartData, (d) => d.packetLossPercent) ?? 0,
    minPacketLoss: d3.min(chartData, (d) => d.packetLossPercent) ?? 0,
    currentPacketLoss:
      chartData.length > 0
        ? chartData[chartData.length - 1].packetLossPercent
        : 0,
    totalPings: d3.sum(chartData, (d) => d.count),
    totalBuckets: chartData.length,
    lastSampleTime:
      chartData.length > 0
        ? chartData[chartData.length - 1].timestamp
        : Date.now(),
  };
}

/**
 * Calculate the P99 (99th percentile) of max values in the data
 */
export function calculateP99(validLatencyData: ChartDataPoint[]): number {
  if (validLatencyData.length === 0) return 0;
  
  const maxValues = validLatencyData
    .map((d) => d.max!)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  
  if (maxValues.length === 0) return 0;
  
  const p99Index = Math.ceil(maxValues.length * 0.99) - 1;
  return maxValues[Math.max(0, p99Index)];
}

/**
 * Split data into segments based on time gaps (for drawing continuous lines)
 */
export function splitIntoSegments(
  dataPoints: ChartDataPoint[],
  expectedInterval: number
): ChartDataPoint[][] {
  if (dataPoints.length === 0) return [];

  const segments: ChartDataPoint[][] = [];
  let currentSegment: ChartDataPoint[] = [];

  dataPoints.forEach((point, i) => {
    if (i === 0) {
      currentSegment.push(point);
    } else {
      const prevPoint = dataPoints[i - 1];
      const timeDiff = point.timestamp - prevPoint.timestamp;
      const isGap = expectedInterval > 0 && timeDiff > expectedInterval * 2;

      if (isGap) {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
        }
        currentSegment = [point];
      } else {
        currentSegment.push(point);
      }
    }
  });

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Create a throttle function for mouse events
 */
export function createThrottle<Args extends readonly unknown[]>(
  func: (...args: Args) => void,
  limit: number
): (...args: Args) => void {
  let inThrottle = false;
  return (...args: Args) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

