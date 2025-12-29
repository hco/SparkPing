import type * as d3 from 'd3';
import type { ChartVisibilityOptions } from '../types';
import { chartColors, type ThemeColors } from '../../../../lib/chartColors';

interface RenderLegendOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  chartHeight: number;
  innerWidth: number;
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
  innerWidth,
  visibility,
  themeColors,
}: RenderLegendOptions): void {
  const legendGroup = g
    .append('g')
    .attr('transform', `translate(0, ${chartHeight + 50})`);

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

  if (legendColors.length === 0) return;

  // Calculate spacing based on available width
  // Use tighter spacing on narrow screens
  const itemCount = legendColors.length;
  const minSpacing = 50; // minimum space per item
  const idealSpacing = 70; // ideal space per item
  const availableWidth = innerWidth;
  
  // Calculate how much space we can give each item
  let itemWidth = Math.min(idealSpacing, Math.max(minSpacing, availableWidth / itemCount));
  
  // Check if we need to wrap to multiple rows
  const maxItemsPerRow = Math.max(2, Math.floor(availableWidth / minSpacing));
  const needsWrap = itemCount > maxItemsPerRow && availableWidth < itemCount * minSpacing;
  
  if (needsWrap) {
    // Wrap to multiple rows
    itemWidth = availableWidth / Math.min(itemCount, maxItemsPerRow);
  }

  legendColors.forEach((item, i) => {
    let x: number;
    let y: number;
    
    if (needsWrap) {
      const row = Math.floor(i / maxItemsPerRow);
      const col = i % maxItemsPerRow;
      x = col * itemWidth;
      y = row * 18;
    } else {
      // Center the legend horizontally
      const totalWidth = itemCount * itemWidth;
      const startX = Math.max(0, (availableWidth - totalWidth) / 2);
      x = startX + i * itemWidth;
      y = 0;
    }
    
    if (item.type === 'line') {
      legendGroup
        .append('line')
        .attr('x1', x)
        .attr('x2', x + 14)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', item.color)
        .attr('stroke-width', 2.5);
    } else {
      // Solid fill for packet loss legend - much more visible
      legendGroup
        .append('rect')
        .attr('x', x)
        .attr('y', y - 5)
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', item.color)
        .attr('rx', 2);
    }
    legendGroup
      .append('text')
      .attr('x', x + 16)
      .attr('y', y + 3)
      .style('font-size', '10px')
      .style('fill', themeColors.textMuted)
      .text(item.label);
  });
}
