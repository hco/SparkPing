import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent } from '@/components/ui/card';
import { chartColorClasses, getPacketLossClass } from '@/lib/chartColors';
import type { TargetStats } from '@/hooks/useTargetStats';

interface TargetStatsBarProps {
  stats: TargetStats;
  dataTimeRange?: { earliest: number; latest: number };
}

/**
 * Displays target statistics including latency percentiles and packet loss metrics.
 * 
 * Extracted from the target details route to encapsulate the statistics display
 * with educational tooltips explaining percentile meanings to users. This component
 * provides a consistent way to show target performance metrics across different views.
 * 
 * @param stats - Calculated statistics for the target
 * @param dataTimeRange - Optional time range metadata to display
 */
export function TargetStatsBar({ stats, dataTimeRange }: TargetStatsBarProps) {
  return (
    <Card className="py-3">
      <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <span className="font-semibold text-foreground">Latency:</span>
        <span>
          <span className="text-muted-foreground">Avg</span>{' '}
          <span className={`font-medium ${chartColorClasses.avg}`}>{stats.mean.toFixed(1)}ms</span>
        </span>
        <span>
          <span className="text-muted-foreground">Min</span>{' '}
          <span className={`font-medium ${chartColorClasses.min}`}>
            {stats.min !== null ? `${stats.min.toFixed(1)}ms` : '—'}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Max</span>{' '}
          <span className={`font-medium ${chartColorClasses.max}`}>
            {stats.max !== null ? `${stats.max.toFixed(1)}ms` : '—'}
          </span>
        </span>
        <span className="text-border">|</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <span className="text-muted-foreground border-b border-dotted border-muted-foreground">P50</span>{' '}
              <span className="font-light">{stats.p50.toFixed(1)}ms</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>50th percentile (median): Half of all pings were faster than this</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <span className="text-muted-foreground border-b border-dotted border-muted-foreground">P75</span>{' '}
              <span className="font-light">{stats.p75.toFixed(1)}ms</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>75th percentile: 75% of pings were faster than this</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <span className="text-muted-foreground border-b border-dotted border-muted-foreground">P95</span>{' '}
              <span className="font-light">{stats.p95.toFixed(1)}ms</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>95th percentile: 95% of pings were faster than this</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <span className="text-muted-foreground border-b border-dotted border-muted-foreground">P99</span>{' '}
              <span className="font-light">{stats.p99.toFixed(1)}ms</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>99th percentile: 99% of pings were faster than this (worst-case latency)</TooltipContent>
        </Tooltip>
        <span className="text-border">|</span>
        <span className="font-semibold text-foreground">Packets:</span>
        <span>
          <span className="text-muted-foreground">Total</span> <span className="font-medium">{stats.totalPings.toLocaleString()}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Loss</span>{' '}
          <span className={`font-medium ${getPacketLossClass(stats.packetLoss)}`}>
            {stats.packetLoss.toFixed(2)}%
          </span>
        </span>
        {dataTimeRange && (
          <>
            <span className="text-border">|</span>
            <span className="text-muted-foreground">
              {new Date(dataTimeRange.earliest * 1000).toLocaleString()} —{' '}
              {new Date(dataTimeRange.latest * 1000).toLocaleString()}
            </span>
          </>
        )}
      </CardContent>
    </Card>
  );
}

