import * as d3 from 'd3';
import type { ChartDataPoint, ChartScales } from '../types';
import { splitIntoSegments } from '../utils';

interface RenderStatLineOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  dataPoints: ChartDataPoint[];
  getValue: (d: ChartDataPoint) => number | null;
  color: string;
  className: string;
  bucketInterval: number;
  strokeWidth?: number;
}

export function renderStatLine({
  g,
  scales,
  dataPoints,
  getValue,
  color,
  className,
  bucketInterval,
  strokeWidth = 2,
}: RenderStatLineOptions): void {
  if (dataPoints.length === 0) return;

  const { xScale, yScale } = scales;
  const segments = splitIntoSegments(dataPoints, bucketInterval);

  const line = d3
    .line<ChartDataPoint>()
    .x((d) => xScale(d.timestamp))
    .y((d) => yScale(getValue(d)!))
    .curve(d3.curveMonotoneX);

  segments.forEach((segment) => {
    if (segment.length >= 2) {
      g.append('path')
        .datum(segment)
        .attr('class', className)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('d', line);
    }
  });
}

interface RenderMedianLineOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  validLatencyData: ChartDataPoint[];
  bucketInterval: number;
}

export function renderMedianLine({
  g,
  scales,
  validLatencyData,
  bucketInterval,
}: RenderMedianLineOptions): void {
  if (validLatencyData.length === 0) return;

  const { xScale, yScale } = scales;

  // Render the line
  renderStatLine({
    g,
    scales,
    dataPoints: validLatencyData,
    getValue: (d) => d.avg,
    color: '#22c55e',
    className: 'median-line',
    bucketInterval,
    strokeWidth: 2.5,
  });

  // Draw median points (limit to avoid too many DOM nodes)
  const pointInterval = Math.max(1, Math.floor(validLatencyData.length / 100));
  validLatencyData.forEach((point, i) => {
    if (i % pointInterval === 0 || i === validLatencyData.length - 1) {
      g.append('circle')
        .attr('class', 'median-point')
        .attr('cx', xScale(point.timestamp))
        .attr('cy', yScale(point.avg!))
        .attr('r', 3)
        .attr('fill', '#22c55e')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1);
    }
  });
}

