import type { VendorInfo, SonosVendorInfo } from '../types';

/**
 * Device information extracted from DNS-SD TXT records
 */
export interface DeviceInfo {
  /** Device type (e.g., "HomeKit", "AirPlay", "Chromecast", "Printer") */
  deviceType: string | null;
  /** Manufacturer name */
  manufacturer: string | null;
  /** Device model */
  model: string | null;
  /** Additional parsed information */
  metadata: Record<string, string>;
}

/**
 * Parser function for a specific service type
 */
type ServiceTypeParser = (
  serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
) => DeviceInfo | null;

/**
 * Registry of parsers for different service types
 */
const serviceTypeParsers: Map<string, ServiceTypeParser> = new Map();

/**
 * Register a parser for a specific service type
 * 
 * @param serviceType - Service type pattern (e.g., "_hap._tcp.local." or "_airplay._tcp.local.")
 * @param parser - Parser function
 */
function registerServiceTypeParser(
  serviceType: string,
  parser: ServiceTypeParser
): void {
  serviceTypeParsers.set(serviceType.toLowerCase(), parser);
}

/**
 * Parse HomeKit device information
 * Service type: _hap._tcp.local.
 */
function parseHomeKit(
  _serviceType: string,
  txtProperties: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  // HomeKit TXT record keys
  const model = txtProperties['md'] || txtProperties['model'] || null;
  const protocolVersion = txtProperties['pv'] || null;
  const deviceId = txtProperties['id'] || null;
  const categoryId = txtProperties['ci'] || null;
  const configNumber = txtProperties['c#'] || null;
  const stateNumber = txtProperties['s#'] || null;
  const featureFlags = txtProperties['ff'] || null;
  
  if (protocolVersion) metadata['protocolVersion'] = protocolVersion;
  if (deviceId) metadata['deviceId'] = deviceId;
  if (categoryId) metadata['categoryId'] = categoryId;
  if (configNumber) metadata['configNumber'] = configNumber;
  if (stateNumber) metadata['stateNumber'] = stateNumber;
  if (featureFlags) metadata['featureFlags'] = featureFlags;
  
  // Map category ID to device type name
  const categoryMap: Record<string, string> = {
    '1': 'Other',
    '2': 'Bridge',
    '3': 'Fan',
    '4': 'Garage Door Opener',
    '5': 'Lightbulb',
    '6': 'Door Lock',
    '7': 'Outlet',
    '8': 'Switch',
    '9': 'Thermostat',
    '10': 'Sensor',
    '11': 'Security System',
    '12': 'Door',
    '13': 'Window',
    '14': 'Window Covering',
    '15': 'Programmable Switch',
    '16': 'Range Extender',
    '17': 'IP Camera',
    '18': 'Video Doorbell',
    '19': 'Air Purifier',
    '20': 'Heater',
    '21': 'Air Conditioner',
    '22': 'Humidifier',
    '23': 'Dehumidifier',
  };
  
  const deviceType = categoryId ? categoryMap[categoryId] || 'HomeKit Device' : 'HomeKit Device';
  
  return {
    deviceType,
    manufacturer: null, // HomeKit doesn't typically include manufacturer in TXT records
    model,
    metadata,
  };
}

/**
 * Parse AirPlay device information
 * Service type: _airplay._tcp.local.
 */
function parseAirPlay(
  _serviceType: string,
  txtProperties: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const model = txtProperties['model'] || txtProperties['md'] || null;
  const manufacturer = txtProperties['manufacturer'] || txtProperties['mfr'] || null;
  const deviceId = txtProperties['deviceid'] || txtProperties['id'] || null;
  const features = txtProperties['features'] || null;
  const osVersion = txtProperties['osvers'] || txtProperties['osVersion'] || null;
  const sourceVersion = txtProperties['srcvers'] || null;
  
  if (deviceId) metadata['deviceId'] = deviceId;
  if (features) metadata['features'] = features;
  if (osVersion) metadata['osVersion'] = osVersion;
  if (sourceVersion) metadata['sourceVersion'] = sourceVersion;
  
  return {
    deviceType: 'AirPlay',
    manufacturer: manufacturer || 'Apple', // Default to Apple for AirPlay devices
    model,
    metadata,
  };
}

