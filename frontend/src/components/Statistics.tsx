import type { PingStatistics } from '../types';

interface StatisticsProps {
  statistics: PingStatistics;
}

// Get browser's preferred locale, fallback to 'en-US'
const getLocale = () => {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
};

export function Statistics({ statistics }: StatisticsProps) {
  const locale = getLocale();
  
  // Number formatters using browser locale
  const integerFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });

  const percentageFormatter = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const latencyFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-600">Successful</div>
        <div className="text-2xl font-bold text-green-600">
          {integerFormatter.format(statistics.successful_count)}
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-600">Failed</div>
        <div className="text-2xl font-bold text-red-600">
          {integerFormatter.format(statistics.failed_count)}
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-600">Success Rate</div>
        <div className="text-2xl font-bold">
          {percentageFormatter.format(statistics.success_rate / 100)}
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-600">Avg Latency</div>
        <div className="text-2xl font-bold text-blue-600">
          {statistics.avg_latency_ms !== null
            ? `${latencyFormatter.format(statistics.avg_latency_ms)} ms`
            : 'N/A'}
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-600">Min Latency</div>
        <div className="text-2xl font-bold text-green-600">
          {statistics.min_latency_ms !== null
            ? `${latencyFormatter.format(statistics.min_latency_ms)} ms`
            : 'N/A'}
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="text-sm text-gray-600">Max Latency</div>
        <div className="text-2xl font-bold text-red-600">
          {statistics.max_latency_ms !== null
            ? `${latencyFormatter.format(statistics.max_latency_ms)} ms`
            : 'N/A'}
        </div>
      </div>
    </div>
  );
}

