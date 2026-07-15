import { useCallback, useRef, type ReactNode } from 'react';
import {
  CrossChartHoverContext,
  type HoverListener,
} from '@/contexts/crossChartHover';

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
