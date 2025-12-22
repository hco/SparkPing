import { useState, useCallback, useRef, useEffect } from 'react';
import type { DiscoveredDevice, DiscoveryEvent } from '@/types';
import { getBasePath } from '@/lib/basePath';

export type DiscoveryStatus = 'idle' | 'running' | 'error';

interface UseDeviceDiscoveryResult {
  /** List of discovered devices */
  devices: DiscoveredDevice[];
  /** Current status of discovery */
  status: DiscoveryStatus;
  /** Status message from the server */
  message: string | null;
  /** Start device discovery (runs indefinitely until stopped) */
  startDiscovery: () => void;
  /** Stop discovery */
  stopDiscovery: () => void;
  /** Clear discovered devices list */
  clearDevices: () => void;
  /** Whether discovery is currently running */
  isRunning: boolean;
}

/**
 * Hook for managing device discovery via SSE.
 * Discovery runs indefinitely until the user stops it or closes the page.
 */
export function useDeviceDiscovery(): UseDeviceDiscoveryResult {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const stopDiscovery = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (status === 'running') {
      setStatus('idle');
      setMessage('Discovery stopped');
    }
  }, [status]);

  const startDiscovery = useCallback(() => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear previous results
    setDevices([]);
    setMessage(null);
    setStatus('running');

    // Build the SSE URL (no duration - runs indefinitely)
    const basePath = getBasePath();
    const url = `${basePath}api/discovery/start`;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data: DiscoveryEvent = JSON.parse(event.data);

        switch (data.event_type) {
          case 'device_found':
            setDevices((prev) => {
              // Check if we already have this device (by address)
              const exists = prev.some((d) => d.address === data.device.address);
              if (exists) {
                return prev;
              }
              return [...prev, data.device];
            });
            break;

          case 'device_updated':
            setDevices((prev) => {
              // Update the existing device with new data
              return prev.map((d) =>
                d.address === data.device.address ? data.device : d
              );
            });
            break;

          case 'started':
            setMessage(data.message);
            setStatus('running');
            break;

          case 'completed':
            // Server-initiated completion (shouldn't happen with indefinite discovery)
            setMessage(data.message);
            setStatus('idle');
            eventSource.close();
            eventSourceRef.current = null;
            break;

          case 'error':
            setMessage(data.message);
            setStatus('error');
            eventSource.close();
            eventSourceRef.current = null;
            break;
        }
      } catch (e) {
        console.error('Failed to parse discovery event:', e);
      }
    };

    eventSource.onerror = () => {
      // Only set error if we were running - could be a normal close
      if (eventSourceRef.current) {
        setStatus('error');
        setMessage('Connection to discovery service lost');
        eventSource.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const clearDevices = useCallback(() => {
    setDevices([]);
    setMessage(null);
    if (status !== 'running') {
      setStatus('idle');
    }
  }, [status]);

  return {
    devices,
    status,
    message,
    startDiscovery,
    stopDiscovery,
    clearDevices,
    isRunning: status === 'running',
  };
}
