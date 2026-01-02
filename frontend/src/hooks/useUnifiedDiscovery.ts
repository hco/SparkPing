import { useState, useCallback, useRef, useEffect } from 'react';
import type { DiscoveredDevice, DiscoveryEvent, SubnetSuggestion } from '@/types';
import { getBasePath } from '@/lib/basePath';

export type DiscoveryStatus = 'idle' | 'running' | 'completed' | 'error';

export interface UnifiedDiscoveryConfig {
  /** Enable mDNS discovery */
  mdnsEnabled: boolean;
  /** Enable IP scan discovery */
  ipScanEnabled: boolean;
  /** Selected subnet for IP scan */
  selectedSubnet?: SubnetSuggestion;
  /** Custom CIDR for IP scan */
  cidr?: string;
  /** Custom start IP for IP scan */
  startIp?: string;
  /** Custom end IP for IP scan */
  endIp?: string;
}

interface UseUnifiedDiscoveryResult {
  /** List of discovered devices (merged from all methods) */
  devices: DiscoveredDevice[];
  /** Current status of discovery */
  status: DiscoveryStatus;
  /** Status message from the server */
  message: string | null;
  /** Start unified discovery with the given configuration */
  startDiscovery: (config: UnifiedDiscoveryConfig) => void;
  /** Stop discovery */
  stopDiscovery: () => void;
  /** Clear discovered devices list */
  clearDevices: () => void;
  /** Whether discovery is currently running */
  isRunning: boolean;
}

/**
 * Hook for managing unified device discovery via SSE.
 * Supports multiple discovery methods running simultaneously with merged results.
 */
export function useUnifiedDiscovery(): UseUnifiedDiscoveryResult {
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

  const startDiscovery = useCallback((config: UnifiedDiscoveryConfig) => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear previous results
    setDevices([]);
    setMessage(null);
    setStatus('running');

    // Build the SSE URL with query parameters
    const basePath = getBasePath();
    const params = new URLSearchParams();

    // Add mDNS flag
    params.set('mdns', config.mdnsEnabled.toString());

    // Add IP scan configuration
    params.set('ip_scan', config.ipScanEnabled.toString());

    if (config.ipScanEnabled) {
      if (config.selectedSubnet) {
        params.set('cidr', config.selectedSubnet.cidr);
      } else if (config.cidr) {
        params.set('cidr', config.cidr);
      } else if (config.startIp && config.endIp) {
        params.set('start_ip', config.startIp);
        params.set('end_ip', config.endIp);
      }
    }

    const url = `${basePath}api/discovery/unified?${params.toString()}`;
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
