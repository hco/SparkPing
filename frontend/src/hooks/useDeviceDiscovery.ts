import { useState, useCallback, useRef, useEffect } from 'react';
import type { DiscoveredDevice, DiscoveryEvent } from '@/types';
import { getBasePath } from '@/lib/basePath';

export type DiscoveryStatus = 'idle' | 'running' | 'completed' | 'error';

interface UseDeviceDiscoveryResult {
  /** List of discovered devices */
  devices: DiscoveredDevice[];
  /** Current status of discovery */
  status: DiscoveryStatus;
  /** Status message from the server */
  message: string | null;
  /** Start device discovery */
  startDiscovery: (durationSeconds?: number) => void;
  /** Stop discovery early */
  stopDiscovery: () => void;
  /** Clear discovered devices list */
  clearDevices: () => void;
  /** Whether discovery is currently running */
  isRunning: boolean;
}

/**
 * Hook for managing device discovery via SSE
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
    setStatus((prevStatus) => (prevStatus === 'running' ? 'idle' : prevStatus));
  }, []);

  const startDiscovery = useCallback((durationSeconds: number = 10) => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear previous results
    setDevices([]);
    setMessage(null);
    setStatus('running');

    // Build the SSE URL
    const basePath = getBasePath();
    const url = `${basePath}api/discovery/start?duration=${durationSeconds}`;

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

          case 'started':
            setMessage(data.message);
            setStatus('running');
            break;

          case 'completed':
            setMessage(data.message);
            setStatus('completed');
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
      setStatus('error');
      setMessage('Connection to discovery service lost');
      eventSource.close();
      eventSourceRef.current = null;
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