/**
 * Parse Chromecast/Google Cast device information
 * Service type: _googlecast._tcp.local.
 */
function parseChromecast(
  _serviceType: string,
  txtProperties: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const model = txtProperties['md'] || txtProperties['model'] || null;
  const deviceId = txtProperties['id'] || null;
  const capabilities = txtProperties['cd'] || null;
  const roomName = txtProperties['rm'] || null;
  const version = txtProperties['ve'] || null;
  
  if (deviceId) metadata['deviceId'] = deviceId;
  if (capabilities) metadata['capabilities'] = capabilities;
  if (roomName) metadata['roomName'] = roomName;
  if (version) metadata['version'] = version;
  
  // Try to extract device type from model name
  let deviceType = 'Chromecast';
  if (model) {
    const modelLower = model.toLowerCase();
    if (modelLower.includes('chromecast')) {
      deviceType = 'Chromecast';
    } else if (modelLower.includes('nest')) {
      deviceType = 'Google Nest';
    } else if (modelLower.includes('home')) {
      deviceType = 'Google Home';
    }
  }
  
  return {
    deviceType,
    manufacturer: 'Google',
    model,
    metadata,
  };
}

/**
 * Parse printer device information
 * Service types: _ipp._tcp.local., _printer._tcp.local., _pdl-datastream._tcp.local.
 */
function parsePrinter(
  _serviceType: string,
  txtProperties: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const manufacturer = txtProperties['ty'] || txtProperties['manufacturer'] || txtProperties['mfr'] || null;
  const model = txtProperties['product'] || txtProperties['model'] || txtProperties['md'] || null;
  const note = txtProperties['note'] || null;
  const pdl = txtProperties['pdl'] || null;
  const rp = txtProperties['rp'] || null;
  const adminUrl = txtProperties['adminurl'] || txtProperties['adminURL'] || null;
  
  if (note) metadata['note'] = note;
  if (pdl) metadata['pdl'] = pdl;
  if (rp) metadata['resourcePath'] = rp;
  if (adminUrl) metadata['adminUrl'] = adminUrl;
  
  // Extract manufacturer from 'ty' field if it contains manufacturer info
  let extractedManufacturer = manufacturer;
  if (manufacturer && manufacturer.includes(' ')) {
    const parts = manufacturer.split(' ');
    if (parts.length > 1) {
      extractedManufacturer = parts[0];
      // Remaining parts might be model
      if (!model && parts.length > 1) {
        metadata['fullModel'] = parts.slice(1).join(' ');
      }
    }
  }
  
  return {
    deviceType: 'Printer',
    manufacturer: extractedManufacturer,
    model: model || metadata['fullModel'] || null,
    metadata,
  };
}

/**
 * Parse Sonos device information from mDNS TXT records
 * Service type: _sonos._tcp.local.
 * Note: This is a fallback when vendor_info is not available
 */
function parseSonos(
  _serviceType: string,
  txtProperties: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const model = txtProperties['model'] || txtProperties['md'] || null;
  const version = txtProperties['version'] || txtProperties['ve'] || null;
  const householdId = txtProperties['hhid'] || null;
  
  if (version) metadata['version'] = version;
  if (householdId) metadata['householdId'] = householdId;
  
  return {
    deviceType: 'Sonos',
    manufacturer: 'Sonos',
    model,
    metadata,
  };
}

/**
 * Parse Sonos device information from vendor-specific info
 * This provides richer information than mDNS TXT records
 */
