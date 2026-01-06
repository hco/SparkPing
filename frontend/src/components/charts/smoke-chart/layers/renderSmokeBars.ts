import * as d3 from 'd3';
import type { ChartDataPoint, ChartScales, SmokeBarStyle } from '../types';

interface RenderSmokeBarsOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>;
  scales: ChartScales;
  validLatencyData: ChartDataPoint[];
  bucketInterval: number;
  innerWidth: number;
  chartHeight: number;
  barWidth: number;
  style: SmokeBarStyle;
}

interface BarBounds {
  x: number;
  startX: number;
  endX: number;
  width: number;
  minY: number;
  maxY: number;
  avgY: number;
  min: number;
  max: number;
  avg: number;
}

/**
 * Calculate bar boundaries for a data point
 */
function calculateBarBounds(
  point: ChartDataPoint,
  index: number,
  validLatencyData: ChartDataPoint[],
  bucketInterval: number,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  barWidth: number
): BarBounds {
  const x = xScale(point.timestamp);
  const minY = yScale(point.min!);
  const maxY = yScale(point.max!);
  const avgY = yScale(point.avg!);

  const prevPoint = validLatencyData[index - 1];
  const nextPoint = validLatencyData[index + 1];

  // Check for gaps
  const hasGapBefore = !prevPoint || 
    (bucketInterval > 0 && (point.timestamp - prevPoint.timestamp) > bucketInterval * 2);
  const hasGapAfter = !nextPoint || 
    (bucketInterval > 0 && (nextPoint.timestamp - point.timestamp) > bucketInterval * 2);

  const halfBucket = bucketInterval > 0 ? (xScale(bucketInterval) - xScale(0)) / 2 : barWidth / 2;

  const startX = hasGapBefore
    ? x - halfBucket
    : (xScale(prevPoint!.timestamp) + x) / 2;
  const endX = hasGapAfter
    ? x + halfBucket
    : (x + xScale(nextPoint!.timestamp)) / 2;
  const width = Math.max(1, endX - startX);

  return {
    x,
    startX,
    endX,
    width,
    minY,
    maxY,
    avgY,
    min: point.min!,
    max: point.max!,
    avg: point.avg!,
  };
}

/**
 * Create shared clip path for all smoke bar styles
 */
function createClipPath(
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
  innerWidth: number,
  chartHeight: number
): void {
  defs
    .append('clipPath')
    .attr('id', 'chart-clip')
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerWidth)
    .attr('height', chartHeight);
}

/**
 * Style 0: Classic (Original)
 * Simple min-max range rectangle with a darker band around the average.
 */
function renderClassicStyle(
  smokeGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  validLatencyData: ChartDataPoint[],
  bucketInterval: number,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  barWidth: number
): void {
  validLatencyData.forEach((point, i) => {
    const bounds = calculateBarBounds(point, i, validLatencyData, bucketInterval, xScale, yScale, barWidth);
    const rangeHeight = bounds.minY - bounds.maxY;

    if (rangeHeight <= 0) return;

    // Draw the variance range as a shaded rectangle (the "smoke")
    smokeGroup
      .append('rect')
      .attr('x', bounds.startX)
      .attr('y', bounds.maxY)
      .attr('width', bounds.width)
      .attr('height', rangeHeight)
      .attr('fill', '#d1d5db')
      .attr('opacity', 0.5);

    // Draw a darker band around the average to show density
    const densityBandHeight = Math.max(4, rangeHeight * 0.3);
    smokeGroup
      .append('rect')
      .attr('x', bounds.startX)
      .attr('y', bounds.avgY - densityBandHeight / 2)
      .attr('width', bounds.width)
      .attr('height', densityBandHeight)
      .attr('fill', '#9ca3af')
      .attr('opacity', 0.6);
  });
}

/**
 * Style 1: Gradient Heatmap
 * Creates a gradient centered on the median (if percentiles available) or average.
 * Uses real percentile data when available, falls back to Gaussian estimation.
 */
