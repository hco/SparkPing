import { useMemo, useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  showArea?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = '#3b82f6',
  fillColor,
  showArea = true,
  className = '',
}: SparklineProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { path, areaPath } = useMemo(() => {
    if (data.length < 2) return { path: '', areaPath: '' };

    const validData = data.filter((d) => d !== null && !isNaN(d));
    if (validData.length < 2) return { path: '', areaPath: '' };

    const minVal = Math.min(...validData);
    const maxVal = Math.max(...validData);
    const padding = (maxVal - minVal) * 0.1 || 1;
    const yDomain: [number, number] = [Math.max(0, minVal - padding), maxVal + padding];

    const xScale = d3.scaleLinear().domain([0, data.length - 1]).range([2, width - 2]);
    const yScale = d3.scaleLinear().domain(yDomain).range([height - 2, 2]);

    const line = d3
      .line<number>()
      .defined((d) => d !== null && !isNaN(d))
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    const area = d3
      .area<number>()
      .defined((d) => d !== null && !isNaN(d))
      .x((_, i) => xScale(i))
      .y0(height - 2)
      .y1((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    return {
      path: line(data) || '',
      areaPath: area(data) || '',
    };
  }, [data, width, height]);

  // Add a subtle gradient
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    
    // Create gradient if it doesn't exist
    let defs = svg.select<SVGDefsElement>('defs');
    if (defs.empty()) {
      defs = svg.append<SVGDefsElement>('defs');
    }
    
    const gradientId = `sparkline-gradient-${color.replace('#', '')}`;
    let gradient = defs.select<SVGLinearGradientElement>(`#${gradientId}`);
    if (gradient.empty()) {
      gradient = defs.append<SVGLinearGradientElement>('linearGradient')
        .attr('id', gradientId)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');
      
      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', fillColor || color)
        .attr('stop-opacity', 0.3);
      
      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', fillColor || color)
        .attr('stop-opacity', 0.05);
    }
  }, [color, fillColor]);

  if (data.length < 2) {
    return (
      <div 
        className={`flex items-center justify-center text-gray-400 text-xs ${className}`}
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  const gradientId = `sparkline-gradient-${color.replace('#', '')}`;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {showArea && areaPath && (
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
        />
      )}
      {path && (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

interface PacketLossSparklineProps {
  data: number[]; // packet loss percentages
  width?: number;
  height?: number;
  className?: string;
}

export function PacketLossSparkline({
  data,
  width = 120,
  height = 24,
  className = '',
}: PacketLossSparklineProps) {
  const barWidth = Math.max(1, (width - 4) / data.length - 0.5);

  const getColor = (value: number): string => {
    if (value === 0) return '#22c55e'; // green
    if (value <= 5) return '#eab308'; // yellow
    if (value <= 20) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  if (data.length === 0) {
    return (
      <div 
        className={`flex items-center justify-center text-gray-400 text-xs ${className}`}
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className={className}
    >
      {data.map((value, i) => {
        const barHeight = Math.max(2, (value / 100) * (height - 4));
        const x = 2 + i * (barWidth + 0.5);
        const y = height - 2 - barHeight;
        
        return (
          <rect
            key={i}
            x={x}
            y={value === 0 ? height - 4 : y}
            width={barWidth}
            height={value === 0 ? 2 : barHeight}
            fill={getColor(value)}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

