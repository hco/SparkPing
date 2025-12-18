import * as d3 from 'd3';
import { format } from 'date-fns';
import type { ChartDataPoint, ChartScales } from '../types';
import { createThrottle } from '../utils';
import { chartColors, getPacketLossColor, type ThemeColors } from '../../../../lib/chartColors';

interface SetupTooltipOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  chartData: ChartDataPoint[];
  chartHeight: number;
  innerWidth: number;
  themeColors: ThemeColors;
}

interface TooltipRefs {
  tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, unknown>;
  cleanup: () => void;
}

export function setupTooltip({
  g,
  scales,
  chartData,
  chartHeight,
  innerWidth,
  themeColors,
}: SetupTooltipOptions): TooltipRefs {
  const { xScale, yScale } = scales;

  // Remove any existing tooltip first
  d3.select('body').selectAll('.d3-smoke-tooltip').remove();

  const tooltip = d3
    .select('body')
    .append('div')
    .attr('class', 'd3-smoke-tooltip')
    .style('opacity', 0)
    .style('position', 'absolute')
    .style('background', themeColors.tooltipBg)
    .style('color', themeColors.textPrimary)
    .style('padding', '12px')
    .style('border', `1px solid ${themeColors.tooltipBorder}`)
    .style('border-radius', '8px')
    .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)')
    .style('pointer-events', 'none')
    .style('font-size', '12px')
    .style('z-index', '1000')
    .style('min-width', '200px')
    .style('transition', 'opacity 0.1s ease-out');

  // Create hover elements
  const hoverLine = g
    .append('line')
    .attr('class', 'hover-line')
    .attr('y1', 0)
    .attr('y2', chartHeight)
    .attr('stroke', themeColors.textMuted)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3')
    .style('opacity', 0);

  const hoverPoint = g
    .append('circle')
    .attr('class', 'hover-point')
    .attr('r', 6)
    .attr('fill', chartColors.median)
    .attr('stroke', themeColors.tooltipBg)
    .attr('stroke-width', 2)
    .style('opacity', 0);

  // Add invisible overlay for mouse tracking
  const overlay = g
    .append('rect')
    .attr('width', innerWidth)
    .attr('height', chartHeight)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair');

  // Throttled mouse handler
  const handleMouseMove = createThrottle((event: MouseEvent) => {
    const [mouseX] = d3.pointer(event, overlay.node());
    const bisect = d3.bisector((d: ChartDataPoint) => d.timestamp).left;
    const x0 = xScale.invert(mouseX);
    const index = bisect(chartData, x0.getTime(), 1);
    const a = chartData[index - 1];
    const b = chartData[index];
    const d =
      b && a && x0.getTime() - a.timestamp < b.timestamp - x0.getTime()
        ? a
        : b || a;

    if (d) {
      const xPos = xScale(d.timestamp);

      // Update hover line position
      hoverLine.attr('x1', xPos).attr('x2', xPos).style('opacity', 1);

      // Update hover point position
      if (d.avg !== null) {
        hoverPoint
          .attr('cx', xPos)
          .attr('cy', yScale(d.avg))
          .style('opacity', 1);
      } else {
        hoverPoint.style('opacity', 0);
      }

      // Update tooltip
      tooltip
        .style('opacity', 1)
        .style('left', `${event.pageX + 15}px`)
        .style('top', `${event.pageY - 15}px`).html(`
          <div style="font-weight: 600; margin-bottom: 8px; color: ${themeColors.textPrimary}; border-bottom: 1px solid ${themeColors.divider}; padding-bottom: 6px;">
            ${format(new Date(d.timestamp), 'MMM dd, yyyy HH:mm:ss')}
          </div>
          <div style="margin-bottom: 8px;">
            <div style="color: ${chartColors.median}; font-weight: 500; font-size: 14px;">
              Median: ${d.avg !== null ? d.avg.toFixed(2) : 'N/A'} ms
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; margin-top: 6px;">
              ${d.avg !== null ? `<span style="color: ${chartColors.avg}; font-size: 11px;">Avg:</span><span style="color: ${chartColors.avg}; font-size: 11px;">${d.avg.toFixed(2)} ms</span>` : ''}
              ${d.min !== null ? `<span style="color: ${chartColors.min}; font-size: 11px;">Min:</span><span style="color: ${chartColors.min}; font-size: 11px;">${d.min.toFixed(2)} ms</span>` : ''}
              ${d.max !== null ? `<span style="color: ${chartColors.max}; font-size: 11px;">Max:</span><span style="color: ${chartColors.max}; font-size: 11px;">${d.max.toFixed(2)} ms</span>` : ''}
            </div>
          </div>
          <div style="border-top: 1px solid ${themeColors.divider}; padding-top: 6px;">
            <div style="color: ${d.packetLossPercent > 0 ? getPacketLossColor(d.packetLossPercent) : chartColors.success}; font-weight: 500;">
              Packet Loss: ${d.packetLossPercent.toFixed(2)}%
            </div>
            <div style="color: ${themeColors.textMuted}; font-size: 11px; margin-top: 2px;">
              ${d.failedCount} failed / ${d.count} total
            </div>
          </div>
        `);
    }
  }, 16);

  overlay
    .on('mousemove', function (event) {
      handleMouseMove(event);
    })
    .on('mouseleave', () => {
      tooltip.style('opacity', 0);
      hoverLine.style('opacity', 0);
      hoverPoint.style('opacity', 0);
    });

  return {
    tooltip,
    cleanup: () => {
      d3.select('body').selectAll('.d3-smoke-tooltip').remove();
    },
  };
}