function renderGradientStyle(
  smokeGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
  validLatencyData: ChartDataPoint[],
  bucketInterval: number,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  barWidth: number
): void {
  validLatencyData.forEach((point, i) => {
    const bounds = calculateBarBounds(point, i, validLatencyData, bucketInterval, xScale, yScale, barWidth);
    const rangeHeight = bounds.minY - bounds.maxY;
    
    if (rangeHeight <= 0) return;

    // Create unique gradient for this bar
    const gradientId = `smoke-gradient-${i}`;
    const gradient = defs
      .append('linearGradient')
      .attr('id', gradientId)
      .attr('gradientUnits', 'objectBoundingBox')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 1);

    let stops: Array<{ offset: number; opacity: number }>;

    if (point.percentiles) {
      // Use real percentile data to create gradient
      const range = bounds.max - bounds.min;
      const p50Pos = (point.percentiles.p50 - bounds.max) / range;
      const p75Pos = (point.percentiles.p75 - bounds.max) / range;
      const p90Pos = (point.percentiles.p90 - bounds.max) / range;
      const p95Pos = (point.percentiles.p95 - bounds.max) / range;
      
      stops = [
        { offset: 0, opacity: 0.15 },           // At max (top)
        { offset: p95Pos * 0.5, opacity: 0.25 },
        { offset: p90Pos, opacity: 0.4 },
        { offset: p75Pos, opacity: 0.55 },
        { offset: p50Pos, opacity: 0.7 },       // At median (peak)
        { offset: p50Pos + (1 - p50Pos) * 0.5, opacity: 0.35 },
        { offset: 1, opacity: 0.15 },           // At min (bottom)
      ];
    } else {
      // Fall back to Gaussian estimation based on average
      const avgPosition = (bounds.avg - bounds.max) / (bounds.min - bounds.max);
      
      stops = [
        { offset: 0, opacity: 0.15 },      // At max (top)
        { offset: avgPosition * 0.5, opacity: 0.35 },
        { offset: avgPosition, opacity: 0.7 },  // At average (peak)
        { offset: avgPosition + (1 - avgPosition) * 0.5, opacity: 0.35 },
        { offset: 1, opacity: 0.15 },      // At min (bottom)
      ];
    }

    stops.forEach(stop => {
      gradient
        .append('stop')
        .attr('offset', `${stop.offset * 100}%`)
        .attr('stop-color', '#6b7280')
        .attr('stop-opacity', stop.opacity);
    });

    smokeGroup
      .append('rect')
      .attr('x', bounds.startX)
      .attr('y', bounds.maxY)
      .attr('width', bounds.width)
      .attr('height', rangeHeight)
      .attr('fill', `url(#${gradientId})`);
  });
}

/**
 * Style 2: Percentile Bands
 * Renders concentric bands showing percentile ranges.
 * Uses real percentile data when available, falls back to estimation.
 */
function renderPercentileStyle(
  smokeGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  validLatencyData: ChartDataPoint[],
  bucketInterval: number,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  barWidth: number
): void {
  // Define percentile bands with their visual properties
  // Ordered from outermost (lightest) to innermost (darkest)
  const bands = [
    { name: 'outer', color: '#d1d5db', opacity: 0.25 },   // p5-p95 range
    { name: 'mid', color: '#9ca3af', opacity: 0.4 },      // p25-p75 range (IQR)
    { name: 'inner', color: '#6b7280', opacity: 0.6 },    // p40-p60 range (core)
  ];

  validLatencyData.forEach((point, i) => {
    const bounds = calculateBarBounds(point, i, validLatencyData, bucketInterval, xScale, yScale, barWidth);
    const range = bounds.max - bounds.min;
    
    if (range <= 0) return;

    if (point.percentiles) {
      // Use real percentile data
      const p = point.percentiles;
      const bandRanges = [
        { top: p.p95, bottom: bounds.min },  // Outer: min to p95
        { top: p.p75, bottom: (bounds.min + p.p50) / 2 },  // Mid: ~p25 to p75
        { top: (p.p75 + p.p50) / 2, bottom: p.p50 },  // Inner: around median
      ];

      bands.forEach((band, idx) => {
        const bandRange = bandRanges[idx];
        const topY = yScale(Math.min(bandRange.top, bounds.max));
        const bottomY = yScale(Math.max(bandRange.bottom, bounds.min));
        const bandHeight = bottomY - topY;

        if (bandHeight > 0) {
          smokeGroup
            .append('rect')
            .attr('x', bounds.startX)
            .attr('y', topY)
            .attr('width', bounds.width)
            .attr('height', bandHeight)
            .attr('fill', band.color)
            .attr('opacity', band.opacity);
        }
      });
    } else {
      // Fall back to estimation using standard deviation
      const estimatedStdDev = range / 4;
      const avg = bounds.avg;

      const zScores = [1.96, 1.15, 0.67];  // For 95%, 75%, 50%

      bands.forEach((band, idx) => {
        const zScore = zScores[idx];
        const bandTop = avg + zScore * estimatedStdDev;
        const bandBottom = avg - zScore * estimatedStdDev;
        
        const clampedTop = Math.min(bandTop, bounds.max);
        const clampedBottom = Math.max(bandBottom, bounds.min);

        const topY = yScale(clampedTop);
        const bottomY = yScale(clampedBottom);
        const bandHeight = bottomY - topY;

        if (bandHeight > 0) {
          smokeGroup
            .append('rect')
            .attr('x', bounds.startX)
            .attr('y', topY)
            .attr('width', bounds.width)
            .attr('height', bandHeight)
            .attr('fill', band.color)
            .attr('opacity', band.opacity);
        }
      });
    }
  });
}

