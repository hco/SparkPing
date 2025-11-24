import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { format } from 'date-fns';
import type { BucketDataPoint } from '../../types';

interface D3LatencyChartProps {
  data: BucketDataPoint[];
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
}

interface ChartDataPoint {
  timestamp: number;
  timestampFormatted: string;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export function D3LatencyChart({
  data,
  width,
  height = 400,
  margin = { top: 20, right: 80, bottom: 60, left: 80 },
}: D3LatencyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: width || 800, height });

  useEffect(() => {
    if (!containerRef.current) return;
    
    if (width) {
      setDimensions({ width, height });
    } else {
      // Use container width if width not specified
      const updateDimensions = () => {
        if (containerRef.current) {
          const containerWidth = containerRef.current.clientWidth;
          setDimensions({ width: containerWidth, height });
        }
      };
      
      updateDimensions();
      const resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(containerRef.current);
      
      return () => resizeObserver.disconnect();
    }
  }, [width, height]);

  useEffect(() => {
    if (!svgRef.current || data.length === 0 || dimensions.width === 0) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    // Prepare data
    const chartData: ChartDataPoint[] = data
      .map((bucket) => ({
        timestamp: bucket.timestamp_unix * 1000, // Convert to milliseconds
        timestampFormatted: format(new Date(bucket.timestamp_unix * 1000), 'HH:mm:ss'),
        min: bucket.min,
        max: bucket.max,
        avg: bucket.avg,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Calculate dimensions
    const innerWidth = dimensions.width - margin.left - margin.right;
    const innerHeight = dimensions.height - margin.top - margin.bottom;

    // Create SVG
    const svg = d3
      .select(svgRef.current)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3
      .scaleTime()
      .domain(d3.extent(chartData, (d) => d.timestamp) as [number, number])
      .range([0, innerWidth]);

    const allValues = chartData.flatMap((d) => [d.min, d.max, d.avg]).filter((v): v is number => v !== null);
    const yMax = d3.max(allValues) || 100;
    const yScale = d3.scaleLinear().domain([0, yMax * 1.1]).nice().range([innerHeight, 0]);

    // Color scheme
    const colors = {
      avg: '#3b82f6', // Blue
      min: '#10b981', // Green
      max: '#ef4444', // Red
      band: '#3b82f6',
    };

    // Create gradient for the band
    const gradientId = 'latency-gradient';
    const gradient = svg
      .append('defs')
      .append('linearGradient')
      .attr('id', gradientId)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', innerHeight)
      .attr('x2', 0)
      .attr('y2', 0);

    gradient.append('stop').attr('offset', '0%').attr('stop-color', colors.band).attr('stop-opacity', 0.3);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', colors.band).attr('stop-opacity', 0.05);

    // Area generator for the min-max band
    const areaBand = d3
      .area<ChartDataPoint>()
      .x((d) => xScale(d.timestamp))
      .y0((d) => (d.min !== null ? yScale(d.min) : yScale(0)))
      .y1((d) => (d.max !== null ? yScale(d.max) : yScale(0)))
      .curve(d3.curveMonotoneX);

    // Line generators
    const lineAvg = d3
      .line<ChartDataPoint>()
      .x((d) => xScale(d.timestamp))
      .y((d) => (d.avg !== null ? yScale(d.avg) : 0))
      .curve(d3.curveMonotoneX);

    const lineMin = d3
      .line<ChartDataPoint>()
      .x((d) => xScale(d.timestamp))
      .y((d) => (d.min !== null ? yScale(d.min) : 0))
      .curve(d3.curveMonotoneX);

    const lineMax = d3
      .line<ChartDataPoint>()
      .x((d) => xScale(d.timestamp))
      .y((d) => (d.max !== null ? yScale(d.max) : 0))
      .curve(d3.curveMonotoneX);

    // Filter out null values for lines
    const validData = chartData.filter((d) => d.min !== null && d.max !== null && d.avg !== null);

    // Draw the band (min-max area)
    if (validData.length > 0) {
      g.append('path')
        .datum(validData)
        .attr('fill', `url(#${gradientId})`)
        .attr('d', areaBand);
    }

    // Draw lines
    if (validData.length > 0) {
      // Average line (thick, solid)
      g.append('path')
        .datum(validData)
        .attr('fill', 'none')
        .attr('stroke', colors.avg)
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('d', lineAvg);

      // Min line (dashed, thinner)
      g.append('path')
        .datum(validData)
        .attr('fill', 'none')
        .attr('stroke', colors.min)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5')
        .attr('stroke-linecap', 'round')
        .attr('d', lineMin);

      // Max line (dashed, thinner)
      g.append('path')
        .datum(validData)
        .attr('fill', 'none')
        .attr('stroke', colors.max)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5')
        .attr('stroke-linecap', 'round')
        .attr('d', lineMax);
    }

    // Add dots for average values
    g.selectAll('.dot-avg')
      .data(validData)
      .enter()
      .append('circle')
      .attr('class', 'dot-avg')
      .attr('cx', (d) => xScale(d.timestamp))
      .attr('cy', (d) => (d.avg !== null ? yScale(d.avg) : 0))
      .attr('r', 3)
      .attr('fill', colors.avg)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);

    // Grid lines
    const gridLines = g
      .append('g')
      .attr('class', 'grid')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');

    gridLines
      .selectAll('.y-grid')
      .data(yScale.ticks(5))
      .enter()
      .append('line')
      .attr('class', 'y-grid')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    // Axes
    const xAxis = d3.axisBottom(xScale).tickFormat((d) => format(d as Date, 'HH:mm'));
    const yAxis = d3.axisLeft(yScale).tickFormat((d) => `${d} ms`);

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.5em')
      .attr('dy', '0.5em');

    g.append('g').attr('class', 'y-axis').call(yAxis);

    // Axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -margin.left + 20)
      .attr('x', -innerHeight / 2)
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('fill', '#374151')
      .text('Latency (ms)');

    g.append('text')
      .attr('transform', `translate(${innerWidth / 2}, ${innerHeight + margin.bottom - 10})`)
      .style('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('fill', '#374151')
      .text('Time');

    // Legend
    const legend = g.append('g').attr('class', 'legend').attr('transform', `translate(${innerWidth - 150}, 20)`);

    const legendItems = [
      { label: 'Average', color: colors.avg, style: 'solid' },
      { label: 'Min', color: colors.min, style: 'dashed' },
      { label: 'Max', color: colors.max, style: 'dashed' },
    ];

    legendItems.forEach((item, i) => {
      const legendRow = legend.append('g').attr('transform', `translate(0, ${i * 20})`);

      legendRow
        .append('line')
        .attr('x1', 0)
        .attr('x2', 20)
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', item.color)
        .attr('stroke-width', item.style === 'solid' ? 3 : 2)
        .attr('stroke-dasharray', item.style === 'dashed' ? '5,5' : '0');

      legendRow
        .append('text')
        .attr('x', 25)
        .attr('y', 4)
        .style('font-size', '12px')
        .style('fill', '#374151')
        .text(item.label);
    });

    // Tooltip
    const tooltip = d3
      .select('body')
      .append('div')
      .attr('class', 'd3-tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background', 'white')
      .style('padding', '10px')
      .style('border', '1px solid #d1d5db')
      .style('border-radius', '6px')
      .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1)')
      .style('pointer-events', 'none')
      .style('font-size', '12px')
      .style('z-index', '1000');

    // Add invisible overlay for mouse tracking
    const overlay = g
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair');

    overlay
      .on('mousemove', function (event) {
        const [mouseX] = d3.pointer(event);
        const bisect = d3.bisector((d: ChartDataPoint) => d.timestamp).left;
        const x0 = xScale.invert(mouseX);
        const index = bisect(chartData, x0.getTime(), 1);
        const a = chartData[index - 1];
        const b = chartData[index];
        const d = b && x0.getTime() - a.timestamp < b.timestamp - x0.getTime() ? a : b;

        if (d) {
          const xPos = xScale(d.timestamp);
          const yPos = d.avg !== null ? yScale(d.avg) : innerHeight / 2;

          // Show tooltip
          tooltip
            .style('opacity', 1)
            .style('left', `${event.pageX + 10}px`)
            .style('top', `${event.pageY - 10}px`)
            .html(`
              <div style="font-weight: 600; margin-bottom: 4px;">${format(new Date(d.timestamp), 'HH:mm:ss')}</div>
              ${d.avg !== null ? `<div style="color: ${colors.avg}">Avg: ${d.avg.toFixed(2)} ms</div>` : ''}
              ${d.min !== null ? `<div style="color: ${colors.min}">Min: ${d.min.toFixed(2)} ms</div>` : ''}
              ${d.max !== null ? `<div style="color: ${colors.max}">Max: ${d.max.toFixed(2)} ms</div>` : ''}
            `);

          // Highlight point
          g.selectAll('.highlight').remove();
          g.append('circle')
            .attr('class', 'highlight')
            .attr('cx', xPos)
            .attr('cy', yPos)
            .attr('r', 6)
            .attr('fill', 'none')
            .attr('stroke', colors.avg)
            .attr('stroke-width', 2);
        }
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
        g.selectAll('.highlight').remove();
      });

    // Cleanup function
    return () => {
      d3.select('body').selectAll('.d3-tooltip').remove();
    };
  }, [data, dimensions.width, dimensions.height, margin]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg">
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} className="w-full h-auto" style={{ maxWidth: '100%', height: 'auto' }} />
    </div>
  );
}

