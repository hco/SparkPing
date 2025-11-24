import { PingChart } from './PingChart';
import type { PingDataResponse, PingAggregatedResponse } from '../types';

interface ChartGridProps {
  data: PingDataResponse | null;
  aggregatedData: PingAggregatedResponse | null;
  useAggregated: boolean;
  synchronizedYDomain: [number, number] | null;
}

export function ChartGrid({
  data,
  aggregatedData,
  useAggregated,
  synchronizedYDomain,
}: ChartGridProps) {
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
}

