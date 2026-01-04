import * as d3 from 'd3';
import type { ChartScales } from '../types';

// Modern accent color for brush selection
const BRUSH_ACCENT = '#3b82f6'; // Tailwind blue-500

interface RenderBrushOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  chartHeight: number;
  innerWidth: number;
  onBrushEnd: (domain: [number, number]) => void;
}

export function renderBrush({
  g,
  scales,
  chartHeight,
  innerWidth,
  onBrushEnd,
}: RenderBrushOptions): d3.Selection<SVGGElement, unknown, null, undefined> {
  const { xScale } = scales;

  const brush = d3
    .brushX()
    .extent([
      [0, 0],
      [innerWidth, chartHeight],
    ])
    .on('end', (event: d3.D3BrushEvent<unknown>) => {
      if (!event.selection) return;

      const [x0, x1] = event.selection as [number, number];

      // Ignore very small selections (likely accidental clicks)
      if (Math.abs(x1 - x0) < 10) return;

      const timeStart = xScale.invert(x0).getTime();
      const timeEnd = xScale.invert(x1).getTime();

      // Clear the brush selection visually
      brushGroup.call(brush.move, null);

      // Trigger the zoom
      onBrushEnd([timeStart, timeEnd]);
    });

  const brushGroup = g
    .append('g')
    .attr('class', 'brush')
    .call(brush);

  // Style the brush overlay
  brushGroup
    .select('.overlay')
    .style('cursor', 'col-resize');

  // Style the brush selection with modern look
  brushGroup
    .select('.selection')
    .attr('fill', BRUSH_ACCENT)
    .attr('fill-opacity', 0.15)
    .attr('stroke', BRUSH_ACCENT)
    .attr('stroke-opacity', 0.8)
    .attr('stroke-width', 2)
    .attr('rx', 4)
    .attr('ry', 4)
    .style('cursor', 'col-resize');

  // Hide resize handles for cleaner look
  brushGroup
    .selectAll('.handle')
    .style('display', 'none');

  return brushGroup;
}
