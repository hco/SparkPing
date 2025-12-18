import * as d3 from 'd3';
import type { ChartScales, ChartMargin } from '../types';
import { getTimeFormat } from '../utils';

interface RenderGridOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  innerWidth: number;
}

export function renderGrid({
  g,
  scales,
  innerWidth,
}: RenderGridOptions): void {
  const { yScale } = scales;
  const yTicks = yScale.ticks(6);

  const gridLines = g
    .append('g')
    .attr('class', 'grid')
    .attr('stroke', '#e5e7eb')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '2,2');

  gridLines
    .selectAll('.y-grid')
    .data(yTicks)
    .enter()
    .append('line')
    .attr('class', 'y-grid')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', (d) => yScale(d))
    .attr('y2', (d) => yScale(d));
}

interface RenderAxesOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  chartHeight: number;
  margin: ChartMargin;
  timeExtent: [number, number];
}

export function renderAxes({
  g,
  scales,
  chartHeight,
  margin,
  timeExtent,
}: RenderAxesOptions): void {
  const { xScale, yScale } = scales;
  const timeFormat = getTimeFormat(timeExtent[0], timeExtent[1]);

  const xAxis = d3.axisBottom(xScale).tickFormat((d) => timeFormat(d as Date));
  const yAxis = d3.axisLeft(yScale).tickFormat((d) => `${d} ms`);

  // X axis
  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${chartHeight})`)
    .call(xAxis)
    .selectAll('text')
    .attr('transform', 'rotate(-45)')
    .style('text-anchor', 'end')
    .attr('dx', '-0.5em')
    .attr('dy', '0.5em')
    .style('font-size', '11px')
    .style('fill', '#6b7280');

  // Y axis
  g.append('g')
    .attr('class', 'y-axis')
    .call(yAxis)
    .select('.domain')
    .attr('stroke', '#d1d5db');

  g.selectAll('.y-axis .tick text')
    .style('font-size', '11px')
    .style('fill', '#6b7280');

  // Y axis label
  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', -margin.left + 15)
    .attr('x', -chartHeight / 2)
    .style('text-anchor', 'middle')
    .style('font-size', '12px')
    .style('font-weight', '500')
    .style('fill', '#374151')
    .text('RTT (ms)');
}

