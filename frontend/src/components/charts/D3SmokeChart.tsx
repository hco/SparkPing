import { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { format, differenceInHours, differenceInDays } from 'date-fns';
import type { BucketDataPoint } from '../../types';
import { useUserPreferences } from '../../hooks/useUserPreferences';

interface D3SmokeChartProps {
  data: BucketDataPoint[];
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
}

interface ChartDataPoint {
  timestamp: number;
  timestampEnd: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  successfulCount: number;
  failedCount: number;
  packetLossPercent: number;
}

// Color scale for packet loss severity
function getPacketLossColor(packetLossPercent: number): string {
  if (packetLossPercent === 0) return '#22c55e'; // Green - no loss
  if (packetLossPercent <= 5) return '#60a5fa'; // Light blue - low loss
  if (packetLossPercent <= 20) return '#8b5cf6'; // Purple - medium loss
  return '#ef4444'; // Red - high loss
}

// Get time axis format based on time range
function getTimeFormat(
  startTime: number,
  endTime: number
): (date: Date) => string {
  const hours = differenceInHours(endTime, startTime);
  const days = differenceInDays(endTime, startTime);

  if (hours <= 1) {
    return (d: Date) => format(d, 'HH:mm:ss');
  } else if (hours <= 24) {
    return (d: Date) => format(d, 'HH:mm');
  } else if (days <= 7) {
    return (d: Date) => format(d, 'MMM dd HH:mm');
  } else {
    return (d: Date) => format(d, 'MMM dd');
  }
}

export function D3SmokeChart({
  data,
  width,
  height = 500,
  margin = { top: 40, right: 150, bottom: 80, left: 80 },
}: D3SmokeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: width || 800, height });
  const { preferences, setPreference } = useUserPreferences();
  const { showMedianLine, showMinLine, showMaxLine, showAvgLine, showSmokeBars, showPacketLoss } = preferences;

  // Throttle function for mouse events
  const throttle = useCallback(<Args extends readonly unknown[]>(
    func: (...args: Args) => void,
    limit: number
  ): ((...args: Args) => void) => {
    let inThrottle = false;
    return (...args: Args) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    if (width) {
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
    if (!svgRef.current || data.length === 0 || dimensions.width === 0) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    // Prepare data
    const chartData: ChartDataPoint[] = data
      .map((bucket) => {
        const total = bucket.count;
        const packetLossPercent =
          total > 0 ? (bucket.failed_count / total) * 100 : 0;
        return {
          timestamp: bucket.timestamp_unix * 1000,
          timestampEnd: bucket.timestamp_end_unix * 1000,
          min: bucket.min,
          max: bucket.max,
          avg: bucket.avg,
          count: bucket.count,
          successfulCount: bucket.successful_count,
          failedCount: bucket.failed_count,
          packetLossPercent,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    const innerWidth = dimensions.width - margin.left - margin.right;
    const innerHeight = dimensions.height - margin.top - margin.bottom;
    const chartHeight = innerHeight - 40; // Reserve space for packet loss bars

    // Create SVG
    const svg = d3
      .select(svgRef.current)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const timeExtent = d3.extent(chartData, (d) => d.timestamp) as [
      number,
      number,
    ];
    const xScale = d3.scaleTime().domain(timeExtent).range([0, innerWidth]);

    const validLatencyData = chartData.filter(
      (d) => d.min !== null && d.max !== null && d.avg !== null
    );
    const latencyMax = d3.max(validLatencyData, (d) => d.max!) || 100;
    const yScale = d3
      .scaleLinear()
      .domain([0, latencyMax * 1.15])
      .nice()
      .range([chartHeight, 0]);

    // Calculate bar width based on bucket count
    const barWidth = Math.max(
      2,
      Math.min(Math.max(4, (innerWidth / chartData.length) * 0.8), 30)
    );

    // === A) Draw "smoke" background using min-max range rectangles ===
    // Instead of thousands of lines, draw gradient rectangles for each bucket

    // Create defs and clip path to constrain smoke to chart area
    const defs = svg.append('defs');

    // Add clip path to prevent drawing below the chart baseline
    defs
      .append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', chartHeight);

    const smokeGroup = g
      .append('g')
      .attr('class', 'smoke-layer')
      .attr('clip-path', 'url(#chart-clip)');
    const smokeGradient = defs
      .append('linearGradient')
      .attr('id', 'smoke-gradient')
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', chartHeight);

    smokeGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#9ca3af')
      .attr('stop-opacity', 0.4);
    smokeGradient
      .append('stop')
      .attr('offset', '50%')
      .attr('stop-color', '#9ca3af')
      .attr('stop-opacity', 0.6);
    smokeGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#9ca3af')
      .attr('stop-opacity', 0.3);

    // Calculate expected bucket interval for proper bar width
    let bucketInterval = 0;
    if (chartData.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < Math.min(chartData.length, 20); i++) {
        intervals.push(chartData[i].timestamp - chartData[i - 1].timestamp);
      }
      intervals.sort((a, b) => a - b);
      bucketInterval = intervals[Math.floor(intervals.length / 2)] || 0;
    }

    // Only draw smoke bars if enabled
    if (showSmokeBars) {
      validLatencyData.forEach((point, i) => {
        const x = xScale(point.timestamp);
        const minY = yScale(point.min!);
        const maxY = yScale(point.max!);
        const avgY = yScale(point.avg!);

        // Calculate bar boundaries to fill space without gaps
        const prevPoint = validLatencyData[i - 1];
        const nextPoint = validLatencyData[i + 1];

        // Check for gaps
        const hasGapBefore = !prevPoint || (bucketInterval > 0 && (point.timestamp - prevPoint.timestamp) > bucketInterval * 2);
        const hasGapAfter = !nextPoint || (bucketInterval > 0 && (nextPoint.timestamp - point.timestamp) > bucketInterval * 2);

        const halfBucket = bucketInterval > 0 ? (xScale(bucketInterval) - xScale(0)) / 2 : barWidth / 2;

        const barStartX = hasGapBefore
          ? x - halfBucket
          : (xScale(prevPoint!.timestamp) + x) / 2;
        const barEndX = hasGapAfter
          ? x + halfBucket
          : (x + xScale(nextPoint!.timestamp)) / 2;
        const actualBarWidth = Math.max(1, barEndX - barStartX);

        // Draw the variance range as a shaded rectangle (the "smoke")
        const rangeHeight = minY - maxY;
        if (rangeHeight > 0) {
          smokeGroup
            .append('rect')
            .attr('x', barStartX)
            .attr('y', maxY)
            .attr('width', actualBarWidth)
            .attr('height', rangeHeight)
            .attr('fill', '#d1d5db')
            .attr('opacity', 0.5);

          // Draw a darker band around the average to show density
          const densityBandHeight = Math.max(4, rangeHeight * 0.3);
          smokeGroup
            .append('rect')
            .attr('x', barStartX)
            .attr('y', avgY - densityBandHeight / 2)
            .attr('width', actualBarWidth)
            .attr('height', densityBandHeight)
            .attr('fill', '#9ca3af')
            .attr('opacity', 0.6);
        }
      });
    }

    // === D) Draw packet loss as transparent background areas ===
    // Draw BEFORE smoke layer so it appears behind
    // Only draw if packet loss display is enabled
    if (showPacketLoss) {
      const packetLossGroup = g
        .insert('g', '.smoke-layer')
        .attr('class', 'packet-loss-layer')
        .attr('clip-path', 'url(#chart-clip)');

      // Calculate expected bucket interval to detect gaps
      let expectedInterval = 0;
      if (chartData.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < Math.min(chartData.length, 20); i++) {
          intervals.push(chartData[i].timestamp - chartData[i - 1].timestamp);
        }
        intervals.sort((a, b) => a - b);
        expectedInterval = intervals[Math.floor(intervals.length / 2)] || 0;
      }

      // Group consecutive buckets by packet loss color to draw continuous areas
      // Include 0% packet loss (green) but exclude buckets with no data
      type PacketLossRegion = {
        startX: number;
        endX: number;
        color: string;
      };

      const regions: PacketLossRegion[] = [];
      let currentRegion: PacketLossRegion | null = null;

      // Calculate half bucket width in pixels for boundaries
      const halfBucketWidth = expectedInterval > 0
        ? (xScale(expectedInterval) - xScale(0)) / 2
        : barWidth / 2;

      chartData.forEach((point, i) => {
        // Only show background if we have data for this bucket
        const hasData = point.count > 0;
        const color = hasData ? getPacketLossColor(point.packetLossPercent) : null;
        const x = xScale(point.timestamp);

        // Calculate bucket boundaries, but don't extend into gaps
        const prevPoint = chartData[i - 1];
        const nextPoint = chartData[i + 1];

        // Check for gaps (time difference > 2x expected interval)
        const hasGapBefore = prevPoint && expectedInterval > 0
          ? (point.timestamp - prevPoint.timestamp) > expectedInterval * 2
          : true;
        const hasGapAfter = nextPoint && expectedInterval > 0
          ? (nextPoint.timestamp - point.timestamp) > expectedInterval * 2
          : true;

        // Calculate boundaries - use midpoint only if no gap, otherwise use half bucket width
        const bucketStartX = hasGapBefore
          ? x - halfBucketWidth
          : (xScale(prevPoint!.timestamp) + x) / 2;
        const bucketEndX = hasGapAfter
          ? x + halfBucketWidth
          : (x + xScale(nextPoint!.timestamp)) / 2;

        if (hasData && color) {
          // Check if we should extend current region or start new one
          const canExtend = currentRegion
            && currentRegion.color === color
            && !hasGapBefore;

          if (canExtend) {
            // Extend current region
            currentRegion!.endX = bucketEndX;
          } else {
            // End previous region if exists
            if (currentRegion) {
              regions.push(currentRegion);
            }
            // Start new region
            currentRegion = {
              startX: bucketStartX,
              endX: bucketEndX,
              color,
            };
          }
        } else {
          // No data - end current region if exists
          if (currentRegion) {
            regions.push(currentRegion);
            currentRegion = null;
          }
        }
      });

      // Don't forget the last region
      if (currentRegion) {
        regions.push(currentRegion);
      }

      // Draw each region as a continuous area
      regions.forEach((region) => {
        packetLossGroup
          .append('rect')
          .attr('class', 'packet-loss-bg')
          .attr('x', region.startX)
          .attr('y', 0)
          .attr('width', Math.max(1, region.endX - region.startX))
          .attr('height', chartHeight)
          .attr('fill', region.color)
          .attr('opacity', 0.15);
      });
    }


    // === C) Draw median RTT line (using avg as proxy for median) ===
    // Only draw if showMedianLine is enabled
    if (showMedianLine && validLatencyData.length > 0) {
      // Calculate expected bucket duration to detect gaps
      let expectedInterval = 0;
      if (chartData.length >= 2) {
        // Use the most common interval between consecutive points
        const intervals: number[] = [];
        for (let i = 1; i < Math.min(chartData.length, 20); i++) {
          intervals.push(chartData[i].timestamp - chartData[i - 1].timestamp);
        }
        intervals.sort((a, b) => a - b);
        expectedInterval = intervals[Math.floor(intervals.length / 2)] || 0;
      }

      // Split data into segments where there are no gaps
      // A gap is when the time difference is more than 2x the expected interval
      const segments: ChartDataPoint[][] = [];
      let currentSegment: ChartDataPoint[] = [];

      validLatencyData.forEach((point, i) => {
        if (i === 0) {
          currentSegment.push(point);
        } else {
          const prevPoint = validLatencyData[i - 1];
          const timeDiff = point.timestamp - prevPoint.timestamp;
          const isGap = expectedInterval > 0 && timeDiff > expectedInterval * 2;

          if (isGap) {
            // End current segment and start a new one
            if (currentSegment.length > 0) {
              segments.push(currentSegment);
            }
            currentSegment = [point];
          } else {
            currentSegment.push(point);
          }
        }
      });

      // Don't forget the last segment
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }

      // Draw each segment as a separate line
      const medianLine = d3
        .line<ChartDataPoint>()
        .x((d) => xScale(d.timestamp))
        .y((d) => yScale(d.avg!))
        .curve(d3.curveMonotoneX);

      segments.forEach((segment) => {
        if (segment.length >= 2) {
          g.append('path')
            .datum(segment)
            .attr('class', 'median-line')
            .attr('fill', 'none')
            .attr('stroke', '#22c55e')
            .attr('stroke-width', 2.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('d', medianLine);
        }
      });

      // Draw median points (limit to avoid too many DOM nodes)
      const pointInterval = Math.max(
        1,
        Math.floor(validLatencyData.length / 100)
      );
      validLatencyData.forEach((point, i) => {
        if (i % pointInterval === 0 || i === validLatencyData.length - 1) {
          g.append('circle')
            .attr('class', 'median-point')
            .attr('cx', xScale(point.timestamp))
            .attr('cy', yScale(point.avg!))
            .attr('r', 3)
            .attr('fill', '#22c55e')
            .attr('stroke', '#fff')
            .attr('stroke-width', 1);
        }
      });
    }

    // === Helper function to draw stat lines ===
    const drawStatLine = (
      dataPoints: ChartDataPoint[],
      getValue: (d: ChartDataPoint) => number | null,
      color: string,
      className: string
    ) => {
      if (dataPoints.length === 0) return;

      // Calculate expected bucket duration to detect gaps
      let expectedInterval = 0;
      if (chartData.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < Math.min(chartData.length, 20); i++) {
          intervals.push(chartData[i].timestamp - chartData[i - 1].timestamp);
        }
        intervals.sort((a, b) => a - b);
        expectedInterval = intervals[Math.floor(intervals.length / 2)] || 0;
      }

      // Split data into segments where there are no gaps
      const segments: ChartDataPoint[][] = [];
      let currentSegment: ChartDataPoint[] = [];

      dataPoints.forEach((point, i) => {
        if (i === 0) {
          currentSegment.push(point);
        } else {
          const prevPoint = dataPoints[i - 1];
          const timeDiff = point.timestamp - prevPoint.timestamp;
          const isGap = expectedInterval > 0 && timeDiff > expectedInterval * 2;

          if (isGap) {
            if (currentSegment.length > 0) {
              segments.push(currentSegment);
            }
            currentSegment = [point];
          } else {
            currentSegment.push(point);
          }
        }
      });

      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }

      // Draw each segment as a separate line
      const line = d3
        .line<ChartDataPoint>()
        .x((d) => xScale(d.timestamp))
        .y((d) => yScale(getValue(d)!))
        .curve(d3.curveMonotoneX);

      segments.forEach((segment) => {
        if (segment.length >= 2) {
          g.append('path')
            .datum(segment)
            .attr('class', className)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('d', line);
        }
      });
    };

    // === Draw Min RTT line ===
    if (showMinLine && validLatencyData.length > 0) {
      drawStatLine(validLatencyData, (d) => d.min, '#3b82f6', 'min-line'); // Blue
    }

    // === Draw Max RTT line ===
    if (showMaxLine && validLatencyData.length > 0) {
      drawStatLine(validLatencyData, (d) => d.max, '#ef4444', 'max-line'); // Red
    }

    // === Draw Avg RTT line ===
    if (showAvgLine && validLatencyData.length > 0) {
      drawStatLine(validLatencyData, (d) => d.avg, '#f59e0b', 'avg-line'); // Amber
    }

    // === Grid lines ===
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

    // === Axes ===
    const timeFormat = getTimeFormat(timeExtent[0], timeExtent[1]);
    const xAxis = d3.axisBottom(xScale).tickFormat((d) => timeFormat(d as Date));
    const yAxis = d3.axisLeft(yScale).tickFormat((d) => `${d} ms`);

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
      .attr('y', -margin.left + 15)
      .attr('x', -chartHeight / 2)
      .style('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', '500')
      .style('fill', '#374151')
      .text('RTT (ms)');

    // === Calculate statistics ===
    const allAvgValues = validLatencyData
      .map((d) => d.avg!)
      .sort((a, b) => a - b);
    const medianRTT =
      allAvgValues.length > 0
        ? allAvgValues.length % 2 === 0
          ? (allAvgValues[allAvgValues.length / 2 - 1] +
              allAvgValues[allAvgValues.length / 2]) /
            2
          : allAvgValues[Math.floor(allAvgValues.length / 2)]
        : 0;

    const stats = {
      medianRTT,
      avgRTT:
        validLatencyData.length > 0
          ? d3.mean(validLatencyData, (d) => d.avg!) ?? 0
          : 0,
      minRTT:
        validLatencyData.length > 0
          ? d3.min(validLatencyData, (d) => d.min!) ?? 0
          : 0,
      maxRTT:
        validLatencyData.length > 0
          ? d3.max(validLatencyData, (d) => d.max!) ?? 0
          : 0,
      currentRTT:
        validLatencyData.length > 0
          ? validLatencyData[validLatencyData.length - 1].avg ?? 0
          : 0,
      stdDev:
        validLatencyData.length > 0
          ? (() => {
              const mean = d3.mean(validLatencyData, (d) => d.avg!) ?? 0;
              const variance =
                d3.mean(validLatencyData, (d) => Math.pow(d.avg! - mean, 2)) ??
                0;
              return Math.sqrt(variance);
            })()
          : 0,
      avgPacketLoss: d3.mean(chartData, (d) => d.packetLossPercent) ?? 0,
      maxPacketLoss: d3.max(chartData, (d) => d.packetLossPercent) ?? 0,
      minPacketLoss: d3.min(chartData, (d) => d.packetLossPercent) ?? 0,
      currentPacketLoss:
        chartData.length > 0
          ? chartData[chartData.length - 1].packetLossPercent
          : 0,
      totalPings: d3.sum(chartData, (d) => d.count),
      totalBuckets: chartData.length,
      lastSampleTime:
        chartData.length > 0
          ? chartData[chartData.length - 1].timestamp
          : Date.now(),
    };

    // === E) Statistics panel (right side) ===
    const statsGroup = g
      .append('g')
      .attr('transform', `translate(${innerWidth + 15}, 0)`);

    const panelWidth = 120;
    const valueX = panelWidth - 5; // Right-align values

    // Background for stats panel
    statsGroup
      .append('rect')
      .attr('x', -5)
      .attr('y', -5)
      .attr('width', panelWidth + 10)
      .attr('height', 255)
      .attr('fill', '#f9fafb')
      .attr('rx', 6)
      .attr('stroke', '#e5e7eb');

    statsGroup
      .append('text')
      .attr('y', 14)
      .attr('x', 5)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('fill', '#111827')
      .text('Median RTT');

    let yPos = 32;
    const lineHeight = 17;

    const formatMs = (value: number) => `${value.toFixed(1)} ms`;
    const formatPercent = (value: number) => `${value.toFixed(2)}%`;

    const rttStats = [
      { label: 'avg', value: formatMs(stats.avgRTT), color: '#374151' },
      { label: 'max', value: formatMs(stats.maxRTT), color: '#374151' },
      { label: 'min', value: formatMs(stats.minRTT), color: '#374151' },
      { label: 'now', value: formatMs(stats.currentRTT), color: '#22c55e' },
      { label: 'sd', value: formatMs(stats.stdDev), color: '#6b7280' },
    ];

    rttStats.forEach((row) => {
      statsGroup
        .append('text')
        .attr('y', yPos)
        .attr('x', 5)
        .style('font-size', '10px')
        .style('fill', '#6b7280')
        .text(row.label);
      statsGroup
        .append('text')
        .attr('y', yPos)
        .attr('x', valueX)
        .style('font-size', '10px')
        .style('fill', row.color)
        .style('font-weight', row.color === '#22c55e' ? '600' : '400')
        .style('text-anchor', 'end')
        .text(row.value);
      yPos += lineHeight;
    });

    yPos += 8;
    statsGroup
      .append('text')
      .attr('y', yPos)
      .attr('x', 5)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('fill', '#111827')
      .text('Packet Loss');

    yPos += 18;

    // Use severity color for current packet loss
    const currentLossColor = getPacketLossColor(stats.currentPacketLoss);

    const lossStats = [
      { label: 'avg', value: formatPercent(stats.avgPacketLoss), color: '#374151' },
      { label: 'max', value: formatPercent(stats.maxPacketLoss), color: '#374151' },
      { label: 'min', value: formatPercent(stats.minPacketLoss), color: '#374151' },
      { label: 'now', value: formatPercent(stats.currentPacketLoss), color: currentLossColor },
    ];

    lossStats.forEach((row) => {
      statsGroup
        .append('text')
        .attr('y', yPos)
        .attr('x', 5)
        .style('font-size', '10px')
        .style('fill', '#6b7280')
        .text(row.label);
      statsGroup
        .append('text')
        .attr('y', yPos)
        .attr('x', valueX)
        .style('font-size', '10px')
        .style('fill', row.color)
        .style('font-weight', row.label === 'now' ? '600' : '400')
        .style('text-anchor', 'end')
        .text(row.value);
      yPos += lineHeight;
    });

    // Probe details section
    yPos += 6;
    statsGroup
      .append('line')
      .attr('x1', 0)
      .attr('x2', panelWidth)
      .attr('y1', yPos - 3)
      .attr('y2', yPos - 3)
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);

    yPos += 8;
    statsGroup
      .append('text')
      .attr('y', yPos)
      .attr('x', 5)
      .style('font-size', '9px')
      .style('fill', '#9ca3af')
      .text(`${stats.totalPings} pings · ${stats.totalBuckets} buckets`);

    yPos += 12;
    statsGroup
      .append('text')
      .attr('y', yPos)
      .attr('x', 5)
      .style('font-size', '9px')
      .style('fill', '#9ca3af')
      .text(`Last: ${format(new Date(stats.lastSampleTime), 'HH:mm:ss')}`);

    // === Packet loss legend (compact, below x-axis labels) ===
    const legendGroup = g
      .append('g')
      .attr('transform', `translate(0, ${chartHeight + 55})`);

    const legendColors: { label: string; color: string; type?: 'line' | 'rect' }[] = [];

    // Add packet loss colors if enabled
    if (showPacketLoss) {
      legendColors.push(
        { label: '0%', color: '#22c55e' },
        { label: '≤5%', color: '#60a5fa' },
        { label: '5-20%', color: '#8b5cf6' },
        { label: '>20%', color: '#ef4444' },
      );
    }

    // Add smoke range indicator if enabled
    if (showSmokeBars) {
      legendColors.push({ label: 'Range', color: '#d1d5db' });
    }

    // Add stat lines to legend if shown
    if (showMedianLine) {
      legendColors.push({ label: 'Median', color: '#22c55e', type: 'line' });
    }
    if (showMinLine) {
      legendColors.push({ label: 'Min', color: '#3b82f6', type: 'line' });
    }
    if (showMaxLine) {
      legendColors.push({ label: 'Max', color: '#ef4444', type: 'line' });
    }
    if (showAvgLine) {
      legendColors.push({ label: 'Avg', color: '#f59e0b', type: 'line' });
    }

    legendColors.forEach((item, i) => {
      const x = i * 70;
      if (item.type === 'line') {
        // Draw line for median
        legendGroup
          .append('line')
          .attr('x1', x)
          .attr('x2', x + 16)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke', item.color)
          .attr('stroke-width', 2.5);
      } else {
        // Draw rectangle for others
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


    // === Tooltip (create once, reuse) ===
    // Remove any existing tooltip first
    d3.select('body').selectAll('.d3-smoke-tooltip').remove();

    const tooltip = d3
      .select('body')
      .append('div')
      .attr('class', 'd3-smoke-tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background', 'white')
      .style('padding', '12px')
      .style('border', '1px solid #d1d5db')
      .style('border-radius', '8px')
      .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1)')
      .style('pointer-events', 'none')
      .style('font-size', '12px')
      .style('z-index', '1000')
      .style('min-width', '200px')
      .style('transition', 'opacity 0.1s ease-out');

    tooltipRef.current = tooltip.node();

    // Create hover elements once
    const hoverLine = g
      .append('line')
      .attr('class', 'hover-line')
      .attr('y1', 0)
      .attr('y2', chartHeight)
      .attr('stroke', '#9ca3af')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0);

    const hoverPoint = g
      .append('circle')
      .attr('class', 'hover-point')
      .attr('r', 6)
      .attr('fill', '#22c55e')
      .attr('stroke', '#fff')
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
    const handleMouseMove = throttle((event: MouseEvent) => {
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
            <div style="font-weight: 600; margin-bottom: 8px; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">
              ${format(new Date(d.timestamp), 'MMM dd, yyyy HH:mm:ss')}
            </div>
            <div style="margin-bottom: 8px;">
              <div style="color: #22c55e; font-weight: 500; font-size: 14px;">
                Median: ${d.avg !== null ? d.avg.toFixed(2) : 'N/A'} ms
              </div>
              ${d.min !== null ? `<div style="color: #6b7280; font-size: 11px; margin-top: 4px;">Min: ${d.min.toFixed(2)} ms</div>` : ''}
              ${d.max !== null ? `<div style="color: #6b7280; font-size: 11px;">Max: ${d.max.toFixed(2)} ms</div>` : ''}
            </div>
            <div style="border-top: 1px solid #e5e7eb; padding-top: 6px;">
              <div style="color: ${d.packetLossPercent > 0 ? getPacketLossColor(d.packetLossPercent) : '#22c55e'}; font-weight: 500;">
                Packet Loss: ${d.packetLossPercent.toFixed(2)}%
              </div>
              <div style="color: #6b7280; font-size: 11px; margin-top: 2px;">
                ${d.failedCount} failed / ${d.count} total
              </div>
            </div>
          `);
      }
    }, 16); // ~60fps

    overlay
      .on('mousemove', function (event) {
        handleMouseMove(event);
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
        hoverLine.style('opacity', 0);
        hoverPoint.style('opacity', 0);
      });

    // Cleanup function
    return () => {
      d3.select('body').selectAll('.d3-smoke-tooltip').remove();
    };
  }, [data, dimensions.width, dimensions.height, margin, throttle, showMedianLine, showMinLine, showMaxLine, showAvgLine, showSmokeBars, showPacketLoss]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg">
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-2">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showSmokeBars}
            onChange={(e) => setPreference('showSmokeBars', e.target.checked)}
            className="w-4 h-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500"
          />
          <span className="ml-2 text-sm text-gray-700">Smoke Bars</span>
        </label>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showPacketLoss}
            onChange={(e) => setPreference('showPacketLoss', e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="ml-2 text-sm text-gray-700">Packet Loss</span>
        </label>
        <span className="text-gray-300">|</span>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showMedianLine}
            onChange={(e) => setPreference('showMedianLine', e.target.checked)}
            className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
          />
          <span className="ml-2 text-sm text-gray-700">Median</span>
        </label>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showMinLine}
            onChange={(e) => setPreference('showMinLine', e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="ml-2 text-sm text-gray-700">Min</span>
        </label>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showMaxLine}
            onChange={(e) => setPreference('showMaxLine', e.target.checked)}
            className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
          />
          <span className="ml-2 text-sm text-gray-700">Max</span>
        </label>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showAvgLine}
            onChange={(e) => setPreference('showAvgLine', e.target.checked)}
            className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
          />
          <span className="ml-2 text-sm text-gray-700">Avg</span>
        </label>
      </div>
      <svg
        ref={svgRef}
        className="w-full h-auto"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}

