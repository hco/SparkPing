import type * as d3 from 'd3';
import type { ChartVisibilityOptions } from '../types';
import { chartColors, type ThemeColors } from '../../../../lib/chartColors';

interface RenderLegendOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  chartHeight: number;
  visibility: ChartVisibilityOptions;
  themeColors: ThemeColors;
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
  themeColors,
}: RenderLegendOptions): void {
  const legendGroup = g
    .append('g')
    .attr('transform', `translate(0, ${chartHeight + 55})`);

  const legendColors: LegendItem[] = [];

  // Add packet loss colors if enabled
  if (visibility.showPacketLoss) {
    legendColors.push(
      { label: '0%', color: chartColors.packetLoss.none },
      { label: '≤5%', color: chartColors.packetLoss.low },
      { label: '5-20%', color: chartColors.packetLoss.medium },
      { label: '>20%', color: chartColors.packetLoss.high },
    );
  }

  // Add stat lines to legend if shown
  if (visibility.showMedianLine) {
    legendColors.push({ label: 'Median', color: chartColors.median, type: 'line' });
  }
  if (visibility.showMinLine) {
    legendColors.push({ label: 'Min', color: chartColors.min, type: 'line' });
  }
  if (visibility.showMaxLine) {
    legendColors.push({ label: 'Max', color: chartColors.max, type: 'line' });
  }
  if (visibility.showAvgLine) {
    legendColors.push({ label: 'Avg', color: chartColors.avg, type: 'line' });
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
      // Solid fill for packet loss legend - much more visible
      legendGroup
        .append('rect')
        .attr('x', x)
        .attr('y', -6)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', item.color)
        .attr('rx', 2);
    }
    legendGroup
      .append('text')
      .attr('x', x + 18)
      .attr('y', 4)
      .style('font-size', '10px')
      .style('fill', themeColors.textMuted)
      .text(item.label);
  });
}