function parseSonosFromVendorInfo(vendorInfo: SonosVendorInfo): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  // Basic info
  metadata['zoneName'] = vendorInfo.zone_name;
  if (vendorInfo.software_version) metadata['softwareVersion'] = vendorInfo.software_version;
  if (vendorInfo.hardware_version) metadata['hardwareVersion'] = vendorInfo.hardware_version;
  if (vendorInfo.serial_number) metadata['serialNumber'] = vendorInfo.serial_number;
  if (vendorInfo.mac_address) metadata['macAddress'] = vendorInfo.mac_address;
  if (vendorInfo.local_uid) metadata['localUid'] = vendorInfo.local_uid;
  if (vendorInfo.household_id) metadata['householdId'] = vendorInfo.household_id;
  if (vendorInfo.series_id) metadata['seriesId'] = vendorInfo.series_id;
  
  // Model info from device description
  if (vendorInfo.model_name) metadata['modelName'] = vendorInfo.model_name;
  if (vendorInfo.model_number) metadata['modelNumber'] = vendorInfo.model_number;
  if (vendorInfo.model_url) metadata['modelUrl'] = vendorInfo.model_url;
  if (vendorInfo.api_version) metadata['apiVersion'] = vendorInfo.api_version;
  if (vendorInfo.display_version) metadata['displayVersion'] = vendorInfo.display_version;
  if (vendorInfo.zone_type !== null) metadata['zoneType'] = String(vendorInfo.zone_type);
  if (vendorInfo.icon_url) metadata['iconUrl'] = vendorInfo.icon_url;
  
  return {
    deviceType: 'Sonos Speaker',
    manufacturer: 'Sonos',
    // Prefer model_name (e.g., "Era 300") over series_id (e.g., "A101")
    model: vendorInfo.model_name || vendorInfo.series_id || null,
    metadata,
  };
}

/**
 * Parse device information from vendor-specific info
 */
function parseDeviceInfoFromVendorInfo(vendorInfo: VendorInfo): DeviceInfo | null {
  switch (vendorInfo.vendor) {
    case 'sonos':
      return parseSonosFromVendorInfo(vendorInfo);
    default:
      return null;
  }
}

/**
 * Parse ESPHome device information
 * Service type: _esphomelib._tcp.local.
 */
function parseESPHome(
  _serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const version = txtProperties['version'] || txtProperties['ve'] || null;
  const projectName = txtProperties['project_name'] || txtProperties['projectName'] || null;
  const projectVersion = txtProperties['project_version'] || txtProperties['projectVersion'] || null;
  const friendlyName = txtProperties['friendly_name'] || txtProperties['friendlyName'] || null;
  
  if (version) metadata['version'] = version;
  if (projectName) metadata['projectName'] = projectName;
  if (projectVersion) metadata['projectVersion'] = projectVersion;
  if (friendlyName) metadata['friendlyName'] = friendlyName;
  
  return {
    deviceType: 'ESPHome',
    manufacturer: 'ESPHome',
    model: projectName || instanceName,
    metadata,
  };
}

/**
 * Parse generic HTTP/HTTPS service information
 * Service types: _http._tcp.local., _https._tcp.local.
 */
function parseHTTPService(
  _serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const path = txtProperties['path'] || txtProperties['uri'] || null;
  const username = txtProperties['u'] || txtProperties['username'] || null;
  
  if (path) metadata['path'] = path;
  if (username) metadata['username'] = username;
  
  // Try to infer device type from instance name or hostname patterns
  let deviceType: string | null = null;
  const instanceLower = instanceName.toLowerCase();
  
  if (instanceLower.includes('printer') || instanceLower.includes('print')) {
    deviceType = 'Printer';
  } else if (instanceLower.includes('router') || instanceLower.includes('gateway')) {
    deviceType = 'Router';
  } else if (instanceLower.includes('nas') || instanceLower.includes('storage')) {
    deviceType = 'NAS';
  } else if (instanceLower.includes('camera')) {
    deviceType = 'Camera';
  } else if (instanceLower.includes('tv') || instanceLower.includes('television')) {
    deviceType = 'TV';
  }
  
  return {
    deviceType: deviceType || 'HTTP Server',
    manufacturer: null,
    model: null,
    metadata,
  };
}

/**
 * Parse Spotify Connect device information
 * Service type: _spotify-connect._tcp.local.
 */