/**
 * Style 3: Histogram Bands
 * Divides each bar into discrete vertical segments.
 * Uses real percentile data to determine density when available.
 */
function renderHistogramStyle(
  smokeGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  validLatencyData: ChartDataPoint[],
  bucketInterval: number,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  barWidth: number
): void {
  const numBands = 8; // Number of discrete bands per bar

  validLatencyData.forEach((point, i) => {
    const bounds = calculateBarBounds(point, i, validLatencyData, bucketInterval, xScale, yScale, barWidth);
    const range = bounds.max - bounds.min;
    
    if (range <= 0) return;

    // Create bands from top (max latency) to bottom (min latency)
    for (let b = 0; b < numBands; b++) {
      const bandTop = bounds.max - (range * b) / numBands;
      const bandBottom = bounds.max - (range * (b + 1)) / numBands;
      const bandCenter = (bandTop + bandBottom) / 2;

      let opacity: number;

      if (point.percentiles) {
        // Use real percentile data to estimate density
        // Count how many percentiles fall within this band
        const p = point.percentiles;
        const percentileValues = [bounds.min, p.p50, p.p75, p.p90, p.p95, p.p99, bounds.max];
        
        // Estimate density based on how "compressed" the percentiles are in this range
        // More percentiles in a narrow range = higher density
        const inBand = percentileValues.filter(v => v >= bandBottom && v <= bandTop).length;
        
        // Also consider distance from median
        const distFromMedian = Math.abs(bandCenter - p.p50);
        const normalizedDist = distFromMedian / (range / 2);
        
        // Combine both factors: more points in band + closer to median = higher opacity
        const densityFromPoints = inBand / percentileValues.length;
        const densityFromMedian = Math.exp(-normalizedDist * 2);
        
        opacity = 0.1 + (densityFromPoints * 0.3 + densityFromMedian * 0.4);
      } else {
        // Fall back to Gaussian estimation
        const estimatedStdDev = range / 4;
        const avg = bounds.avg;
        const zScore = (bandCenter - avg) / estimatedStdDev;
        const density = Math.exp(-0.5 * zScore * zScore);
        opacity = 0.1 + density * 0.6;
      }

      const topY = yScale(bandTop);
      const bottomY = yScale(bandBottom);
      const bandHeight = bottomY - topY;

      if (bandHeight > 0) {
        smokeGroup
          .append('rect')
          .attr('x', bounds.startX)
          .attr('y', topY)
          .attr('width', bounds.width)
          .attr('height', bandHeight)
          .attr('fill', '#6b7280')
          .attr('opacity', opacity);
      }
    }
  });
}

/**
 * Main render function that dispatches to the appropriate style renderer
 */
export function renderSmokeBars({
  g,
  defs,
  scales,
  validLatencyData,
  bucketInterval,
  innerWidth,
  chartHeight,
  barWidth,
  style,
}: RenderSmokeBarsOptions): void {
  const { xScale, yScale } = scales;

  // Create clip path (shared by all styles)
  createClipPath(defs, innerWidth, chartHeight);

  const smokeGroup = g
    .append('g')
    .attr('class', 'smoke-layer')
    .attr('clip-path', 'url(#chart-clip)');

  // Dispatch to appropriate style renderer
  switch (style) {
    case 'classic':
      renderClassicStyle(smokeGroup, validLatencyData, bucketInterval, xScale, yScale, barWidth);
      break;
    case 'gradient':
      renderGradientStyle(smokeGroup, defs, validLatencyData, bucketInterval, xScale, yScale, barWidth);
      break;
    case 'percentile':
      renderPercentileStyle(smokeGroup, validLatencyData, bucketInterval, xScale, yScale, barWidth);
      break;
    case 'histogram':
      renderHistogramStyle(smokeGroup, validLatencyData, bucketInterval, xScale, yScale, barWidth);
      break;
  }
}
