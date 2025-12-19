import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useDeviceDiscovery } from '@/hooks/useDeviceDiscovery';
import { createTarget } from '@/api';
import type { TargetRequest } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Search,
  Loader2,
  Plus,
  Wifi,
  Server,
  CheckCircle2,
  XCircle,
  Trash2,
} from 'lucide-react';

interface DeviceDiscoveryPanelProps {
  /** IDs of targets that already exist (to prevent duplicates) */
  existingAddresses: Set<string>;
}

/**
 * Get a friendly icon for a service type
 */
function getServiceIcon(serviceType: string) {
  if (serviceType.includes('http') || serviceType.includes('https')) {
    return <Server className="size-4" />;
  }
  return <Wifi className="size-4" />;
}

/**
 * Get a human-readable service type name
 */
function getServiceTypeName(serviceType: string): string {
  const typeMap: Record<string, string> = {
    '_http._tcp.local.': 'HTTP Server',
    '_https._tcp.local.': 'HTTPS Server',
    '_ssh._tcp.local.': 'SSH Server',
    '_smb._tcp.local.': 'SMB Share',
    '_afpovertcp._tcp.local.': 'AFP Share',
    '_printer._tcp.local.': 'Printer',
    '_ipp._tcp.local.': 'Printer (IPP)',
    '_hap._tcp.local.': 'HomeKit',
    '_homekit._tcp.local.': 'HomeKit',
    '_airplay._tcp.local.': 'AirPlay',
    '_raop._tcp.local.': 'AirPlay Audio',
    '_googlecast._tcp.local.': 'Chromecast',
    '_spotify-connect._tcp.local.': 'Spotify Connect',
    '_sonos._tcp.local.': 'Sonos',
    '_esphomelib._tcp.local.': 'ESPHome',
    '_workstation._tcp.local.': 'Workstation',
  };
  return typeMap[serviceType] || serviceType.replace(/_/g, '').replace('.local.', '');
}

export function DeviceDiscoveryPanel({ existingAddresses }: DeviceDiscoveryPanelProps) {
  const queryClient = useQueryClient();
  const {
    devices,
    status,
    message,
    startDiscovery,
    stopDiscovery,
    clearDevices,
    isRunning,
  } = useDeviceDiscovery();

  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [addedDevices, setAddedDevices] = useState<Set<string>>(new Set());

  const createMutation = useMutation({
    mutationFn: createTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] });
    },
  });

  const handleToggleDevice = (address: string) => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  };

  const handleAddSelected = async () => {
    const devicesToAdd = devices.filter(
      (d) =>
        selectedDevices.has(d.address) &&
        !existingAddresses.has(d.address) &&
        !addedDevices.has(d.address)
    );

    for (const device of devicesToAdd) {
      const target: TargetRequest = {
        address: device.address,
        name: device.name || undefined,
      };

      try {
        await createMutation.mutateAsync(target);
        setAddedDevices((prev) => new Set(prev).add(device.address));
      } catch (error) {
        console.error(`Failed to add device ${device.address}:`, error);
      }
    }

    // Clear selection
    setSelectedDevices(new Set());
  };

  const handleClear = () => {
    clearDevices();
    setSelectedDevices(new Set());
    setAddedDevices(new Set());
  };

  const selectableDevices = devices.filter(
    (d) => !existingAddresses.has(d.address) && !addedDevices.has(d.address)
  );

  const selectedCount = [...selectedDevices].filter(
    (addr) => !existingAddresses.has(addr) && !addedDevices.has(addr)
  ).length;

  return (
    <div className="bg-card rounded-lg shadow border border-border p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Discover Devices</h2>
          <p className="text-sm text-muted-foreground">
            Find devices on your local network via mDNS
          </p>
        </div>
        <div className="flex gap-2">
          {devices.length > 0 && !isRunning && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="size-4" />
              Clear
            </Button>
          )}
          {isRunning ? (
            <Button variant="outline" onClick={stopDiscovery}>
              <Loader2 className="size-4 animate-spin" />
              Stop
            </Button>
          ) : (
            <Button onClick={() => startDiscovery(15)}>
              <Search className="size-4" />
              {devices.length > 0 ? 'Scan Again' : 'Start Discovery'}
            </Button>
          )}
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`mb-4 px-4 py-2 rounded text-sm flex items-center gap-2 ${
            status === 'error'
              ? 'bg-destructive/10 border border-destructive/30 text-destructive'
              : status === 'completed'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400'
          }`}
        >
          {status === 'running' && <Loader2 className="size-4 animate-spin" />}
          {status === 'completed' && <CheckCircle2 className="size-4" />}
          {status === 'error' && <XCircle className="size-4" />}
          {message}
        </div>
      )}

      {/* Device list */}
      {devices.length === 0 ? (
        <div className="text-muted-foreground text-center py-8">
          {isRunning ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-8 animate-spin" />
              <span>Scanning for devices...</span>
            </div>
          ) : status === 'completed' ? (
            'No devices found. Try scanning again.'
          ) : (
            'Click "Start Discovery" to find devices on your network.'
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {devices.map((device) => {
            const isExisting = existingAddresses.has(device.address);
            const isAdded = addedDevices.has(device.address);
            const isSelected = selectedDevices.has(device.address);
            const isDisabled = isExisting || isAdded;

            return (
              <div
                key={device.address}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  isDisabled
                    ? 'bg-muted/50 border-border/50 opacity-60'
                    : isSelected
                      ? 'bg-primary/5 border-primary/30'
                      : 'bg-background border-border hover:border-primary/30'
                }`}
              >
                <Checkbox
                  id={`device-${device.address}`}
                  checked={isSelected}
                  disabled={isDisabled}
                  onCheckedChange={() => handleToggleDevice(device.address)}
                />
                <Label
                  htmlFor={`device-${device.address}`}
                  className={`flex-1 cursor-pointer ${isDisabled ? 'cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {getServiceIcon(device.service_type)}
                    </span>
                    <span className="font-medium text-foreground">{device.name}</span>
                    {(isExisting || isAdded) && (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        {isExisting ? 'Already added' : 'Just added'}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {device.address} • {getServiceTypeName(device.service_type)}
                  </div>
                </Label>
              </div>
            );
          })}
        </div>
      )}

      {/* Add selected button */}
      {selectableDevices.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
          <span className="text-sm text-muted-foreground">
            {selectedCount} of {selectableDevices.length} device
            {selectableDevices.length !== 1 ? 's' : ''} selected
          </span>
          <Button
            onClick={handleAddSelected}
            disabled={selectedCount === 0 || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add Selected as Targets
          </Button>
        </div>
      )}
    </div>
  );
}

