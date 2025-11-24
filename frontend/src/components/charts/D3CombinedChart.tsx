import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { format } from 'date-fns';
import type { BucketDataPoint } from '../../types';

interface D3CombinedChartProps {
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

export function D3CombinedChart({
  data,
  width,
  height = 500,
  margin = { top: 20, right: 100, bottom: 60, left: 80 },
}: D3CombinedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: width || 800, height });

  useEffect(() => {
    if (!containerRef.current) return;

    if (width) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        setDimensions({ width, height });
      });
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
    if (!svgRef.current || data.length === 0 || dimensions.width === 0) {
      return;
    }

    const svg = d3
      .select(svgRef.current)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height);

    svg.selectAll('*').remove();

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

    if (chartData.length === 0) {
      return;
    }

    const validLatencyData = chartData.filter(
      (point) => point.min !== null && point.max !== null && point.avg !== null
    );

    const innerWidth = Math.max(200, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(300, dimensions.height - margin.top - margin.bottom);
    const gapBetweenCharts = 40;
    const initialLatencyHeight = innerHeight * 0.65;
    const initialPacketLossHeight = innerHeight - initialLatencyHeight - gapBetweenCharts;
    const packetLossHeight = Math.max(120, initialPacketLossHeight);
    const latencyHeight = Math.max(180, innerHeight - packetLossHeight - gapBetweenCharts);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const extent = d3.extent(chartData, (point) => point.timestamp) as [number, number];
    let [domainStart, domainEnd] = extent;
    if (domainStart === domainEnd) {
      domainStart -= 60 * 1000;
      domainEnd += 60 * 1000;
    }

    const xScale = d3
      .scaleTime()
      .domain([new Date(domainStart), new Date(domainEnd)])
      .range([0, innerWidth]);

    let barWidth = Math.min(40, innerWidth / chartData.length * 0.6);
    if (chartData.length > 1) {
      const sortedTimestamps = chartData.map((point) => point.timestamp).sort((a, b) => a - b);
      let minDiff = Infinity;
      for (let i = 1; i < sortedTimestamps.length; i += 1) {
        minDiff = Math.min(minDiff, sortedTimestamps[i] - sortedTimestamps[i - 1]);
      }
      if (minDiff !== Infinity && domainEnd - domainStart > 0) {
        const pxPerMs = innerWidth / (domainEnd - domainStart);
        barWidth = Math.min(barWidth, pxPerMs * minDiff * 0.6);
      }
    }
    barWidth = Math.max(8, barWidth);

    const maxLatency = validLatencyData.length
      ? d3.max(validLatencyData, (point) => point.max!) ?? 100
      : 100;
    const yLatencyScale = d3
      .scaleLinear()
      .domain([0, maxLatency * 1.1])
      .nice()
      .range([latencyHeight, 0]);

    const maxPacketLoss = d3.max(chartData, (point) => point.packetLossPercent) ?? 0;
    const yPacketLossScale = d3
      .scaleLinear()
      .domain([0, Math.max(maxPacketLoss * 1.2, 10)])
      .nice()
      .range([packetLossHeight, 0]);

    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn).domain([25, 0]).clamp(true);

    const latencyGroup = g.append('g');
    const packetLossGroup = g.append('g').attr('transform', `translate(0, ${latencyHeight + gapBetweenCharts})`);

    latencyGroup
      .append('g')
      .attr('class', 'latency-grid')
      .call(
        d3
          .axisLeft(yLatencyScale)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .selectAll('line')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-dasharray', '3 3');
    latencyGroup.select('.latency-grid').select('.domain').remove();

    latencyGroup
      .append('g')
      .attr('class', 'latency-axis')
      .call(
        d3
          .axisLeft(yLatencyScale)
          .ticks(5)
          .tickFormat((value) => `${value as number} ms`)
      )
      .select('.domain')
      .attr('stroke', '#d1d5db');

    packetLossGroup
      .append('g')
      .attr('class', 'packet-loss-axis-left')
      .call(
        d3
          .axisLeft(yPacketLossScale)
          .ticks(4)
          .tickFormat((value) => `${value as number}%`)
      )
      .select('.domain')
      .attr('stroke', '#d1d5db');

    packetLossGroup
      .append('g')
      .attr('transform', `translate(${innerWidth}, 0)`)
      .attr('class', 'packet-loss-axis-right')
      .call(
        d3
          .axisRight(yPacketLossScale)
          .ticks(4)
          .tickFormat((value) => `${value as number}%`)
      )
      .select('.domain')
      .attr('stroke', '#d1d5db');

    packetLossGroup
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${packetLossHeight})`)
      .call(d3.axisBottom(xScale).ticks(6).tickFormat((value) => format(value as Date, 'HH:mm')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.6em')
      .attr('dy', '0.5em');

    if (validLatencyData.length > 0) {
      latencyGroup
        .selectAll('.latency-range')
        .data(validLatencyData)
        .enter()
        .append('rect')
        .attr('class', 'latency-range')
        .attr('x', (point) => xScale(new Date(point.timestamp)) - barWidth / 2)
        .attr('width', barWidth)
        .attr('y', (point) => yLatencyScale(point.max!))
        .attr('height', (point) => Math.max(2, yLatencyScale(point.min!) - yLatencyScale(point.max!)))
        .attr('rx', 4)
        .attr('fill', (point) => colorScale(point.packetLossPercent))
        .attr('fill-opacity', 0.9);

      latencyGroup
        .selectAll('.latency-avg')
        .data(validLatencyData)
        .enter()
        .append('circle')
        .attr('class', 'latency-avg')
        .attr('cx', (point) => xScale(new Date(point.timestamp)))
        .attr('cy', (point) => yLatencyScale(point.avg!))
        .attr('r', 4)
        .attr('fill', '#111827')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5);
    } else {
      latencyGroup
        .append('text')
        .attr('x', innerWidth / 2)
        .attr('y', latencyHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#9ca3af')
        .text('Latency data unavailable for this range');
    }

    packetLossGroup
      .selectAll('.packet-loss-bar')
      .data(chartData)
      .enter()
      .append('rect')
      .attr('class', 'packet-loss-bar')
      .attr('x', (point) => xScale(new Date(point.timestamp)) - barWidth / 2)
      .attr('width', barWidth)
      .attr('y', (point) => yPacketLossScale(point.packetLossPercent))
      .attr('height', (point) => Math.max(1, packetLossHeight - yPacketLossScale(point.packetLossPercent)))
      .attr('rx', 4)
      .attr('fill', '#f97316')
      .attr('fill-opacity', 0.8);

    latencyGroup
      .append('text')
      .attr('x', -margin.left + 20)
      .attr('y', -10)
      .attr('fill', '#374151')
      .attr('font-size', 12)
      .text('Latency (min → max) with avg markers. Color = packet loss intensity');

    packetLossGroup
      .append('text')
      .attr('x', -margin.left + 20)
      .attr('y', -10)
      .attr('fill', '#374151')
      .attr('font-size', 12)
      .text('Packet loss (%) distribution');

    const legend = g.append('g').attr('transform', `translate(${innerWidth - 220}, 10)`);
    const legendItems = [
      { label: 'Latency range', type: 'range' },
      { label: 'Average latency', type: 'dot' },
      { label: 'Packet loss bar', type: 'bar' },
    ];

    legendItems.forEach((item, index) => {
      const row = legend.append('g').attr('transform', `translate(0, ${index * 20})`);
      if (item.type === 'range') {
        row
          .append('rect')
          .attr('width', 24)
          .attr('height', 10)
          .attr('rx', 3)
          .attr('fill', colorScale(5));
      } else if (item.type === 'dot') {
        row.append('circle').attr('cx', 6).attr('cy', 5).attr('r', 5).attr('fill', '#111827');
      } else {
        row
          .append('rect')
          .attr('y', 1)
          .attr('width', 24)
          .attr('height', 8)
          .attr('rx', 2)
          .attr('fill', '#f97316');
      }
      row.append('text').attr('x', 32).attr('y', 9).attr('fill', '#374151').attr('font-size', 12).text(item.label);
    });

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

    const overlay = g
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent');

    overlay
      .on('mousemove', function (event) {
        const [mouseX] = d3.pointer(event);
        const xTime = xScale.invert(mouseX).getTime();
        const bisect = d3.bisector<ChartDataPoint, number>((point) => point.timestamp).left;
        const index = bisect(chartData, xTime, 1);
        const previous = chartData[index - 1];
        const next = chartData[index];

        const current =
          previous && next
            ? xTime - previous.timestamp > next.timestamp - xTime
              ? next
              : previous
            : previous || next;

        if (!current) {
          return;
        }

        tooltip
          .style('opacity', 1)
          .style('left', `${event.pageX + 12}px`)
          .style('top', `${event.pageY - 12}px`)
          .html(`
            <div style="font-weight:600; margin-bottom:6px;">${current.timestampFormatted}</div>
            <div style="margin-bottom:4px;">
              ${current.min !== null ? `<div style="color:#059669;">Min: ${current.min.toFixed(2)} ms</div>` : ''}
              ${current.avg !== null ? `<div style="color:#111827;">Avg: ${current.avg.toFixed(2)} ms</div>` : ''}
              ${current.max !== null ? `<div style="color:#dc2626;">Max: ${current.max.toFixed(2)} ms</div>` : ''}
            </div>
            <div style="color:#c2410c;">Packet loss: ${current.packetLossPercent.toFixed(2)}%</div>
            <div style="color:#6b7280; font-size:11px;">Failed ${current.failedCount} / ${current.totalCount}</div>
          `);

        latencyGroup.selectAll('.highlight').remove();
        packetLossGroup.selectAll('.highlight').remove();

        if (current.min !== null && current.max !== null) {
          latencyGroup
            .append('rect')
            .attr('class', 'highlight')
            .attr('x', xScale(new Date(current.timestamp)) - barWidth / 2)
            .attr('width', barWidth)
            .attr('y', yLatencyScale(current.max))
            .attr('height', Math.max(2, yLatencyScale(current.min) - yLatencyScale(current.max)))
            .attr('fill', 'none')
            .attr('stroke', '#111827')
            .attr('stroke-width', 2)
            .attr('rx', 4);
        }

        if (current.avg !== null) {
          latencyGroup
            .append('circle')
            .attr('class', 'highlight')
            .attr('cx', xScale(new Date(current.timestamp)))
            .attr('cy', yLatencyScale(current.avg))
            .attr('r', 6)
            .attr('fill', 'none')
            .attr('stroke', '#111827')
            .attr('stroke-width', 2);
        }

        packetLossGroup
          .append('rect')
          .attr('class', 'highlight')
          .attr('x', xScale(new Date(current.timestamp)) - barWidth / 2)
          .attr('width', barWidth)
          .attr('y', yPacketLossScale(current.packetLossPercent))
          .attr('height', Math.max(2, packetLossHeight - yPacketLossScale(current.packetLossPercent)))
          .attr('fill', 'none')
          .attr('stroke', '#c2410c')
          .attr('stroke-width', 2)
          .attr('rx', 4);
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
        latencyGroup.selectAll('.highlight').remove();
        packetLossGroup.selectAll('.highlight').remove();
      });

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

