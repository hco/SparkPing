import { useCallback, useMemo } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { FileRouteTypes } from '@/routeTree.gen';
import {
  type TimeRange,
  type TimeRangeSearchParams,
  searchParamsToTimeRange,
  timeRangeToSearchParams,
  timeRangeToApiQuery,
} from '@/utils/timeRangeUtils';

type UpdateSearchOptions = {
  replace?: boolean;
};

/**
 * Routes that support TimeRangeSearchParams.
 * This type is validated against the generated route tree.
 */
type TimeRangeRoutes = Extract<FileRouteTypes['fullPaths'], '/targets/$targetId'>;

/**
 * Hook for managing time range search parameters in the URL.
 *
 * Provides a unified interface for reading and updating time range
 * related URL parameters for routes that use TimeRangeSearchParams.
 *
 * @param routePath - The route path to bind to (must have TimeRangeSearchParams in validateSearch)
 */
export function useTimeRangeSearch(routePath: TimeRangeRoutes) {
  const routeApi = useMemo(() => getRouteApi(routePath), [routePath]);

  const searchParams = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  const { preset, from, to, bucket, refresh, interval } = searchParams;

  const updateSearch = useCallback(
    (updates: Partial<TimeRangeSearchParams>, { replace = false }: UpdateSearchOptions = {}) => {
      navigate({
        search: (prev) => ({ ...prev, ...updates }),
        replace,
      });
    },
    [navigate]
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
