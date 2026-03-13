import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

type HoverListener = (timestamp: number | null, sourceId: string | null) => void;

interface CrossChartHoverContextValue {
  /** Subscribe to hover changes. Returns unsubscribe function. */
  subscribe: (listener: HoverListener) => () => void;
  /** Publish a hover change (no React state — just notifies subscribers). */
  setHover: (timestamp: number | null, sourceId: string | null) => void;
}

const CrossChartHoverContext = createContext<CrossChartHoverContextValue>({
  subscribe: () => () => {},
  setHover: () => {},
});

export function CrossChartHoverProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef<Set<HoverListener>>(new Set());

  const subscribe = useCallback((listener: HoverListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const setHover = useCallback((timestamp: number | null, sourceId: string | null) => {
    for (const listener of listenersRef.current) {
      listener(timestamp, sourceId);
    }
  }, []);

  return (
    <CrossChartHoverContext.Provider value={{ subscribe, setHover }}>
      {children}
    </CrossChartHoverContext.Provider>
  );
}

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
  callbackRef.current = onCrosshairChange;

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