function parseSpotifyConnect(
  _serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const version = txtProperties['VERSION'] || txtProperties['version'] || null;
  const cPath = txtProperties['CPath'] || null;
  const stack = txtProperties['Stack'] || null;
  
  if (version) metadata['version'] = version;
  if (cPath) metadata['cPath'] = cPath;
  if (stack) metadata['stack'] = stack;
  
  return {
    deviceType: 'Spotify Connect',
    manufacturer: 'Spotify',
    model: instanceName,
    metadata,
  };
}

/**
 * Parse Philips Hue device information
 * Service type: _hue._tcp.local.
 * 
 * Hue devices expose useful info in TXT records:
 * - bridgeid: Device identifier (MAC-based, e.g., "ecb5fafffe808331")
 * - modelid: Model identifier (e.g., "BSB002" for Hue Bridge v2)
 * 
 * Known model ID prefixes:
 * - BSB: Hue Bridge (BSB001=v1, BSB002=v2, BSB003=Pro)
 * - HSB: Hue Sync Box (HSB001/HSB1=original, HSB002/HSB2=8K)
 */
function parseHueDevice(
  _serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const bridgeId = txtProperties['bridgeid'] || null;
  const modelId = txtProperties['modelid'] || null;
  
  if (bridgeId) metadata['bridgeId'] = bridgeId;
  if (modelId) metadata['modelId'] = modelId;
  
  // Map Hue model IDs to human-readable model names and device types
  const modelInfo: Record<string, { model: string; deviceType: string }> = {
    // Hue Bridges
    'BSB001': { model: 'Hue Bridge v1', deviceType: 'Smart Home Hub' },
    'BSB002': { model: 'Hue Bridge v2', deviceType: 'Smart Home Hub' },
    'BSB003': { model: 'Hue Bridge Pro', deviceType: 'Smart Home Hub' },
    // Hue Sync Boxes
    'HSB001': { model: 'Hue Play HDMI Sync Box', deviceType: 'HDMI Sync Box' },
    'HSB1': { model: 'Hue Play HDMI Sync Box', deviceType: 'HDMI Sync Box' },
    'HSB002': { model: 'Hue Play HDMI Sync Box 8K', deviceType: 'HDMI Sync Box' },
    'HSB2': { model: 'Hue Play HDMI Sync Box 8K', deviceType: 'HDMI Sync Box' },
  };
  
  // Determine device info from model ID
  let deviceType = 'Hue Device';
  let model: string | null = null;
  
  if (modelId && modelInfo[modelId]) {
    deviceType = modelInfo[modelId].deviceType;
    model = modelInfo[modelId].model;
  } else if (modelId) {
    // Try to infer device type from model ID prefix
    if (modelId.startsWith('BSB')) {
      deviceType = 'Smart Home Hub';
      model = `Hue Bridge (${modelId})`;
    } else if (modelId.startsWith('HSB')) {
      deviceType = 'HDMI Sync Box';
      model = `Hue Sync Box (${modelId})`;
    } else {
      model = modelId;
    }
  } else {
    // Try to infer from instance name
    const nameLower = instanceName.toLowerCase();
    if (nameLower.includes('bridge')) {
      deviceType = 'Smart Home Hub';
      model = 'Hue Bridge';
    } else if (nameLower.includes('sync')) {
      deviceType = 'HDMI Sync Box';
      model = 'Hue Sync Box';
    }
  }
  
  return {
    deviceType,
    manufacturer: 'Philips',
    model,
    metadata,
  };
}

/**
 * Parse WiZ smart light information
 * Service type: _wiz._udp.local.
 * 
 * WiZ is a Signify brand (same company as Philips Hue) for WiFi-based smart lights.
 * Unlike Hue (which uses Zigbee + Bridge), WiZ devices connect directly to WiFi.
 */
function parseWizDevice(
  _serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  // WiZ TXT records can include various device info
  const mac = txtProperties['mac'] || null;
  const moduleId = txtProperties['moduleName'] || txtProperties['module'] || null;
  const fwVersion = txtProperties['fwVersion'] || txtProperties['fw'] || null;
  
  if (mac) metadata['mac'] = mac;
  if (moduleId) metadata['moduleId'] = moduleId;
  if (fwVersion) metadata['firmwareVersion'] = fwVersion;
  
  // WiZ devices are typically smart bulbs, but could be plugs or other devices
  let deviceType = 'Smart Light';
  const nameLower = instanceName.toLowerCase();
  if (nameLower.includes('plug') || nameLower.includes('socket')) {
    deviceType = 'Smart Plug';
  } else if (nameLower.includes('strip')) {
    deviceType = 'Light Strip';
  }
  
  return {
    deviceType,
    manufacturer: 'WiZ',
    model: moduleId || null,
    metadata,
  };
}

