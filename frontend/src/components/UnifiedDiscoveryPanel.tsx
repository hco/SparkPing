import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, createElement, useEffect } from 'react';
import { useUnifiedDiscovery, type UnifiedDiscoveryConfig } from '@/hooks/useUnifiedDiscovery';
import { createTarget, fetchSubnets } from '@/api';
import type { TargetRequest, IdentifiedDevice, SubnetSuggestion, DeviceInfo } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Document } from 'flexsearch';
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
  Network,
  Globe,
  Router,
  LayoutList,
  Group,
} from 'lucide-react';
import { JsonView } from '@/components/JsonView';

interface UnifiedDiscoveryPanelProps {
  existingAddresses: Set<string>;
}

function getServiceIcon(serviceType: string) {
  if (serviceType.includes('http') || serviceType.includes('https')) {
    return <Server className="size-4" />;
  }
  return <Wifi className="size-4" />;
}

function DeviceIcon({
  deviceInfo,
  discoverySources,
  firstServiceType,
}: {
  deviceInfo: DeviceInfo;
  discoverySources: IdentifiedDevice['discovery_sources'];
  firstServiceType: string | null;
}) {
  // Try icon_hint first (provided by backend)
  const iconHint = deviceInfo.icon_hint;
  if (iconHint) {
    const BrandIconComponent = getBrandIcon(iconHint);
    if (BrandIconComponent) {
      return createElement(BrandIconComponent, {
        className: 'size-3.5 shrink-0',
      });
    }
  }
  
  // Then try manufacturer
  const BrandIconComponent = getBrandIcon(deviceInfo.manufacturer ?? null);
  if (BrandIconComponent) {
    return createElement(BrandIconComponent, {
      className: 'size-3.5 shrink-0',
    });
  }

  // Check if discovered via IP scan
  const hasIpScan = discoverySources.some((s) => s.type === 'ip_scan');
  if (hasIpScan) {
    return <Router className="size-4" />;
  }

  if (firstServiceType) {
    return getServiceIcon(firstServiceType);
  }

  return <Wifi className="size-4" />;
}

/** Get the primary address for a device (for use as unique key) */
function getDeviceAddress(device: IdentifiedDevice): string {
  return device.device_info.primary_address;
}

/** Get a display name for the device */
function getDeviceName(device: IdentifiedDevice): string {
  return device.device_info.friendly_name ?? device.device_info.name;
}

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
    '_hue._tcp.local.': 'Philips Hue',
    '_wiz._udp.local.': 'WiZ Smart Light',
    '_miio._udp.local.': 'Xiaomi Mi IoT',
  };
  return typeMap[serviceType] || serviceType.replace(/_/g, '').replace('.local.', '');
}

function SubnetCard({ 
  subnet, 
  isSelected, 
  onSelect 
}: { 
  subnet: SubnetSuggestion; 
  isSelected: boolean; 
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected 
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20' 
          : 'border-border hover:border-primary/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {subnet.source === 'local' ? (
            <Network className="size-4 text-blue-500 shrink-0" />
          ) : (
            <Globe className="size-4 text-purple-500 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{subnet.label}</div>
            <div className="text-xs text-muted-foreground font-mono">{subnet.cidr}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted-foreground">
            {subnet.host_count} hosts
          </div>
        </div>
      </div>
    </div>
  );
}

type IpInputMode = 'suggested' | 'cidr' | 'range';

