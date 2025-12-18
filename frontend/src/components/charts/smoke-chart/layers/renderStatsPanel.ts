import { format } from 'date-fns';
import type * as d3 from 'd3';
import type { ChartStats } from '../types';
import { getPacketLossColor } from '../utils';

interface RenderStatsPanelOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  stats: ChartStats;
  innerWidth: number;
}

export function renderStatsPanel({
  g,
  stats,
  innerWidth,
}: RenderStatsPanelOptions): void {
  const statsGroup = g
    .append('g')
    .attr('transform', `translate(${innerWidth + 15}, 0)`);

  const panelWidth = 120;
  const valueX = panelWidth - 5;

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

  // RTT stats
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

  // Packet Loss section
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
}

