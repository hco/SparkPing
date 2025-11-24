import { Button } from '@/components/ui/button';
import type { PingDataQuery } from '../types';

interface EmptyStateProps {
  query: PingDataQuery;
  onClearTimeFilter: () => void;
}

export function EmptyState({ query, onClearTimeFilter }: EmptyStateProps) {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="text-center text-gray-500 p-6">
        <p className="mb-2">No data available for the selected filters.</p>
        {query.from && typeof query.from === 'number' && (
          <p className="text-sm mb-2">
            Querying from: {new Date(query.from * 1000).toLocaleString()}
            {query.to && typeof query.to === 'number' && ` to: ${new Date(query.to * 1000).toLocaleString()}`}
          </p>
        )}
        <Button
          onClick={onClearTimeFilter}
          className="mt-4"
        >
          Clear Time Filter (Show All Data)
        </Button>
      </div>
    </div>
  );
}