/**
 * Parse Shelly device information
 * Service type: _shelly._tcp.local.
 * 
 * Shelly devices expose useful info in TXT records:
 * - app: Device model code (e.g., "PlugSG3", "PlusPlugS", "Pro4PM")
 * - gen: Generation (1, 2, or 3)
 * - ver: Firmware version
 */
function parseShelly(
  _serviceType: string,
  txtProperties: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  const appCode = txtProperties['app'] || null;
  const generation = txtProperties['gen'] || null;
  const version = txtProperties['ver'] || null;
  
  if (appCode) metadata['appCode'] = appCode;
  if (generation) metadata['generation'] = generation;
  if (version) metadata['firmwareVersion'] = version;
  
  // Map Shelly app codes to human-readable model names
  const modelMap: Record<string, string> = {
    // Gen 3
    'PlugSG3': 'Plug S Gen 3',
    'MiniG3': 'Mini Gen 3',
    'Mini1G3': '1PM Mini Gen 3',
    '1G3': '1 Gen 3',
    '1PMG3': '1PM Gen 3',
    '2PMG3': '2PM Gen 3',
    'RGBWG3': 'RGBW Gen 3',
    'HTG3': 'H&T Gen 3',
    'DimmerG3': 'Dimmer Gen 3',
    'MotionG3': 'Motion Gen 3',
    'I4G3': 'i4 Gen 3',
    // Gen 2 / Plus
    'PlusPlugS': 'Plus Plug S',
    'PlusPlugUS': 'Plus Plug US',
    'Plus1': 'Plus 1',
    'Plus1PM': 'Plus 1PM',
    'Plus2PM': 'Plus 2PM',
    'PlusI4': 'Plus i4',
    'PlusHT': 'Plus H&T',
    'PlusSmoke': 'Plus Smoke',
    'PlusDimmerUS': 'Plus Dimmer US',
    // Pro
    'Pro1': 'Pro 1',
    'Pro1PM': 'Pro 1PM',
    'Pro2': 'Pro 2',
    'Pro2PM': 'Pro 2PM',
    'Pro3': 'Pro 3',
    'Pro4PM': 'Pro 4PM',
    'ProEM': 'Pro EM',
    'Pro3EM': 'Pro 3EM',
    'ProDualCoverPM': 'Pro Dual Cover PM',
    // Gen 1
    '1': '1',
    '1L': '1L',
    '1PM': '1PM',
    '25': '2.5',
    'Plug': 'Plug',
    'PlugS': 'Plug S',
    'PlugUS': 'Plug US',
    'Dimmer': 'Dimmer',
    'Dimmer2': 'Dimmer 2',
    'RGBW2': 'RGBW2',
    'Bulb': 'Bulb',
    'BulbDuo': 'Bulb Duo',
    'Vintage': 'Vintage',
    'EM': 'EM',
    '3EM': '3EM',
    'HT': 'H&T',
    'Flood': 'Flood',
    'Door': 'Door/Window',
    'Motion': 'Motion',
    'Gas': 'Gas',
    'Smoke': 'Smoke',
    'Button1': 'Button 1',
    'i3': 'i3',
    'i4': 'i4',
    'UNI': 'UNI',
  };
  
  const modelName = appCode ? (modelMap[appCode] || appCode) : null;
  const genLabel = generation ? `Gen ${generation}` : null;
  
  // Construct device type like "Shelly Plug S Gen 3"
  let deviceType = 'Shelly';
  if (modelName) {
    // Avoid duplication like "Plug S Gen 3 Gen 3" - some models already have Gen in the name
    if (genLabel && !modelName.toLowerCase().includes('gen')) {
      deviceType = `Shelly ${modelName}`;
    } else {
      deviceType = `Shelly ${modelName}`;
    }
  }
  
  return {
    deviceType,
    manufacturer: 'Shelly',
    model: modelName,
    metadata,
  };
}

