import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useUserPreferences } from '../../../hooks/useUserPreferences';
import type { D3SmokeChartProps, ChartVisibilityOptions, ChartMargin } from './types';
import {
  prepareChartData,
  filterValidLatencyData,
  calculateBucketInterval,
  calculateChartStats,
} from './utils';
import {
  renderSmokeBars,
  renderPacketLoss,
  renderMedianLine,
  renderStatLine,
  renderGrid,
  renderAxes,
  renderStatsPanel,
  renderLegend,
  setupTooltip,
} from './layers';
import { ChartControls } from './ChartControls';
import { chartColors } from '../../../lib/chartColors';

const DEFAULT_MARGIN: ChartMargin = { top: 40, right: 150, bottom: 80, left: 80 };

export function D3SmokeChart({
  data,
  width,
  height = 500,
  margin = DEFAULT_MARGIN,
}: D3SmokeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: width || 800, height });
  const { preferences, setPreference } = useUserPreferences();

  const visibility: ChartVisibilityOptions = useMemo(() => ({
    showMedianLine: preferences.showMedianLine,
    showMinLine: preferences.showMinLine,
    showMaxLine: preferences.showMaxLine,
    showAvgLine: preferences.showAvgLine,
    showSmokeBars: preferences.showSmokeBars,
    showPacketLoss: preferences.showPacketLoss,
  }), [
    preferences.showMedianLine,
    preferences.showMinLine,
    preferences.showMaxLine,
    preferences.showAvgLine,
    preferences.showSmokeBars,
    preferences.showPacketLoss,
  ]);

  // Handle container resizing
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

  // Main chart rendering effect
  useEffect(() => {
    if (!svgRef.current || data.length === 0 || dimensions.width === 0) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    // Prepare data
    const chartData = prepareChartData(data);
    const validLatencyData = filterValidLatencyData(chartData);
    const bucketInterval = calculateBucketInterval(chartData);

    // Calculate dimensions
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

    const defs = svg.append('defs');

    // Create scales
    const timeExtent = d3.extent(chartData, (d) => d.timestamp) as [number, number];
    const xScale = d3.scaleTime().domain(timeExtent).range([0, innerWidth]);

    const latencyMax = d3.max(validLatencyData, (d) => d.max!) || 100;
    const yScale = d3
      .scaleLinear()
      .domain([0, latencyMax * 1.15])
      .nice()
      .range([chartHeight, 0]);

    const scales = { xScale, yScale };

    // Calculate bar width
    const barWidth = Math.max(
      2,
      Math.min(Math.max(4, (innerWidth / chartData.length) * 0.8), 30)
    );

    // Render layers in order
    if (visibility.showSmokeBars) {
      renderSmokeBars({
        g,
        defs,
        scales,
        validLatencyData,
        bucketInterval,
        innerWidth,
        chartHeight,
        barWidth,
      });
    }

    if (visibility.showPacketLoss) {
      renderPacketLoss({
        g,
        scales,
        chartData,
        bucketInterval,
        chartHeight,
        barWidth,
      });
    }

    if (visibility.showMedianLine && validLatencyData.length > 0) {
      renderMedianLine({
        g,
        scales,
        validLatencyData,
        bucketInterval,
      });
    }

    if (visibility.showMinLine && validLatencyData.length > 0) {
      renderStatLine({
        g,
        scales,
        dataPoints: validLatencyData,
        getValue: (d) => d.min,
        color: chartColors.min,
        className: 'min-line',
        bucketInterval,
      });
    }

    if (visibility.showMaxLine && validLatencyData.length > 0) {
      renderStatLine({
        g,
        scales,
        dataPoints: validLatencyData,
        getValue: (d) => d.max,
        color: chartColors.max,
        className: 'max-line',
        bucketInterval,
      });
    }

    if (visibility.showAvgLine && validLatencyData.length > 0) {
      renderStatLine({
        g,
        scales,
        dataPoints: validLatencyData,
        getValue: (d) => d.avg,
        color: chartColors.avg,
        className: 'avg-line',
        bucketInterval,
      });
    }

    renderGrid({ g, scales, innerWidth });
    renderAxes({ g, scales, chartHeight, margin, timeExtent });

    // Calculate and render statistics
    const stats = calculateChartStats(chartData, validLatencyData);
    renderStatsPanel({ g, stats, innerWidth });

    renderLegend({ g, chartHeight, visibility });

    // Setup tooltip
    const { cleanup } = setupTooltip({
      g,
      scales,
      chartData,
      chartHeight,
      innerWidth,
    });

    return cleanup;
  }, [data, dimensions.width, dimensions.height, margin, visibility]);

  const handleToggle = (key: keyof ChartVisibilityOptions, value: boolean) => {
    setPreference(key, value);
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg">
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <ChartControls visibility={visibility} onToggle={handleToggle} />
      <svg
        ref={svgRef}
        className="w-full h-auto"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}

