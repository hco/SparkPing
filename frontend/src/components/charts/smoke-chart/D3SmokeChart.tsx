import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useUserPreferences } from '../../../hooks/useUserPreferences';
import { useTheme } from '../../../hooks/useTheme';
import type { D3SmokeChartProps, ChartVisibilityOptions, ChartMargin } from './types';
import {
  prepareChartData,
  filterValidLatencyData,
  calculateBucketInterval,
  calculateChartStats,
  calculateP99,
} from './utils';
import { renderSmokeBars } from './layers/renderSmokeBars';
import { renderPacketLoss } from './layers/renderPacketLoss';
import { renderStatLine, renderMedianLine } from './layers/renderStatLines';
import { renderGrid, renderAxes } from './layers/renderGridAndAxes';
import { renderStatsPanel } from './layers/renderStatsPanel';
import { renderLegend } from './layers/renderLegend';
import { setupTooltip } from './layers/renderTooltip';
import { ChartControls } from './ChartControls';
import { chartColors, getThemeColors } from '../../../lib/chartColors';

const STATS_PANEL_WIDTH = 150;
const MOBILE_BREAKPOINT = 480;

// Get responsive margins based on screen width
function getMargins(width: number, showStatsPanel: boolean): ChartMargin {
  const isMobile = width < MOBILE_BREAKPOINT;
  
  if (showStatsPanel) {
    return {
      top: isMobile ? 20 : 40,
      right: STATS_PANEL_WIDTH,
      bottom: isMobile ? 60 : 80,
      left: isMobile ? 45 : 80,
    };
  }
  
  return {
    top: isMobile ? 20 : 40,
    right: isMobile ? 10 : 20,
    bottom: isMobile ? 60 : 80,
    left: isMobile ? 45 : 80,
  };
}

export function D3SmokeChart({
  data,
  width,
  height = 500,
}: D3SmokeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: width || 800, height });
  const { preferences, setPreference } = useUserPreferences();
  const { isDark } = useTheme();
  const themeColors = useMemo(() => getThemeColors(isDark), [isDark]);

  const visibility: ChartVisibilityOptions = useMemo(() => ({
    showMedianLine: preferences.showMedianLine,
    showMinLine: preferences.showMinLine,
    showMaxLine: preferences.showMaxLine,
    showAvgLine: preferences.showAvgLine,
    showSmokeBars: preferences.showSmokeBars,
    showPacketLoss: preferences.showPacketLoss,
    showStatsPanel: preferences.showStatsPanel,
    clipToP99: preferences.clipToP99,
  }), [
    preferences.showMedianLine,
    preferences.showMinLine,
    preferences.showMaxLine,
    preferences.showAvgLine,
    preferences.showSmokeBars,
    preferences.showPacketLoss,
    preferences.showStatsPanel,
    preferences.clipToP99,
  ]);

  // Use dynamic margin based on stats panel visibility and screen width
  const effectiveMargin = useMemo(() => 
    getMargins(dimensions.width, visibility.showStatsPanel),
    [dimensions.width, visibility.showStatsPanel]
  );
  
  const isMobile = dimensions.width < MOBILE_BREAKPOINT;

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
    const innerWidth = dimensions.width - effectiveMargin.left - effectiveMargin.right;
    const innerHeight = dimensions.height - effectiveMargin.top - effectiveMargin.bottom;
    const chartHeight = innerHeight - 40; // Reserve space for packet loss bars

    // Create SVG
    const svg = d3
      .select(svgRef.current)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height);

    const g = svg
      .append('g')
      .attr('transform', `translate(${effectiveMargin.left},${effectiveMargin.top})`);

    const defs = svg.append('defs');

    // Create scales
    const timeExtent = d3.extent(chartData, (d) => d.timestamp) as [number, number];
    const xScale = d3.scaleTime().domain(timeExtent).range([0, innerWidth]);

    // Calculate the upper bound for the y-scale
    const absoluteMax = d3.max(validLatencyData, (d) => d.max!) || 100;
    const p99Value = calculateP99(validLatencyData);
    const latencyMax = visibility.clipToP99 && p99Value > 0 ? p99Value : absoluteMax;
    
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

    renderGrid({ g, scales, innerWidth, themeColors });
    renderAxes({ g, scales, chartHeight, margin: effectiveMargin, timeExtent, themeColors, isMobile });

    // Calculate and render statistics (conditionally)
    const stats = calculateChartStats(chartData, validLatencyData);
    if (visibility.showStatsPanel) {
      renderStatsPanel({ g, stats, innerWidth, themeColors });
    }

    renderLegend({ g, chartHeight, innerWidth, visibility, themeColors });

    // Setup tooltip
    const { cleanup } = setupTooltip({
      g,
      scales,
      chartData,
      chartHeight,
      innerWidth,
      themeColors,
    });

    return cleanup;
  }, [data, dimensions.width, dimensions.height, effectiveMargin, visibility, themeColors]);

  const handleToggle = (key: keyof ChartVisibilityOptions, value: boolean) => {
    setPreference(key, value);
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/50 rounded-lg">
        <p className="text-muted-foreground">No data available</p>
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

