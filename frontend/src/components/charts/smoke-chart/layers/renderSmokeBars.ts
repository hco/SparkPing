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
 * Creates a Gaussian-like gradient centered on the average value.
 * The center (around avg) is darkest, edges (near min/max) fade out.
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

    // Calculate the position of the average relative to min/max range (0 = max, 1 = min)
    const avgPosition = (bounds.avg - bounds.max) / (bounds.min - bounds.max);
    
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

    // Create Gaussian-like distribution with peak at average
    // Using multiple color stops to simulate the bell curve
    const stops = [
      { offset: 0, opacity: 0.15 },      // At max (top)
      { offset: avgPosition * 0.5, opacity: 0.35 },
      { offset: avgPosition, opacity: 0.7 },  // At average (peak)
      { offset: avgPosition + (1 - avgPosition) * 0.5, opacity: 0.35 },
      { offset: 1, opacity: 0.15 },      // At min (bottom)
    ];

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
 * Estimates percentile ranges and renders concentric bands.
 * Uses the IQR (interquartile range) estimation based on standard deviation.
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
    { name: 'outer', percentile: 0.95, color: '#d1d5db', opacity: 0.25 },  // p5-p95 range
    { name: 'mid', percentile: 0.75, color: '#9ca3af', opacity: 0.4 },    // p25-p75 range (IQR)
    { name: 'inner', percentile: 0.5, color: '#6b7280', opacity: 0.6 },   // p40-p60 range (core)
  ];

  validLatencyData.forEach((point, i) => {
    const bounds = calculateBarBounds(point, i, validLatencyData, bucketInterval, xScale, yScale, barWidth);
    // Range in latency values (max is higher latency, min is lower)
    const range = bounds.max - bounds.min;
    
    if (range <= 0) return;

    // Estimate standard deviation from the range
    // Using range/4 as a rough approximation (range ≈ 4σ for normal distribution)
    const estimatedStdDev = range / 4;
    const avg = bounds.avg;

    // Draw bands from outermost to innermost
    bands.forEach(band => {
      // Calculate band boundaries using z-scores
      // For percentile p, z = Φ^(-1)(p) where Φ is the standard normal CDF
      // Simplified approximation for common percentiles
      let zScore: number;
      switch (band.percentile) {
        case 0.95: zScore = 1.96; break;  // ±1.96σ covers 95%
        case 0.75: zScore = 1.15; break;  // ±1.15σ covers 75%
        case 0.5: zScore = 0.67; break;   // ±0.67σ covers 50%
        default: zScore = 1;
      }

      const bandTop = avg + zScore * estimatedStdDev;
      const bandBottom = avg - zScore * estimatedStdDev;
      
      // Clamp to min/max
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
  });
}

/**
 * Style 3: Histogram Bands
 * Divides each bar into discrete vertical segments.
 * Each segment's opacity represents expected density at that latency level.
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
    // Range in latency values (max is higher latency, min is lower)
    const range = bounds.max - bounds.min;
    
    if (range <= 0) return;

    // Estimate standard deviation
    const estimatedStdDev = range / 4;
    const avg = bounds.avg;

    // Create bands from top (max latency) to bottom (min latency)
    // In screen coordinates: max latency = top of chart, min latency = bottom
    for (let b = 0; b < numBands; b++) {
      // Calculate latency value at center of this band
      // Start from max (highest latency) and work down to min
      const bandTop = bounds.max - (range * b) / numBands;
      const bandBottom = bounds.max - (range * (b + 1)) / numBands;
      const bandCenter = (bandTop + bandBottom) / 2;

      // Calculate probability density at this latency level
      // Using Gaussian probability density function
      const zScore = (bandCenter - avg) / estimatedStdDev;
      const density = Math.exp(-0.5 * zScore * zScore);

      // Map density to opacity (0.1 to 0.7 range)
      const opacity = 0.1 + density * 0.6;

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
