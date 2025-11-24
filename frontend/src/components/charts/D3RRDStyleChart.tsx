import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { format } from 'date-fns';
import type { BucketDataPoint } from '../../types';

interface D3RRDStyleChartProps {
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
  packetLossPercent: number;
  failedCount: number;
  totalCount: number;
}

// Color scale for packet loss severity
const getPacketLossColor = (packetLossPercent: number): string => {
  if (packetLossPercent === 0) return '#10b981'; // Green - no loss
  if (packetLossPercent <= 5) return '#60a5fa'; // Light blue - 1-5%
  if (packetLossPercent <= 10) return '#3b82f6'; // Blue - 5-10%
  if (packetLossPercent <= 15) return '#8b5cf6'; // Purple - 10-15%
  if (packetLossPercent <= 20) return '#a855f7'; // Darker purple - 15-20%
  if (packetLossPercent <= 50) return '#ec4899'; // Pink - 20-50%
  return '#ef4444'; // Red - 50%+
};

export function D3RRDStyleChart({
  data,
  width,
  height = 500,
  margin = { top: 40, right: 120, bottom: 100, left: 80 },
}: D3RRDStyleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: width || 800, height });

  useEffect(() => {
    if (!containerRef.current) return;
    
    if (width) {
      setDimensions({ width, height });
    } else {
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
      .map((bucket) => {
        const total = bucket.count;
        const packetLossPercent = total > 0 ? (bucket.failed_count / total) * 100 : 0;
        return {
          timestamp: bucket.timestamp_unix * 1000,
          timestampFormatted: format(new Date(bucket.timestamp_unix * 1000), 'HH:mm:ss'),
          min: bucket.min,
          max: bucket.max,
          avg: bucket.avg,
          packetLossPercent,
          failedCount: bucket.failed_count,
          totalCount: total,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);

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

    const validLatencyData = chartData.filter((d) => d.min !== null && d.max !== null && d.avg !== null);
    const allLatencies = validLatencyData.flatMap((d) => [d.min!, d.max!, d.avg!]);
    const latencyMax = d3.max(allLatencies) || 100;
    const yScale = d3.scaleLinear().domain([0, latencyMax * 1.15]).nice().range([innerHeight, 0]);

    // Calculate bar width
    const timeRange = xScale.domain()[1].getTime() - xScale.domain()[0].getTime();
    const barWidth = Math.min(
      Math.max(8, (innerWidth / chartData.length) * 0.7),
      40
    );

    // Colors
    const avgColor = '#10b981'; // Green for average
    const minMaxColor = '#6b7280'; // Gray for min/max range

    // Draw candlesticks for latency (min/max/avg)
    if (validLatencyData.length > 0) {
      const candlestickGroup = g.append('g').attr('class', 'candlesticks');

      validLatencyData.forEach((point) => {
        const x = xScale(point.timestamp);
        const minY = yScale(point.min!);
        const maxY = yScale(point.max!);
        const avgY = yScale(point.avg!);

        // Draw the wick (min to max line)
        candlestickGroup
          .append('line')
          .attr('x1', x)
          .attr('x2', x)
          .attr('y1', minY)
          .attr('y2', maxY)
          .attr('stroke', minMaxColor)
          .attr('stroke-width', 2)
          .attr('opacity', 0.6);

        // Draw the body (rectangle from min to max)
        const bodyHeight = Math.max(2, maxY - minY);
        candlestickGroup
          .append('rect')
          .attr('x', x - barWidth / 2)
          .attr('y', minY)
          .attr('width', barWidth)
          .attr('height', bodyHeight)
          .attr('fill', minMaxColor)
          .attr('fill-opacity', 0.2)
          .attr('rx', 2);

        // Draw average marker (horizontal line)
        candlestickGroup
          .append('line')
          .attr('x1', x - barWidth / 2)
          .attr('x2', x + barWidth / 2)
          .attr('y1', avgY)
          .attr('y2', avgY)
          .attr('stroke', avgColor)
          .attr('stroke-width', 3)
          .attr('stroke-linecap', 'round');

        // Draw average dot
        candlestickGroup
          .append('circle')
          .attr('cx', x)
          .attr('cy', avgY)
          .attr('r', 4)
          .attr('fill', avgColor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2);
      });
    }

    // Draw packet loss indicators as colored vertical bars at bottom
    const packetLossBarHeight = 20;
    const packetLossY = innerHeight + 10;

    chartData.forEach((point) => {
      if (point.packetLossPercent > 0) {
        const x = xScale(point.timestamp);
        const color = getPacketLossColor(point.packetLossPercent);
        const barHeight = Math.min(packetLossBarHeight, point.packetLossPercent * 0.5);
        
        g.append('rect')
          .attr('x', x - barWidth / 2)
          .attr('y', packetLossY)
          .attr('width', barWidth)
          .attr('height', barHeight)
          .attr('fill', color)
          .attr('rx', 2)
          .attr('opacity', 0.9);
      } else {
        // Show green indicator for no packet loss
        const x = xScale(point.timestamp);
        g.append('rect')
          .attr('x', x - barWidth / 2)
          .attr('y', packetLossY)
          .attr('width', barWidth)
          .attr('height', 3)
          .attr('fill', '#10b981')
          .attr('rx', 1)
          .attr('opacity', 0.6);
      }
    });

    // Grid lines
    const gridLines = g
      .append('g')
      .attr('class', 'grid')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    gridLines
      .selectAll('.y-grid')
      .data(yScale.ticks(6))
      .enter()
      .append('line')
      .attr('class', 'y-grid')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    // Axes
    const xAxis = d3.axisBottom(xScale).tickFormat((d) => format(d as Date, 'MMM dd HH:mm'));
    const yAxis = d3.axisLeft(yScale).tickFormat((d) => `${d} ms`);

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.5em')
      .attr('dy', '0.5em')
      .style('font-size', '11px')
      .style('fill', '#6b7280');

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .select('.domain')
      .attr('stroke', '#d1d5db');

    g.selectAll('.y-axis .tick text')
      .style('font-size', '11px')
      .style('fill', '#6b7280');

    // Axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -margin.left + 25)
      .attr('x', -innerHeight / 2)
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('font-size', '13px')
      .style('font-weight', '500')
      .style('fill', '#374151')
      .text('Latency (ms)');

    // Title
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', -15)
      .style('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', '600')
      .style('fill', '#111827')
      .text('Network Performance - Candlestick View');

    // Calculate statistics
    const stats = {
      avgLatency: validLatencyData.length > 0
        ? d3.mean(validLatencyData, (d) => d.avg!) ?? 0
        : 0,
      minLatency: validLatencyData.length > 0
        ? d3.min(validLatencyData, (d) => d.min!) ?? 0
        : 0,
      maxLatency: validLatencyData.length > 0
        ? d3.max(validLatencyData, (d) => d.max!) ?? 0
        : 0,
      currentLatency: validLatencyData.length > 0
        ? validLatencyData[validLatencyData.length - 1].avg ?? 0
        : 0,
      stdDev: validLatencyData.length > 0
        ? (() => {
            const mean = d3.mean(validLatencyData, (d) => d.avg!) ?? 0;
            const variance = d3.mean(validLatencyData, (d) => Math.pow((d.avg! - mean), 2)) ?? 0;
            return Math.sqrt(variance);
          })()
        : 0,
      avgPacketLoss: d3.mean(chartData, (d) => d.packetLossPercent) ?? 0,
      maxPacketLoss: d3.max(chartData, (d) => d.packetLossPercent) ?? 0,
      minPacketLoss: d3.min(chartData, (d) => d.packetLossPercent) ?? 0,
      currentPacketLoss: chartData.length > 0 ? chartData[chartData.length - 1].packetLossPercent : 0,
    };

    // Statistics panel
    const statsGroup = g.append('g').attr('transform', `translate(${innerWidth + 20}, 0)`);
    
    statsGroup
      .append('text')
      .attr('y', 0)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', '#111827')
      .text('Statistics');

    const statsYStart = 25;
    const statsLineHeight = 18;

    const formatStat = (value: number, unit: string = '') => {
      if (unit === 'ms') return `${value.toFixed(1)} ${unit}`;
      if (unit === '%') return `${value.toFixed(2)} ${unit}`;
      return value.toFixed(2);
    };

    const statsRows = [
      { label: 'avg:', value: formatStat(stats.avgLatency, 'ms'), color: '#374151' },
      { label: 'max:', value: formatStat(stats.maxLatency, 'ms'), color: '#374151' },
      { label: 'min:', value: formatStat(stats.minLatency, 'ms'), color: '#374151' },
      { label: 'now:', value: formatStat(stats.currentLatency, 'ms'), color: '#10b981' },
      { label: 'sd:', value: formatStat(stats.stdDev, 'ms'), color: '#6b7280' },
      { label: '', value: '', color: '#6b7280' }, // Spacer
      { label: 'avg:', value: formatStat(stats.avgPacketLoss, '%'), color: '#374151' },
      { label: 'max:', value: formatStat(stats.maxPacketLoss, '%'), color: '#374151' },
      { label: 'min:', value: formatStat(stats.minPacketLoss, '%'), color: '#374151' },
      { label: 'now:', value: formatStat(stats.currentPacketLoss, '%'), color: '#10b981' },
    ];

    statsRows.forEach((row, i) => {
      if (row.label === '' && row.value === '') {
        return; // Skip spacer
      }
      const y = statsYStart + i * statsLineHeight;
      statsGroup
        .append('text')
        .attr('y', y)
        .style('font-size', '11px')
        .style('fill', '#6b7280')
        .text(row.label);
      statsGroup
        .append('text')
        .attr('y', y)
        .attr('x', 35)
        .style('font-size', '11px')
        .style('fill', row.color)
        .style('font-weight', row.color === '#10b981' ? '600' : '400')
        .text(row.value);
    });

    // Packet loss color legend
    const legendGroup = g.append('g').attr('transform', `translate(0, ${innerHeight + packetLossBarHeight + 40})`);
    
    legendGroup
      .append('text')
      .attr('y', 0)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('fill', '#374151')
      .text('Packet Loss:');

    const legendColors = [
      { label: '0%', color: '#10b981' },
      { label: '1-5%', color: '#60a5fa' },
      { label: '5-10%', color: '#3b82f6' },
      { label: '10-15%', color: '#8b5cf6' },
      { label: '15-20%', color: '#a855f7' },
      { label: '20-50%', color: '#ec4899' },
      { label: '50%+', color: '#ef4444' },
    ];

    legendColors.forEach((item, i) => {
      const x = 100 + i * 60;
      legendGroup
        .append('rect')
        .attr('x', x)
        .attr('y', -8)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', item.color)
        .attr('rx', 2);
      legendGroup
        .append('text')
        .attr('x', x + 16)
        .attr('y', 2)
        .style('font-size', '10px')
        .style('fill', '#6b7280')
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
      .style('padding', '12px')
      .style('border', '1px solid #d1d5db')
      .style('border-radius', '8px')
      .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)')
      .style('pointer-events', 'none')
      .style('font-size', '12px')
      .style('z-index', '1000')
      .style('min-width', '180px');

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

          // Show tooltip
          tooltip
            .style('opacity', 1)
            .style('left', `${event.pageX + 12}px`)
            .style('top', `${event.pageY - 12}px`)
            .html(`
              <div style="font-weight: 600; margin-bottom: 8px; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">
                ${format(new Date(d.timestamp), 'MMM dd, yyyy HH:mm:ss')}
              </div>
              <div style="margin-bottom: 6px;">
                <div style="color: #10b981; font-weight: 500;">Avg: ${d.avg !== null ? d.avg.toFixed(2) : 'N/A'} ms</div>
                ${d.min !== null ? `<div style="color: #6b7280; font-size: 11px;">Min: ${d.min.toFixed(2)} ms</div>` : ''}
                ${d.max !== null ? `<div style="color: #6b7280; font-size: 11px;">Max: ${d.max.toFixed(2)} ms</div>` : ''}
              </div>
              <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #e5e7eb;">
                <div style="color: ${getPacketLossColor(d.packetLossPercent)}; font-weight: 500;">
                  Packet Loss: ${d.packetLossPercent.toFixed(2)}%
                </div>
                <div style="color: #6b7280; font-size: 11px; margin-top: 2px;">
                  Failed: ${d.failedCount} / Total: ${d.totalCount}
                </div>
              </div>
            `);

          // Highlight candlestick
          g.selectAll('.highlight').remove();
          
          if (d.min !== null && d.max !== null && d.avg !== null) {
            const minY = yScale(d.min);
            const maxY = yScale(d.max);
            const avgY = yScale(d.avg);
            const bodyHeight = Math.max(2, maxY - minY);

            // Highlight wick
            g.append('line')
              .attr('class', 'highlight')
              .attr('x1', xPos)
              .attr('x2', xPos)
              .attr('y1', minY)
              .attr('y2', maxY)
              .attr('stroke', '#111827')
              .attr('stroke-width', 3)
              .attr('opacity', 0.8);

            // Highlight body
            g.append('rect')
              .attr('class', 'highlight')
              .attr('x', xPos - barWidth / 2)
              .attr('y', minY)
              .attr('width', barWidth)
              .attr('height', bodyHeight)
              .attr('fill', 'none')
              .attr('stroke', '#111827')
              .attr('stroke-width', 2)
              .attr('rx', 2);

            // Highlight average line
            g.append('line')
              .attr('class', 'highlight')
              .attr('x1', xPos - barWidth / 2 - 5)
              .attr('x2', xPos + barWidth / 2 + 5)
              .attr('y1', avgY)
              .attr('y2', avgY)
              .attr('stroke', avgColor)
              .attr('stroke-width', 4)
              .attr('opacity', 0.9);
          }

          // Highlight packet loss bar
          if (d.packetLossPercent > 0) {
            const barHeight = Math.min(packetLossBarHeight, d.packetLossPercent * 0.5);
            g.append('rect')
              .attr('class', 'highlight')
              .attr('x', xPos - barWidth / 2)
              .attr('y', packetLossY)
              .attr('width', barWidth)
              .attr('height', barHeight)
              .attr('fill', 'none')
              .attr('stroke', getPacketLossColor(d.packetLossPercent))
              .attr('stroke-width', 3)
              .attr('rx', 2);
          }
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