// Register all built-in parsers
registerServiceTypeParser('_hap._tcp.local.', parseHomeKit);
registerServiceTypeParser('_homekit._tcp.local.', parseHomeKit);
registerServiceTypeParser('_airplay._tcp.local.', parseAirPlay);
registerServiceTypeParser('_raop._tcp.local.', parseAirPlay);
registerServiceTypeParser('_googlecast._tcp.local.', parseChromecast);
registerServiceTypeParser('_ipp._tcp.local.', parsePrinter);
registerServiceTypeParser('_printer._tcp.local.', parsePrinter);
registerServiceTypeParser('_pdl-datastream._tcp.local.', parsePrinter);
registerServiceTypeParser('_sonos._tcp.local.', parseSonos);
registerServiceTypeParser('_shelly._tcp.local.', parseShelly);
registerServiceTypeParser('_esphomelib._tcp.local.', parseESPHome);
registerServiceTypeParser('_http._tcp.local.', parseHTTPService);
registerServiceTypeParser('_https._tcp.local.', parseHTTPService);
registerServiceTypeParser('_spotify-connect._tcp.local.', parseSpotifyConnect);
registerServiceTypeParser('_hue._tcp.local.', parseHueDevice);
registerServiceTypeParser('_wiz._udp.local.', parseWizDevice);

/**
 * Parse device information from a service
 * 
 * @param serviceType - Service type (e.g., "_hap._tcp.local.")
 * @param txtProperties - TXT record properties
 * @param instanceName - Service instance name
 * @returns Parsed device information or null if no parser found
 */
function parseDeviceInfo(
  serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo | null {
  const normalizedServiceType = serviceType.toLowerCase();
  
  // Try exact match first
  const parser = serviceTypeParsers.get(normalizedServiceType);
  if (parser) {
    return parser(serviceType, txtProperties, instanceName);
  }
  
  // Try partial match (for service types with variations)
  for (const [pattern, parserFunc] of serviceTypeParsers.entries()) {
    if (normalizedServiceType.includes(pattern.replace(/[._]/g, ''))) {
      return parserFunc(serviceType, txtProperties, instanceName);
    }
  }
  
  return null;
}

/**
 * Parse device information from multiple services and optional vendor info
 * Merges information from all services, prioritizing vendor info when available
 * 
 * @param services - Array of services with their TXT properties
 * @param vendorInfo - Optional vendor-specific information from device APIs
 * @returns Combined device information
 */
export function parseDeviceInfoFromServices(
  services: Array<{
    serviceType: string;
    txtProperties: Record<string, string>;
    instanceName: string;
  }>,
  vendorInfo?: VendorInfo
): DeviceInfo {
  const allInfo: DeviceInfo[] = [];
  
  // If vendor info is available, parse it first (highest priority)
  if (vendorInfo) {
    const vendorDeviceInfo = parseDeviceInfoFromVendorInfo(vendorInfo);
    if (vendorDeviceInfo) {
      allInfo.push(vendorDeviceInfo);
    }
  }
  
  // Parse each service
  for (const service of services) {
    const info = parseDeviceInfo(
      service.serviceType,
      service.txtProperties,
      service.instanceName
    );
    if (info) {
      allInfo.push(info);
    }
  }
  
  // Merge information (prioritize first non-null values, vendor info comes first)
  const merged: DeviceInfo = {
    deviceType: null,
    manufacturer: null,
    model: null,
    metadata: {},
  };
  
  for (const info of allInfo) {
    if (!merged.deviceType && info.deviceType) {
      merged.deviceType = info.deviceType;
    }
    if (!merged.manufacturer && info.manufacturer) {
      merged.manufacturer = info.manufacturer;
    }
    if (!merged.model && info.model) {
      merged.model = info.model;
    }
    // Merge metadata
    Object.assign(merged.metadata, info.metadata);
  }
  
  return merged;
}
