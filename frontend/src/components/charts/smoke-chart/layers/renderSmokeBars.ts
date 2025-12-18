import type * as d3 from 'd3';
import type { ChartDataPoint, ChartScales } from '../types';

interface RenderSmokeBarsOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>;
  scales: ChartScales;
  validLatencyData: ChartDataPoint[];
  bucketInterval: number;
  innerWidth: number;
  chartHeight: number;
  barWidth: number;
}

export function renderSmokeBars({
  g,
  defs,
  scales,
  validLatencyData,
  bucketInterval,
  innerWidth,
  chartHeight,
  barWidth,
}: RenderSmokeBarsOptions): void {
  const { xScale, yScale } = scales;

  // Create clip path
  defs
    .append('clipPath')
    .attr('id', 'chart-clip')
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerWidth)
    .attr('height', chartHeight);

  const smokeGroup = g
    .append('g')
    .attr('class', 'smoke-layer')
    .attr('clip-path', 'url(#chart-clip)');

  // Create gradient for smoke effect
  const smokeGradient = defs
    .append('linearGradient')
    .attr('id', 'smoke-gradient')
    .attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', chartHeight);

  smokeGradient
    .append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#9ca3af')
    .attr('stop-opacity', 0.4);
  smokeGradient
    .append('stop')
    .attr('offset', '50%')
    .attr('stop-color', '#9ca3af')
    .attr('stop-opacity', 0.6);
  smokeGradient
    .append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#9ca3af')
    .attr('stop-opacity', 0.3);

  // Draw smoke bars for each valid data point
  validLatencyData.forEach((point, i) => {
    const x = xScale(point.timestamp);
    const minY = yScale(point.min!);
    const maxY = yScale(point.max!);
    const avgY = yScale(point.avg!);

    // Calculate bar boundaries to fill space without gaps
    const prevPoint = validLatencyData[i - 1];
    const nextPoint = validLatencyData[i + 1];

    // Check for gaps
    const hasGapBefore = !prevPoint || (bucketInterval > 0 && (point.timestamp - prevPoint.timestamp) > bucketInterval * 2);
    const hasGapAfter = !nextPoint || (bucketInterval > 0 && (nextPoint.timestamp - point.timestamp) > bucketInterval * 2);

    const halfBucket = bucketInterval > 0 ? (xScale(bucketInterval) - xScale(0)) / 2 : barWidth / 2;

    const barStartX = hasGapBefore
      ? x - halfBucket
      : (xScale(prevPoint!.timestamp) + x) / 2;
    const barEndX = hasGapAfter
      ? x + halfBucket
      : (x + xScale(nextPoint!.timestamp)) / 2;
    const actualBarWidth = Math.max(1, barEndX - barStartX);

    // Draw the variance range as a shaded rectangle (the "smoke")
    const rangeHeight = minY - maxY;
    if (rangeHeight > 0) {
      smokeGroup
        .append('rect')
        .attr('x', barStartX)
        .attr('y', maxY)
        .attr('width', actualBarWidth)
        .attr('height', rangeHeight)
        .attr('fill', '#d1d5db')
        .attr('opacity', 0.5);

      // Draw a darker band around the average to show density
      const densityBandHeight = Math.max(4, rangeHeight * 0.3);
      smokeGroup
        .append('rect')
        .attr('x', barStartX)
        .attr('y', avgY - densityBandHeight / 2)
        .attr('width', actualBarWidth)
        .attr('height', densityBandHeight)
        .attr('fill', '#9ca3af')
        .attr('opacity', 0.6);
    }
  });
}