export function UnifiedDiscoveryPanel({ existingAddresses }: UnifiedDiscoveryPanelProps) {
  const queryClient = useQueryClient();
  const {
    devices,
    status,
    message,
    startDiscovery,
    stopDiscovery,
    clearDevices,
    isRunning,
  } = useUnifiedDiscovery();

  // Fetch subnet suggestions
  const { data: subnets = [], isLoading: isLoadingSubnets } = useQuery({
    queryKey: ['subnets'],
    queryFn: fetchSubnets,
    staleTime: 60000,
  });

  // Discovery configuration state
  const [mdnsEnabled, setMdnsEnabled] = useState(true);
  const [ipScanEnabled, setIpScanEnabled] = useState(false);
  const [ipInputMode, setIpInputMode] = useState<IpInputMode>('suggested');
  const [selectedSubnet, setSelectedSubnet] = useState<SubnetSuggestion | null>(null);
  const [cidrInput, setCidrInput] = useState('');
  const [startIpInput, setStartIpInput] = useState('');
  const [endIpInput, setEndIpInput] = useState('');

  // Device selection state
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [addedDevices, setAddedDevices] = useState<Set<string>>(new Set());
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByManufacturer, setGroupByManufacturer] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Auto-select first local subnet when subnets load
  useEffect(() => {
    if (subnets.length > 0 && !selectedSubnet) {
      const localSubnet = subnets.find(s => s.source === 'local') || subnets[0];
      setSelectedSubnet(localSubnet);
    }
  }, [subnets, selectedSubnet]);

  // Create FlexSearch index
  const searchIndex = useMemo(() => {
    type SearchableDeviceDoc = Record<string, string> & {
      address: string;
      hostname: string;
      name: string;
      addresses: string;
      services: string;
      serviceNames: string;
      manufacturer: string;
      deviceType: string;
    };

    const index = new Document<SearchableDeviceDoc>({
      document: {
        id: 'address',
        index: [
          { field: 'hostname', tokenize: 'forward' },
          { field: 'name', tokenize: 'forward' },
          { field: 'address', tokenize: 'forward' },
          { field: 'addresses', tokenize: 'forward' },
          { field: 'services', tokenize: 'forward' },
          { field: 'serviceNames', tokenize: 'forward' },
          { field: 'manufacturer', tokenize: 'forward' },
          { field: 'deviceType', tokenize: 'forward' },
        ],
        store: true,
      },
      tokenize: 'forward',
      context: { resolution: 3, depth: 2, bidirectional: true },
    });

    devices.forEach((device) => {
      const info = device.device_info;
      const services = device.raw_discovery.services;
      const searchableDoc: SearchableDeviceDoc = {
        address: info.primary_address,
        hostname: info.hostname ?? '',
        name: info.name,
        addresses: info.addresses.join(' '),
        services: services.map((s) => s.service_type).join(' '),
        serviceNames: services.map((s) => getServiceTypeName(s.service_type)).join(' '),
        manufacturer: info.manufacturer ?? '',
        deviceType: info.device_type ?? '',
      };
      index.add(info.primary_address, searchableDoc);
    });

    return index;
  }, [devices]);

  // Filter devices based on search query
  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) {
      return devices;
    }

    const results = searchIndex.search(searchQuery, { limit: 1000, enrich: true });
    const matchedAddresses = new Set<string>();
    results.forEach((result) => {
      result.result.forEach((item) => {
        matchedAddresses.add(item.id as string);
      });
    });

    return devices.filter((device) => matchedAddresses.has(getDeviceAddress(device)));
  }, [devices, searchQuery, searchIndex]);

  // Group devices by manufacturer
  const groupedDevices = useMemo(() => {
    if (!groupByManufacturer) return null;

    const groups = new Map<string, IdentifiedDevice[]>();
    
    for (const device of filteredDevices) {
      const manufacturer = device.device_info.manufacturer ?? 'Unknown';
      
      const existing = groups.get(manufacturer);
      if (existing) {
        existing.push(device);
      } else {
        groups.set(manufacturer, [device]);
      }
    }

    // Sort groups by manufacturer name, but put "Unknown" at the end
    const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return a.localeCompare(b);
    });

    return sortedGroups;
  }, [filteredDevices, groupByManufacturer]);

  const handleToggleGroup = (manufacturer: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(manufacturer)) {
        next.delete(manufacturer);
      } else {
        next.add(manufacturer);
      }
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: createTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets'] });
    },
  });

  const handleStartDiscovery = () => {
    const config: UnifiedDiscoveryConfig = {
      mdnsEnabled,
      ipScanEnabled,
    };

    if (ipScanEnabled) {
      if (ipInputMode === 'suggested' && selectedSubnet) {
        config.selectedSubnet = selectedSubnet;
      } else if (ipInputMode === 'cidr' && cidrInput) {
        config.cidr = cidrInput;
      } else if (ipInputMode === 'range' && startIpInput && endIpInput) {
        config.startIp = startIpInput;
        config.endIp = endIpInput;
      }
    }

    startDiscovery(config);
  };

  const canStartDiscovery = useMemo(() => {
    if (isRunning) return false;
    if (!mdnsEnabled && !ipScanEnabled) return false;
    
    if (ipScanEnabled) {
      if (ipInputMode === 'suggested') return selectedSubnet !== null;
      if (ipInputMode === 'cidr') return cidrInput.trim().length > 0;
      if (ipInputMode === 'range') return startIpInput.trim().length > 0 && endIpInput.trim().length > 0;
    }
    
    return true;
  }, [mdnsEnabled, ipScanEnabled, ipInputMode, selectedSubnet, cidrInput, startIpInput, endIpInput, isRunning]);

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
        selectedDevices.has(getDeviceAddress(d)) &&
        !existingAddresses.has(getDeviceAddress(d)) &&
        !addedDevices.has(getDeviceAddress(d))
    );

    for (const device of devicesToAdd) {
      const addr = getDeviceAddress(device);
      const name = getDeviceName(device);
      const target: TargetRequest = {
        address: addr,
        name: name !== addr ? name : undefined,
      };

      try {
        await createMutation.mutateAsync(target);
        setAddedDevices((prev) => new Set(prev).add(addr));
      } catch (error) {
        console.error(`Failed to add device ${addr}:`, error);
      }
    }

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
    (d) => !existingAddresses.has(getDeviceAddress(d)) && !addedDevices.has(getDeviceAddress(d))
  );

  const selectedCount = [...selectedDevices].filter(
    (addr) => !existingAddresses.has(addr) && !addedDevices.has(addr)
  ).length;

  const allSelectableSelected =
    selectableDevices.length > 0 &&
    selectableDevices.every((d) => selectedDevices.has(getDeviceAddress(d)));

  const someSelectableSelected =
    selectableDevices.length > 0 &&
    selectableDevices.some((d) => selectedDevices.has(getDeviceAddress(d))) &&
    !allSelectableSelected;

  const handleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedDevices((prev) => {
        const next = new Set(prev);
        selectableDevices.forEach((d) => next.delete(getDeviceAddress(d)));
        return next;
      });
    } else {
      setSelectedDevices((prev) => {
        const next = new Set(prev);
        selectableDevices.forEach((d) => next.add(getDeviceAddress(d)));
        return next;
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-xl">Discover Devices</CardTitle>
          <CardDescription>
            Find devices on your network using mDNS and IP scanning
          </CardDescription>
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
            <Button onClick={handleStartDiscovery} disabled={!canStartDiscovery}>
              <Search className="size-4" />
              Start Discovery
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Discovery Methods Configuration */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap gap-6">
            {/* mDNS Toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="mdns-enabled"
                checked={mdnsEnabled}
                onCheckedChange={(checked) => setMdnsEnabled(checked === true)}
                disabled={isRunning}
              />
              <Label htmlFor="mdns-enabled" className="flex items-center gap-2 cursor-pointer">
                <Wifi className="size-4 text-blue-500" />
                mDNS Discovery
              </Label>
            </div>

            {/* IP Scan Toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="ip-scan-enabled"
                checked={ipScanEnabled}
                onCheckedChange={(checked) => setIpScanEnabled(checked === true)}
                disabled={isRunning}
              />
              <Label htmlFor="ip-scan-enabled" className="flex items-center gap-2 cursor-pointer">
                <Network className="size-4 text-purple-500" />
                IP Range Scan
              </Label>
            </div>
          </div>

          {/* IP Scan Configuration */}
          {ipScanEnabled && (
            <div className="p-4 rounded-lg border border-border bg-muted/30">
              <div className="mb-3">
                <span className="text-sm font-medium">IP Scan Configuration</span>
              </div>

              {/* Subnet Selection */}
              <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant={ipInputMode === 'suggested' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setIpInputMode('suggested')}
                      disabled={isRunning}
                    >
                      Suggested
                    </Button>
                    <Button
                      variant={ipInputMode === 'cidr' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setIpInputMode('cidr')}
                      disabled={isRunning}
                    >
                      CIDR
                    </Button>
                    <Button
                      variant={ipInputMode === 'range' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setIpInputMode('range')}
                      disabled={isRunning}
                    >
                      IP Range
                    </Button>
                  </div>

                  {ipInputMode === 'suggested' && (
                    <>
                      {isLoadingSubnets ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Loader2 className="size-4 animate-spin" />
                          Loading subnets...
                        </div>
                      ) : subnets.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          No subnets found. Try CIDR or IP Range input.
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {subnets.map((subnet) => (
                            <SubnetCard
                              key={subnet.cidr}
                              subnet={subnet}
                              isSelected={selectedSubnet?.cidr === subnet.cidr}
                              onSelect={() => setSelectedSubnet(subnet)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {ipInputMode === 'cidr' && (
                    <div className="space-y-2">
                      <Label htmlFor="cidr-input">CIDR Notation</Label>
                      <Input
                        id="cidr-input"
                        value={cidrInput}
                        onChange={(e) => setCidrInput(e.target.value)}
                        placeholder="192.168.1.0/24"
                        className="font-mono max-w-xs"
                        disabled={isRunning}
                      />
                    </div>
                  )}

                  {ipInputMode === 'range' && (
                    <div className="grid grid-cols-2 gap-4 max-w-md">
                      <div className="space-y-2">
                        <Label htmlFor="start-ip">Start IP</Label>
                        <Input
                          id="start-ip"
                          value={startIpInput}
                          onChange={(e) => setStartIpInput(e.target.value)}
                          placeholder="192.168.1.1"
                          className="font-mono"
                          disabled={isRunning}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end-ip">End IP</Label>
                        <Input
                          id="end-ip"
                          value={endIpInput}
                          onChange={(e) => setEndIpInput(e.target.value)}
                          placeholder="192.168.1.254"
                          className="font-mono"
                          disabled={isRunning}
                        />
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}
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
            {status === 'idle' && <CheckCircle2 className="size-4" />}
            {status === 'error' && <XCircle className="size-4" />}
            {message}
          </div>
        )}

        {/* Search and grouping controls */}
        {devices.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by hostname, IP address, or service..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                variant={groupByManufacturer ? 'default' : 'outline'}
                size="sm"
                onClick={() => setGroupByManufacturer(!groupByManufacturer)}
                title={groupByManufacturer ? 'Show as list' : 'Group by manufacturer'}
              >
                {groupByManufacturer ? (
                  <>
                    <LayoutList className="size-4" />
                    <span className="hidden sm:inline">List</span>
                  </>
                ) : (
                  <>
                    <Group className="size-4" />
                    <span className="hidden sm:inline">Group</span>
                  </>
                )}
              </Button>
            </div>
            {searchQuery && (
              <p className="text-sm text-muted-foreground">
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
              'Configure discovery methods above and click "Start Discovery" to find devices.'
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
                <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
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
            {/* Device list - flat or grouped */}
            {groupByManufacturer && groupedDevices ? (
              <div className="space-y-4">
                {groupedDevices.map(([manufacturer, groupDevices]) => {
                  const isCollapsed = collapsedGroups.has(manufacturer);
                  const BrandIcon = getBrandIcon(manufacturer);
                  const groupSelectableDevices = groupDevices.filter(
                    (d) => !existingAddresses.has(getDeviceAddress(d)) && !addedDevices.has(getDeviceAddress(d))
                  );
                  const groupSelectedCount = groupSelectableDevices.filter(
                    (d) => selectedDevices.has(getDeviceAddress(d))
                  ).length;
                  
                  return (
                    <div key={manufacturer} className="border rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => handleToggleGroup(manufacturer)}
                        className="w-full flex items-center gap-3 p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-4 shrink-0" />
                        ) : (
                          <ChevronDown className="size-4 shrink-0" />
                        )}
                        {BrandIcon && <BrandIcon className="size-4 shrink-0" />}
                        <span className="font-medium flex-1">{manufacturer}</span>
                        <span className="text-sm text-muted-foreground">
                          {groupDevices.length} device{groupDevices.length !== 1 ? 's' : ''}
                          {groupSelectedCount > 0 && (
                            <span className="ml-2 text-primary">
                              ({groupSelectedCount} selected)
                            </span>
                          )}
                        </span>
                      </button>
                      {!isCollapsed && (
                        <div className="space-y-1 p-2">
                          {groupDevices.map((device) => {
                            const addr = getDeviceAddress(device);
                            const name = getDeviceName(device);
                            const info = device.device_info;
                            const isExisting = existingAddresses.has(addr);
                            const isAdded = addedDevices.has(addr);
                            const isSelected = selectedDevices.has(addr);
                            const isDisabled = isExisting || isAdded;
                            const isExpanded = expandedDevices.has(addr);

                            return (
                              <div
                                key={addr}
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
                                    id={`device-grouped-${addr}`}
                                    checked={isSelected}
                                    disabled={isDisabled}
                                    onCheckedChange={() => handleToggleDevice(addr)}
                                  />
                                  <Label
                                    htmlFor={`device-grouped-${addr}`}
                                    className={`flex-1 cursor-pointer ${isDisabled ? 'cursor-not-allowed' : ''}`}
                                  >
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-foreground">{name}</span>
                                      <span className="text-xs text-muted-foreground font-mono">{addr}</span>
                                      {info.device_type && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                          {info.device_type}
                                        </span>
                                      )}
                                      {info.model && (
                                        <span className="text-xs text-muted-foreground">
                                          {info.model}
                                        </span>
                                      )}
                                      {(isExisting || isAdded) && (
                                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                          {isExisting ? 'Already added' : 'Just added'}
                                        </span>
                                      )}
                                    </div>
                                  </Label>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleDetails(addr)}
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
                                    <JsonView data={device.raw_discovery} className="mt-2" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDevices.map((device) => {
                  const addr = getDeviceAddress(device);
                  const name = getDeviceName(device);
                  const info = device.device_info;
                  const services = device.raw_discovery.services;
                  const isExisting = existingAddresses.has(addr);
                  const isAdded = addedDevices.has(addr);
                  const isSelected = selectedDevices.has(addr);
                  const isDisabled = isExisting || isAdded;
                  const isExpanded = expandedDevices.has(addr);

                  return (
                    <div
                      key={addr}
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
                          id={`device-${addr}`}
                          checked={isSelected}
                          disabled={isDisabled}
                          onCheckedChange={() => handleToggleDevice(addr)}
                        />
                        <Label
                          htmlFor={`device-${addr}`}
                          className={`flex-1 cursor-pointer ${isDisabled ? 'cursor-not-allowed' : ''}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-muted-foreground">
                              <DeviceIcon
                                deviceInfo={info}
                                discoverySources={device.discovery_sources}
                                firstServiceType={
                                  services.length > 0
                                    ? services[0].service_type
                                    : null
                                }
                              />
                            </span>
                            <span className="font-medium text-foreground">{name}</span>
                            <span className="text-xs text-muted-foreground font-mono">{addr}</span>
                            {/* Discovery method badges */}
                            {device.discovery_sources.map((source, i) => (
                              <span
                                key={i}
                                className={`text-xs px-1.5 py-0.5 rounded ${
                                  source.type === 'mdns'
                                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                }`}
                              >
                                {source.type === 'mdns' ? 'mDNS' : source.type}
                              </span>
                            ))}
                            {info.device_type && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                {info.device_type}
                              </span>
                            )}
                            {services.length > 1 && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-600 dark:text-slate-400">
                                {services.length} services
                              </span>
                            )}
                            {(isExisting || isAdded) && (
                              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                {isExisting ? 'Already added' : 'Just added'}
                              </span>
                            )}
                            {(info.manufacturer || info.model) && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                {info.manufacturer && (() => {
                                  const BrandIcon = getBrandIcon(info.manufacturer);
                                  return (
                                    <>
                                      {BrandIcon && <BrandIcon className="size-3 shrink-0" />}
                                      <span>{info.manufacturer}</span>
                                    </>
                                  );
                                })()}
                                {info.model && <span>{info.model}</span>}
                              </span>
                            )}
                          </div>
                        </Label>
                        <button
                          type="button"
                          onClick={() => handleToggleDetails(addr)}
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
                          <JsonView data={device.raw_discovery} className="mt-2" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
      </CardContent>
    </Card>
  );
}
