import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import type { PingDataPoint, BucketDataPoint } from '../types';

interface PingChartProps {
  data: PingDataPoint[];
  bucketData?: BucketDataPoint[];
  target?: string;
  targetName?: string | null;
  isAggregated?: boolean;
  synchronizedYDomain?: [number, number] | null;
}

export function PingChart({ data, bucketData, target, targetName, isAggregated, synchronizedYDomain }: PingChartProps) {
  // Prepare chart data - use aggregated bucket data if available, otherwise aggregate from raw data
  const chartData = useMemo(() => {
    // If we have bucket data (from aggregated endpoint), filter by target if specified
    if (isAggregated && bucketData && bucketData.length > 0) {
      const filteredBuckets = target 
        ? bucketData.filter(b => b.target === target)
        : bucketData;
      
      return filteredBuckets.map((bucket) => {
        const total = bucket.count;
        const packetLossPercent = total > 0 
          ? Number(((bucket.failed_count / total) * 100).toFixed(2))
          : 0;
        
        return {
          timestamp: bucket.timestamp_unix,
          timestampFormatted: format(new Date(bucket.timestamp_unix * 1000), 'HH:mm:ss'),
          avgLatency: bucket.avg !== null ? Number(bucket.avg.toFixed(2)) : null,
          minLatency: bucket.min !== null ? Number(bucket.min.toFixed(2)) : null,
          maxLatency: bucket.max !== null ? Number(bucket.max.toFixed(2)) : null,
          successCount: bucket.successful_count,
          failCount: bucket.failed_count,
          totalCount: bucket.count,
          packetLossPercent,
        };
      });
    }

    // Otherwise, group raw data points by timestamp and calculate averages
    // Filter by target if specified
    const filteredData = target 
      ? data.filter(p => p.target === target)
      : data;
    
    const grouped = new Map<number, PingDataPoint[]>();
    
    filteredData.forEach((point) => {
      const key = point.timestamp_unix;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(point);
    });

    // Convert to array and calculate averages
    return Array.from(grouped.entries())
      .map(([timestamp, points]) => {
        const successful = points.filter((p) => p.success);
        const failed = points.filter((p) => !p.success);
        
        const avgLatency = successful.length > 0
          ? successful.reduce((sum, p) => sum + (p.latency_ms || 0), 0) / successful.length
          : null;
        
        const minLatency = successful.length > 0
          ? Math.min(...successful.map((p) => p.latency_ms || Infinity))
          : null;
        
        const maxLatency = successful.length > 0
          ? Math.max(...successful.map((p) => p.latency_ms || 0))
          : null;

        const total = points.length;
        const packetLossPercent = total > 0 
          ? Number(((failed.length / total) * 100).toFixed(2))
          : 0;

        return {
          timestamp,
          timestampFormatted: format(new Date(timestamp * 1000), 'HH:mm:ss'),
          avgLatency: avgLatency !== null ? Number(avgLatency.toFixed(2)) : null,
          minLatency: minLatency !== null && minLatency !== Infinity ? Number(minLatency.toFixed(2)) : null,
          maxLatency: maxLatency !== null ? Number(maxLatency.toFixed(2)) : null,
          successCount: successful.length,
          failCount: failed.length,
          totalCount: points.length,
          packetLossPercent,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [data, bucketData, isAggregated, target]);

  // Get browser's preferred locale, fallback to 'en-US'
  const locale = typeof navigator !== 'undefined' && navigator.language 
    ? navigator.language 
    : 'en-US';

  // Number formatters using browser locale
  const integerFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });

  const latencyFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const percentageValueFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const latencyAxisFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
          <p className="font-semibold">{data.timestampFormatted}</p>
          {data.avgLatency !== null && (
            <>
              <p className="text-blue-500">Avg Latency: {latencyFormatter.format(data.avgLatency)} ms</p>
              {data.minLatency !== null && (
                <p className="text-blue-400">Min: {latencyFormatter.format(data.minLatency)} ms</p>
              )}
              {data.maxLatency !== null && (
                <p className="text-blue-600">Max: {latencyFormatter.format(data.maxLatency)} ms</p>
              )}
            </>
          )}
          <p className="text-gray-600">Success: {integerFormatter.format(data.successCount)}</p>
          {data.failCount > 0 && (
            <p className="text-red-600">Failed: {integerFormatter.format(data.failCount)}</p>
          )}
          <p className="text-red-600 font-semibold">
            Packet Loss: {percentageValueFormatter.format(data.packetLossPercent)}%
          </p>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg">
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  // Calculate Y-axis domain - use synchronized domain if provided, otherwise calculate own
  const yDomain = useMemo(() => {
    if (synchronizedYDomain) {
      return synchronizedYDomain;
    }
    
    const allLatencies = chartData
      .flatMap(d => [d.avgLatency, d.minLatency, d.maxLatency])
      .filter((v): v is number => v !== null && v !== undefined);
    
    return allLatencies.length > 0 
      ? [0, Math.max(...allLatencies) + 10]
      : [0, 100];
  }, [chartData, synchronizedYDomain]);
  
    const displayTarget = targetName || target || 'All Targets';  
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-2">{displayTarget}</h2>
    
      <ResponsiveContainer width="100%" aspect={1.618} height={500}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 50, left: 20, bottom: 80 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestampFormatted"
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis 
            yAxisId="latency"
            domain={yDomain}
            label={{ value: 'Latency (ms)', angle: -90, position: 'insideLeft' }}
            tickFormatter={(value) => latencyAxisFormatter.format(value)}
          />
          <YAxis 
            yAxisId="packetLoss"
            orientation="right"
            domain={[0, 100]}
            label={{ value: 'Packet Loss (%)', angle: 90, position: 'insideRight' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Area
            yAxisId="packetLoss"
            type="monotone"
            dataKey="packetLossPercent"
            fill="#ef4444"
            fillOpacity={0.3}
            stroke="#ef4444"
            strokeWidth={2}
            name="Packet Loss %"
          />
          <Line
            yAxisId="latency"
            type="monotone"
            dataKey="avgLatency"
            stroke="#3b82f6"
            strokeWidth={2}
            name="Average Latency"
            dot={false}
          />
          <Line
            yAxisId="latency"
            type="monotone"
            dataKey="minLatency"
            stroke="#60a5fa"
            strokeWidth={1}
            strokeDasharray="5 5"
            name="Min Latency"
            dot={false}
          />
          <Line
            yAxisId="latency"
            type="monotone"
            dataKey="maxLatency"
            stroke="#2563eb"
            strokeWidth={1}
            strokeDasharray="5 5"
            name="Max Latency"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
