import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, createElement } from 'react';
import { useDeviceDiscovery } from '@/hooks/useDeviceDiscovery';
import { createTarget } from '@/api';
import type { TargetRequest, DiscoveredDevice } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Document } from 'flexsearch';
import { parseDeviceInfoFromServices, type DeviceInfo } from '@/lib/deviceParser';
import { getBrandIcon } from '@/lib/brandIcons';
import {
  Search,
  Loader2,
  Plus,
  Wifi,
  Server,
  CheckCircle2,
  XCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
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

function DeviceIcon({
  deviceInfo,
  firstServiceType,
}: {
  deviceInfo: DeviceInfo;
  firstServiceType: string | null;
}) {
  const BrandIconComponent = getBrandIcon(deviceInfo.manufacturer);

  if (BrandIconComponent) {
    return createElement(BrandIconComponent, {
      className: 'size-3.5 shrink-0',
    });
  }

  if (firstServiceType) {
    return getServiceIcon(firstServiceType);
  }

  return <Wifi className="size-4" />;
}

/**
 * Parse device information from a discovered device
 * Prioritizes device-level TXT records over service-level ones
 */
function getDeviceInfo(device: DiscoveredDevice): DeviceInfo {
  // First, parse device-level TXT properties if they exist
  const deviceLevelInfo: DeviceInfo = {
    deviceType: null,
    manufacturer: device.txt_properties['manufacturer'] || 
                  device.txt_properties['mfr'] || 
                  device.txt_properties['ty']?.split(' ')[0] || 
                  null,
    model: device.txt_properties['model'] || 
           device.txt_properties['md'] || 
           device.txt_properties['product'] || 
           null,
    metadata: { ...device.txt_properties },
  };

  // Then parse service-level information
  const serviceLevelInfo = parseDeviceInfoFromServices(
    device.services.map((service) => ({
      serviceType: service.service_type,
      txtProperties: service.txt_properties,
      instanceName: service.instance_name,
    }))
  );

  // Merge: prioritize device-level manufacturer/model, but use service-level deviceType if device-level doesn't have one
  return {
    deviceType: deviceLevelInfo.deviceType || serviceLevelInfo.deviceType,
    manufacturer: deviceLevelInfo.manufacturer || serviceLevelInfo.manufacturer,
    model: deviceLevelInfo.model || serviceLevelInfo.model,
    metadata: {
      ...serviceLevelInfo.metadata,
      ...deviceLevelInfo.metadata, // Device-level metadata takes precedence
    },
  };
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
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Create and update FlexSearch document index when devices change
  const searchIndex = useMemo(() => {
    const index = new Document<DiscoveredDevice>({
      document: {
        id: 'address',
        index: [
          {
            field: 'hostname',
            tokenize: 'forward',
          },
          {
            field: 'name',
            tokenize: 'forward',
          },
          {
            field: 'address',
            tokenize: 'forward',
          },
          {
            field: 'addresses',
            tokenize: 'forward',
          },
          {
            field: 'services',
            tokenize: 'forward',
          },
          {
            field: 'serviceNames',
            tokenize: 'forward',
          },
        ],
        store: true,
      },
      tokenize: 'forward',
      context: {
        resolution: 3,
        depth: 2,
        bidirectional: true,
      },
    });

    // Index all current devices
    devices.forEach((device) => {
      // Create searchable document with all relevant fields
      const searchableDoc = {
        address: device.address,
        hostname: device.hostname,
        name: device.name,
        addresses: device.addresses.join(' '),
        services: device.services.map((s) => s.service_type).join(' '),
        serviceNames: device.services.map((s) => getServiceTypeName(s.service_type)).join(' '),
      };
      index.add(device.address, searchableDoc);
    });

    return index;
  }, [devices]);

  // Filter devices based on search query
  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) {
      return devices;
    }

    const results = searchIndex.search(searchQuery, {
      limit: 1000,
      enrich: true,
    });

    // Extract device addresses from search results
    const matchedAddresses = new Set<string>();
    results.forEach((result) => {
      result.result.forEach((item) => {
        matchedAddresses.add(item.id as string);
      });
    });

    return devices.filter((device) => matchedAddresses.has(device.address));
  }, [devices, searchQuery, searchIndex]);

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

  const handleToggleDetails = (address: string) => {
    setExpandedDevices((prev) => {
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
    setExpandedDevices(new Set());
    setSearchQuery('');
  };

  const selectableDevices = filteredDevices.filter(
    (d) => !existingAddresses.has(d.address) && !addedDevices.has(d.address)
  );

  const selectedCount = [...selectedDevices].filter(
    (addr) => !existingAddresses.has(addr) && !addedDevices.has(addr)
  ).length;

  // Check if all selectable devices are selected
  const allSelectableSelected =
    selectableDevices.length > 0 &&
    selectableDevices.every((d) => selectedDevices.has(d.address));

  // Check if some (but not all) selectable devices are selected
  const someSelectableSelected =
    selectableDevices.length > 0 &&
    selectableDevices.some((d) => selectedDevices.has(d.address)) &&
    !allSelectableSelected;

  const handleSelectAll = () => {
    if (allSelectableSelected) {
      // Deselect all selectable devices
      setSelectedDevices((prev) => {
        const next = new Set(prev);
        selectableDevices.forEach((d) => next.delete(d.address));
        return next;
      });
    } else {
      // Select all selectable devices
      setSelectedDevices((prev) => {
        const next = new Set(prev);
        selectableDevices.forEach((d) => next.add(d.address));
        return next;
      });
    }
  };


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
            <Button onClick={startDiscovery}>
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
              : 'bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400'
          }`}
        >
          {status === 'running' && <Loader2 className="size-4 animate-spin" />}
          {status === 'idle' && <CheckCircle2 className="size-4" />}
          {status === 'error' && <XCircle className="size-4" />}
          {message}
        </div>
      )}

      {/* Search input */}
      {devices.length > 0 && (
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by hostname, IP address, or service..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {searchQuery && (
            <p className="mt-2 text-sm text-muted-foreground">
              Showing {filteredDevices.length} of {devices.length} device
              {devices.length !== 1 ? 's' : ''}
            </p>
          )}
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
          ) : (
            'Click "Start Discovery" to find devices on your network.'
          )}
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="text-muted-foreground text-center py-8">
          No devices match your search query.
        </div>
      ) : (
        <>
          {/* Select all checkbox */}
          {selectableDevices.length > 0 && (
            <div className="mb-3 flex items-center gap-2 px-1">
              <Checkbox
                id="select-all"
                checked={allSelectableSelected || someSelectableSelected}
                onCheckedChange={handleSelectAll}
              />
              <Label
                htmlFor="select-all"
                className="text-sm font-medium cursor-pointer"
              >
                Select all visible ({selectableDevices.length} device
                {selectableDevices.length !== 1 ? 's' : ''})
                {someSelectableSelected && (
                  <span className="ml-1 text-muted-foreground">
                    ({selectedCount} selected)
                  </span>
                )}
              </Label>
            </div>
          )}
          <div className="space-y-2">
            {filteredDevices.map((device) => {
            const isExisting = existingAddresses.has(device.address);
            const isAdded = addedDevices.has(device.address);
            const isSelected = selectedDevices.has(device.address);
            const isDisabled = isExisting || isAdded;
            const isExpanded = expandedDevices.has(device.address);
            const deviceInfo = getDeviceInfo(device);

            return (
              <div
                key={device.address}
                className={`rounded-lg border transition-colors ${
                  isDisabled
                    ? 'bg-muted/50 border-border/50 opacity-60'
                    : isSelected
                      ? 'bg-primary/5 border-primary/30'
                      : 'bg-background border-border hover:border-primary/30'
                }`}
              >
                <div className="flex items-center gap-3 p-3">
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">
                        <DeviceIcon
                          deviceInfo={deviceInfo}
                          firstServiceType={
                            device.services.length > 0
                              ? device.services[0].service_type
                              : null
                          }
                        />
                      </span>
                      <span className="font-medium text-foreground">{device.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">{device.address}</span>
                      {deviceInfo.deviceType && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                          {deviceInfo.deviceType}
                        </span>
                      )}
                      {device.services.length > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                          {device.services.length} services
                        </span>
                      )}
                      {(isExisting || isAdded) && (
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          {isExisting ? 'Already added' : 'Just added'}
                        </span>
                      )}
                      {(deviceInfo.manufacturer || deviceInfo.model) && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          {deviceInfo.manufacturer && (() => {
                            const BrandIcon = getBrandIcon(deviceInfo.manufacturer);
                            return (
                              <>
                                {BrandIcon && (
                                  <BrandIcon className="size-3 shrink-0" />
                                )}
                                <span>{deviceInfo.manufacturer}</span>
                              </>
                            );
                          })()}
                          {deviceInfo.model && (
                            <span>{deviceInfo.model}</span>
                          )}
                        </span>
                      )}
                    </div>
                  </Label>
                  <button
                    type="button"
                    onClick={() => handleToggleDetails(device.address)}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1"
                    aria-label={isExpanded ? 'Hide details' : 'Show details'}
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-2">
                    <div className="mt-2 p-3 bg-muted/50 rounded text-xs font-mono overflow-x-auto">
                      <pre className="whitespace-pre-wrap break-words">
                        {JSON.stringify(device, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </>
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

