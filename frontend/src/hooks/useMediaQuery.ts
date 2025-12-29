import { useSyncExternalStore, useCallback } from 'react';

/**
 * Hook to detect if a media query matches.
 * Common breakpoints (Tailwind CSS):
 * - sm: 640px
 * - md: 768px
 * - lg: 1024px
 * - xl: 1280px
 * - 2xl: 1536px
 *
 * @param query - CSS media query string (e.g., "(min-width: 640px)")
 * @returns boolean indicating if the query matches
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener('change', callback);
      return () => mediaQuery.removeEventListener('change', callback);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => {
    // Default to false on server
    return false;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Convenience hook for checking if viewport is at least `sm` (640px)
 */
export function useIsSmScreen(): boolean {
  return useMediaQuery('(min-width: 640px)');
}

/**
 * Convenience hook for checking if viewport is at least `md` (768px)
 */
export function useIsMdScreen(): boolean {
  return useMediaQuery('(min-width: 768px)');
}

/**
 * Convenience hook for checking if viewport is at least `lg` (1024px)
 */
export function useIsLgScreen(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/**
 * Convenience hook for checking if device prefers touch input
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
