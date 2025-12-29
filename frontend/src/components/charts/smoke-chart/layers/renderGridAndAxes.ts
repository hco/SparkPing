import * as d3 from 'd3';
import type { ChartScales, ChartMargin } from '../types';
import type { ThemeColors } from '../../../../lib/chartColors';
import { getTimeFormat } from '../utils';

interface RenderGridOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  innerWidth: number;
  themeColors: ThemeColors;
}

export function renderGrid({
  g,
  scales,
  innerWidth,
  themeColors,
}: RenderGridOptions): void {
  const { yScale } = scales;
  const yTicks = yScale.ticks(6);

  const gridLines = g
    .append('g')
    .attr('class', 'grid')
    .attr('stroke', themeColors.gridLine)
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
  themeColors: ThemeColors;
  isMobile?: boolean;
}

export function renderAxes({
  g,
  scales,
  chartHeight,
  margin,
  timeExtent,
  themeColors,
  isMobile = false,
}: RenderAxesOptions): void {
  const { xScale, yScale } = scales;
  const timeFormat = getTimeFormat(timeExtent[0], timeExtent[1]);

  const xAxis = d3.axisBottom(xScale).tickFormat((d) => timeFormat(d as Date));
  // On mobile, use compact format without "ms" since axis label shows the unit
  const yAxis = d3.axisLeft(yScale)
    .tickFormat((d) => isMobile ? `${d}` : `${d} ms`)
    .ticks(isMobile ? 5 : 6);

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
    .style('font-size', isMobile ? '9px' : '11px')
    .style('fill', themeColors.axisText);

  // Style x-axis domain line
  g.select('.x-axis .domain')
    .attr('stroke', themeColors.axisDomain);

  g.selectAll('.x-axis .tick line')
    .attr('stroke', themeColors.axisDomain);

  // Y axis
  g.append('g')
    .attr('class', 'y-axis')
    .call(yAxis)
    .select('.domain')
    .attr('stroke', themeColors.axisDomain);

  g.selectAll('.y-axis .tick text')
    .style('font-size', isMobile ? '9px' : '11px')
    .style('fill', themeColors.axisText);

  g.selectAll('.y-axis .tick line')
    .attr('stroke', themeColors.axisDomain);

  // Y axis label
  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', -margin.left + (isMobile ? 12 : 15))
    .attr('x', -chartHeight / 2)
    .style('text-anchor', 'middle')
    .style('font-size', isMobile ? '10px' : '12px')
    .style('font-weight', '500')
    .style('fill', themeColors.axisLabel)
    .text(isMobile ? 'ms' : 'RTT (ms)');
}
