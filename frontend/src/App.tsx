import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchPingData, fetchPingAggregated } from './api';
import { PingChart } from './components/PingChart';
import { Statistics } from './components/Statistics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PingDataResponse, PingDataQuery, PingAggregatedResponse, PingAggregatedQuery } from './types';
import './App.css';

function App() {
  const [data, setData] = useState<PingDataResponse | null>(null);
  const [aggregatedData, setAggregatedData] = useState<PingAggregatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useAggregated, setUseAggregated] = useState(true); // Use aggregated by default
  const [bucketDuration, setBucketDuration] = useState('1m'); // Default bucket duration
  const [timeRange, setTimeRange] = useState('all'); // Default to 'all' to show all available data
  // Initialize query without time filter to fetch all available data
  const [query, setQuery] = useState<PingDataQuery>(() => {
    return {
      // No 'from' parameter - backend will return all available data
    };
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5); // seconds
  const [synchronizeYAxis, setSynchronizeYAxis] = useState(false);

  // Helper function to calculate time range in seconds
  const getTimeRangeSeconds = (range: string): number | null => {
    switch (range) {
      case '1h': return 60 * 60;
      case '6h': return 6 * 60 * 60;
      case '12h': return 12 * 60 * 60;
      case '24h': return 24 * 60 * 60;
      case '7d': return 7 * 24 * 60 * 60;
      case '30d': return 30 * 24 * 60 * 60;
      case 'all': return null;
      default: return 24 * 60 * 60; // Default to 24h
    }
  };

  // Update query when time range changes
  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
    const seconds = getTimeRangeSeconds(range);
    const now = Math.floor(Date.now() / 1000);
    setQuery((prev) => ({
      ...prev,
      from: seconds !== null ? now - seconds : undefined,
      to: undefined,
    }));
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (useAggregated) {
        console.log('Loading aggregated data with query:', query, 'bucket:', bucketDuration);
        const aggregatedQuery: PingAggregatedQuery = {
          from: query.from,
          to: query.to,
          bucket: bucketDuration,
        };
        const response = await fetchPingAggregated(aggregatedQuery);
        console.log('Received aggregated response:', response);
        console.log('Buckets:', response.data.length);
        setAggregatedData(response);
        setData(null); // Clear raw data when using aggregated
      } else {
        console.log('Loading raw data with query:', query);
        const response = await fetchPingData(query);
        console.log('Received response:', response);
        console.log('Data points:', response.data.length);
        setData(response);
        setAggregatedData(null); // Clear aggregated data when using raw
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      console.error('Error fetching ping data:', err);
    } finally {
      setLoading(false);
    }
  }, [query, useAggregated, bucketDuration]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // Update query to maintain rolling time window when auto-refreshing
      const now = Math.floor(Date.now() / 1000);
      const seconds = getTimeRangeSeconds(timeRange);
      if (seconds !== null) {
        setQuery((prev) => ({
          ...prev,
          from: now - seconds,
        }));
        // loadData will be called automatically when query changes
      } else {
        // For 'all' time range, query doesn't change, so call loadData directly
        loadData();
      }
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, timeRange, loadData]);

  const handleLimitChange = (limit: string) => {
    setQuery((prev) => ({
      ...prev,
      limit: limit ? parseInt(limit, 10) : undefined,
    }));
  };

  // Calculate statistics from aggregated data
  const aggregatedStatistics = useMemo(() => {
    if (!aggregatedData || aggregatedData.data.length === 0) return null;
    
    let totalSuccessful = 0;
    let totalFailed = 0;
    const latencies: number[] = [];
    
    aggregatedData.data.forEach(bucket => {
      totalSuccessful += bucket.successful_count;
      totalFailed += bucket.failed_count;
      
      // Collect latency values for min/max/avg calculation
      if (bucket.min !== null) latencies.push(bucket.min);
      if (bucket.max !== null) latencies.push(bucket.max);
      // For avg, we could use bucket.avg, but let's use min/max for consistency
      // Actually, let's calculate weighted average using bucket avg and count
    });
    
    const totalCount = totalSuccessful + totalFailed;
    const successRate = totalCount > 0 ? (totalSuccessful / totalCount) * 100 : 0;
    
    // Calculate weighted average latency from bucket averages
    let weightedSum = 0;
    let totalWeight = 0;
    aggregatedData.data.forEach(bucket => {
      if (bucket.avg !== null && bucket.count > 0) {
        weightedSum += bucket.avg * bucket.count;
        totalWeight += bucket.count;
      }
    });
    const avgLatency = totalWeight > 0 ? weightedSum / totalWeight : null;
    
    // Get min and max from all buckets
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : null;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;
    
    return {
      successful_count: totalSuccessful,
      failed_count: totalFailed,
      avg_latency_ms: avgLatency,
      min_latency_ms: minLatency,
      max_latency_ms: maxLatency,
      success_rate: successRate,
    };
  }, [aggregatedData]);

  // Calculate synchronized Y-axis domain if enabled
  const synchronizedYDomain = useMemo(() => {
    if (!synchronizeYAxis) return null;
    
    const allLatencies: number[] = [];
    
    if (useAggregated && aggregatedData) {
      aggregatedData.data.forEach(bucket => {
        if (bucket.avg !== null) allLatencies.push(bucket.avg);
        if (bucket.min !== null) allLatencies.push(bucket.min);
        if (bucket.max !== null) allLatencies.push(bucket.max);
      });
    } else if (data) {
      // For raw data, we need to calculate min/max/avg per timestamp
      const grouped = new Map<number, typeof data.data>();
      data.data.forEach(point => {
        const key = point.timestamp_unix;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(point);
      });
      
      grouped.forEach(points => {
        const successful = points.filter(p => p.success);
        if (successful.length > 0) {
          const latencies = successful.map(p => p.latency_ms || 0);
          allLatencies.push(...latencies);
        }
      });
    }
    
    if (allLatencies.length === 0) return null;
    
    const maxLatency = Math.max(...allLatencies);
    return [0, maxLatency + 10] as [number, number];
  }, [synchronizeYAxis, useAggregated, aggregatedData, data]);

  return (
    <div className="min-h-screen bg-gray-100 w-screen">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">SparkPing Dashboard</h1>
          <p className="text-gray-600">Real-time ping monitoring and visualization</p>
        </header>

        {/* Filters */}
        <div className="bg-card p-6 rounded-lg border shadow-sm mb-6">
          <h2 className="text-xl font-semibold mb-6">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-2">
              <Label htmlFor="time-range">Time Range</Label>
              <Select value={timeRange} onValueChange={handleTimeRangeChange}>
                <SelectTrigger id="time-range">
                  <SelectValue placeholder="Select time range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">Last 1 Hour</SelectItem>
                  <SelectItem value="6h">Last 6 Hours</SelectItem>
                  <SelectItem value="12h">Last 12 Hours</SelectItem>
                  <SelectItem value="24h">Last 24 Hours</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-mode">Data Mode</Label>
              <Select 
                value={useAggregated ? 'aggregated' : 'raw'} 
                onValueChange={(value: string) => setUseAggregated(value === 'aggregated')}
              >
                <SelectTrigger id="data-mode">
                  <SelectValue placeholder="Select data mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aggregated">Aggregated (Buckets)</SelectItem>
                  <SelectItem value="raw">Raw Data</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {useAggregated && (
              <div className="space-y-2">
                <Label htmlFor="bucket-duration">Bucket Duration</Label>
                <Input
                  id="bucket-duration"
                  type="text"
                  placeholder="1m"
                  value={bucketDuration}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBucketDuration(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">e.g., 5m, 1h, 30s, 2d</p>
              </div>
            )}
            {!useAggregated && (
              <div className="space-y-2">
                <Label htmlFor="limit">Limit Results</Label>
                <Input
                  id="limit"
                  type="number"
                  placeholder="No limit"
                  min="1"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleLimitChange(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Auto Refresh</Label>
              <div className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto-refresh"
                    checked={autoRefresh}
                    onCheckedChange={(checked: boolean) => setAutoRefresh(checked === true)}
                  />
                  <Label htmlFor="auto-refresh" className="text-sm font-normal cursor-pointer">
                    Enabled
                  </Label>
                </div>
                {autoRefresh && (
                  <>
                    <Input
                      type="number"
                      value={refreshInterval}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRefreshInterval(parseInt(e.target.value, 10) || 5)}
                      min="1"
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">seconds</span>
                  </>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Chart Options</Label>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="synchronize-y-axis"
                  checked={synchronizeYAxis}
                  onCheckedChange={(checked: boolean) => setSynchronizeYAxis(checked === true)}
                />
                <Label htmlFor="synchronize-y-axis" className="text-sm font-normal cursor-pointer">
                  Synchronize Y-Axis
                </Label>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <Button
              onClick={loadData}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Refresh Now'}
            </Button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Statistics */}
        {data && <Statistics statistics={data.statistics} />}
        {aggregatedData && aggregatedStatistics && <Statistics statistics={aggregatedStatistics} />}

        {/* Charts - One per target */}
        {loading && !data && !aggregatedData ? (
          <div className="flex items-center justify-center h-64 bg-white rounded-lg shadow">
            <div className="text-gray-500">Loading data...</div>
          </div>
        ) : (useAggregated && aggregatedData && aggregatedData.data.length > 0) || (!useAggregated && data && data.data.length > 0) ? (
          (() => {
            // Extract unique targets
            const targets = useAggregated && aggregatedData
              ? Array.from(new Set(aggregatedData.data.map(b => b.target)))
              : Array.from(new Set((data?.data || []).map(p => p.target)));
            
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {targets.map((target) => {
                  // Get target name for display
                  const targetName = useAggregated && aggregatedData
                    ? aggregatedData.data.find(b => b.target === target)?.target_name
                    : data?.data.find(p => p.target === target)?.target_name;
                  
                  const displayName = targetName || target;
                  
                  return (
                    <div key={target} className="bg-white p-6 rounded-lg shadow w-full">
                      <PingChart
                        data={data?.data || []}
                        bucketData={aggregatedData?.data}
                        target={target}
                        targetName={targetName}
                        isAggregated={useAggregated}
                        synchronizedYDomain={synchronizedYDomain}
                      />
                      <div className="mt-4 text-sm text-gray-600">
                        {useAggregated && aggregatedData ? (
                          <>
                            Showing {aggregatedData.data.filter(b => b.target === target).length} buckets for {displayName}
                            {aggregatedData.bucket_duration_seconds && (
                              <> (bucket size: {aggregatedData.bucket_duration_seconds}s)</>
                            )}
                            {aggregatedData.query.data_time_range && (
                              <>
                                {' '}
                                from{' '}
                                {new Date(
                                  aggregatedData.query.data_time_range.earliest * 1000
                                ).toLocaleString()}{' '}
                                to{' '}
                                {new Date(
                                  aggregatedData.query.data_time_range.latest * 1000
                                ).toLocaleString()}
                              </>
                            )}
                          </>
                        ) : data ? (
                          <>
                            Showing {data.data.filter(p => p.target === target).length} data points for {displayName}
                            {data.query.data_time_range && (
                              <>
                                {' '}
                                from{' '}
                                {new Date(
                                  data.query.data_time_range.earliest * 1000
                                ).toLocaleString()}{' '}
                                to{' '}
                                {new Date(
                                  data.query.data_time_range.latest * 1000
                                ).toLocaleString()}
                              </>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : (useAggregated && aggregatedData && aggregatedData.data.length === 0) || (!useAggregated && data && data.data.length === 0) ? (
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-center text-gray-500 p-6">
              <p className="mb-2">No data available for the selected filters.</p>
              {query.from && (
                <p className="text-sm mb-2">
                  Querying from: {new Date(query.from * 1000).toLocaleString()}
                  {query.to && ` to: ${new Date(query.to * 1000).toLocaleString()}`}
                </p>
              )}
              <Button
                onClick={() => {
                  setTimeRange('all');
                  setQuery((prev) => {
                    const { from, to, ...rest } = prev;
                    return rest;
                  });
                }}
                className="mt-4"
              >
                Clear Time Filter (Show All Data)
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;
