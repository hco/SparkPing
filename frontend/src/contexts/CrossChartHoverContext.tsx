import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface CrossChartHoverContextValue {
  hoverTimestamp: number | null;
  /** Source chart ID that is currently being hovered */
  hoverSourceId: string | null;
  setHover: (timestamp: number | null, sourceId: string | null) => void;
}

const CrossChartHoverContext = createContext<CrossChartHoverContextValue>({
  hoverTimestamp: null,
  hoverSourceId: null,
  setHover: () => {},
});

export function CrossChartHoverProvider({ children }: { children: ReactNode }) {
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const [hoverSourceId, setHoverSourceId] = useState<string | null>(null);

  const setHover = useCallback((timestamp: number | null, sourceId: string | null) => {
    setHoverTimestamp(timestamp);
    setHoverSourceId(sourceId);
  }, []);

  return (
    <CrossChartHoverContext.Provider value={{ hoverTimestamp, hoverSourceId, setHover }}>
      {children}
    </CrossChartHoverContext.Provider>
  );
}

export function useCrossChartHover() {
  return useContext(CrossChartHoverContext);
}
