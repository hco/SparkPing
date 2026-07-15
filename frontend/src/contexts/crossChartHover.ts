import { createContext, useContext, useEffect, useRef } from 'react';

export type HoverListener = (timestamp: number | null, sourceId: string | null) => void;

export interface CrossChartHoverContextValue {
  /** Subscribe to hover changes. Returns unsubscribe function. */
  subscribe: (listener: HoverListener) => () => void;
  /** Publish a hover change (no React state — just notifies subscribers). */
  setHover: (timestamp: number | null, sourceId: string | null) => void;
}

export const CrossChartHoverContext = createContext<CrossChartHoverContextValue>({
  subscribe: () => () => {},
  setHover: () => {},
});

/**
 * Subscribe to cross-chart hover events without causing React re-renders.
 * The callback is invoked directly (outside React's render cycle).
 */
export function useCrossChartHover(
  sourceId: string,
  onCrosshairChange: (timestamp: number | null) => void
) {
  const { subscribe, setHover } = useContext(CrossChartHoverContext);
  const callbackRef = useRef(onCrosshairChange);

  useEffect(() => {
    callbackRef.current = onCrosshairChange;
  });

  useEffect(() => {
    return subscribe((timestamp, hoveredSourceId) => {
      // Only forward crosshair to OTHER charts, not the source
      if (hoveredSourceId !== sourceId) {
        callbackRef.current(timestamp);
      }
    });
  }, [subscribe, sourceId]);

  return setHover;
}
