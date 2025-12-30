import { useCallback, useMemo } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import {
  type TimeRange,
  type TimeRangeSearchParams,
  searchParamsToTimeRange,
  timeRangeToSearchParams,
  timeRangeToApiQuery,
} from '@/utils/timeRangeUtils';

/**
 * Hook for managing time range search parameters in the URL.
 * 
 * Provides a unified interface for reading and updating time range
 * related URL parameters across any route that uses TimeRangeSearchParams.
 */
export function useTimeRangeSearch() {
  const router = useRouter();
  const routerState = useRouterState();
  
  // Get current search params from router state
  const searchParams = routerState.location.search as TimeRangeSearchParams;
  
  const { preset, from, to, bucket, refresh, interval } = searchParams;

  // Update search params in URL using router.navigate with current location
  const updateSearch = useCallback(
    (updates: Partial<TimeRangeSearchParams>) => {
      const currentSearch = router.state.location.search as TimeRangeSearchParams;
      router.navigate({
        to: '.',
        search: { ...currentSearch, ...updates },
        replace: false,
      });
    },
    [router]
  );

  // Convert URL params to TimeRange object
  const timeRange: TimeRange = useMemo(() => {
    return searchParamsToTimeRange({ preset, from, to });
  }, [preset, from, to]);

  // Handle time range changes (converts TimeRange to search params)
  const setTimeRange = useCallback(
    (range: TimeRange) => {
      updateSearch(timeRangeToSearchParams(range));
    },
    [updateSearch]
  );

  // Calculate time query for API
  const timeQuery = useMemo(() => {
    return timeRangeToApiQuery(timeRange);
  }, [timeRange]);

  // Auto-refresh controls
  const setAutoRefresh = useCallback(
    (enabled: boolean) => updateSearch({ refresh: enabled }),
    [updateSearch]
  );

  const setRefreshInterval = useCallback(
    (seconds: number) => updateSearch({ interval: seconds }),
    [updateSearch]
  );

  // Bucket/resolution controls
  const setBucket = useCallback(
    (value: string) => updateSearch({ bucket: value }),
    [updateSearch]
  );

  // Reset time filter to default
  const resetTimeFilter = useCallback(
    (defaultPreset: string = '30d') => {
      updateSearch({ preset: defaultPreset as TimeRangeSearchParams['preset'], from: undefined, to: undefined });
    },
    [updateSearch]
  );

  return {
    // Raw search params
    preset,
    from,
    to,
    bucket,
    refresh,
    interval,
    
    // Derived values
    timeRange,
    timeQuery,
    
    // Update functions
    updateSearch,
    setTimeRange,
    setAutoRefresh,
    setRefreshInterval,
    setBucket,
    resetTimeFilter,
  };
}

