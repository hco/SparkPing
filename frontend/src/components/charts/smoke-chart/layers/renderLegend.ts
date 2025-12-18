import type * as d3 from 'd3';
import type { ChartVisibilityOptions } from '../types';

interface RenderLegendOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  chartHeight: number;
  visibility: ChartVisibilityOptions;
}

interface LegendItem {
  label: string;
  color: string;
  type?: 'line' | 'rect';
}

export function renderLegend({
  g,
  chartHeight,
  visibility,
}: RenderLegendOptions): void {
  const legendGroup = g
    .append('g')
    .attr('transform', `translate(0, ${chartHeight + 55})`);

  const legendColors: LegendItem[] = [];

  // Add packet loss colors if enabled
  if (visibility.showPacketLoss) {
    legendColors.push(
      { label: '0%', color: '#22c55e' },
      { label: '≤5%', color: '#60a5fa' },
      { label: '5-20%', color: '#8b5cf6' },
      { label: '>20%', color: '#ef4444' },
    );
  }

  // Add stat lines to legend if shown
  if (visibility.showMedianLine) {
    legendColors.push({ label: 'Median', color: '#22c55e', type: 'line' });
  }
  if (visibility.showMinLine) {
    legendColors.push({ label: 'Min', color: '#3b82f6', type: 'line' });
  }
  if (visibility.showMaxLine) {
    legendColors.push({ label: 'Max', color: '#ef4444', type: 'line' });
  }
  if (visibility.showAvgLine) {
    legendColors.push({ label: 'Avg', color: '#f59e0b', type: 'line' });
  }

  legendColors.forEach((item, i) => {
    const x = i * 70;
    if (item.type === 'line') {
      legendGroup
        .append('line')
        .attr('x1', x)
        .attr('x2', x + 16)
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', item.color)
        .attr('stroke-width', 2.5);
    } else {
      legendGroup
        .append('rect')
        .attr('x', x)
        .attr('y', -6)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', item.color)
        .attr('opacity', item.label === 'Range' ? 0.5 : 0.15)
        .attr('rx', 2)
        .attr('stroke', item.color)
        .attr('stroke-width', 1);
    }
    legendGroup
      .append('text')
      .attr('x', x + 18)
      .attr('y', 4)
      .style('font-size', '10px')
      .style('fill', '#6b7280')
      .text(item.label);
  });
}

