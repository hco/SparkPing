import type * as d3 from 'd3';
import type { ChartDataPoint, ChartScales } from '../types';
import { getPacketLossColor } from '@/lib/chartColors';

interface RenderPacketLossOptions {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  scales: ChartScales;
  chartData: ChartDataPoint[];
  bucketInterval: number;
  chartHeight: number;
  barWidth: number;
}

interface PacketLossRegion {
  startX: number;
  endX: number;
  color: string;
}

export function renderPacketLoss({
  g,
  scales,
  chartData,
  bucketInterval,
  chartHeight,
  barWidth,
}: RenderPacketLossOptions): void {
  const { xScale } = scales;

  const packetLossGroup = g
    .insert('g', '.smoke-layer')
    .attr('class', 'packet-loss-layer')
    .attr('clip-path', 'url(#chart-clip)');

  // Calculate half bucket width in pixels for boundaries
  const halfBucketWidth = bucketInterval > 0
    ? (xScale(bucketInterval) - xScale(0)) / 2
    : barWidth / 2;

  // Group consecutive buckets by packet loss color to draw continuous areas
  const regions: PacketLossRegion[] = [];
  let currentRegion: PacketLossRegion | null = null;

  chartData.forEach((point, i) => {
    const hasData = point.count > 0;
    const color = hasData ? getPacketLossColor(point.packetLossPercent) : null;
    const x = xScale(point.timestamp);

    const prevPoint = chartData[i - 1];
    const nextPoint = chartData[i + 1];

    // Check for gaps (time difference > 2x expected interval)
    const hasGapBefore = prevPoint && bucketInterval > 0
      ? (point.timestamp - prevPoint.timestamp) > bucketInterval * 2
      : true;
    const hasGapAfter = nextPoint && bucketInterval > 0
      ? (nextPoint.timestamp - point.timestamp) > bucketInterval * 2
      : true;

    // Calculate boundaries
    const bucketStartX = hasGapBefore
      ? x - halfBucketWidth
      : (xScale(prevPoint!.timestamp) + x) / 2;
    const bucketEndX = hasGapAfter
      ? x + halfBucketWidth
      : (x + xScale(nextPoint!.timestamp)) / 2;

    if (hasData && color) {
      const canExtend = currentRegion
        && currentRegion.color === color
        && !hasGapBefore;

      if (canExtend) {
        currentRegion!.endX = bucketEndX;
      } else {
        if (currentRegion) {
          regions.push(currentRegion);
        }
        currentRegion = {
          startX: bucketStartX,
          endX: bucketEndX,
          color,
        };
      }
    } else {
      if (currentRegion) {
        regions.push(currentRegion);
        currentRegion = null;
      }
    }
  });

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


