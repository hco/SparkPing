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
export type ServiceTypeParser = (
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
export function registerServiceTypeParser(
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
 * Parse Sonos device information
 * Service type: _sonos._tcp.local.
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
 * Parse ESPHome device information
 * Service type: _esphomelib._tcp.local.
 */
function parseESPHome(
  serviceType: string,
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
  serviceType: string,
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
  serviceType: string,
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
registerServiceTypeParser('_esphomelib._tcp.local.', parseESPHome);
registerServiceTypeParser('_http._tcp.local.', parseHTTPService);
registerServiceTypeParser('_https._tcp.local.', parseHTTPService);
registerServiceTypeParser('_spotify-connect._tcp.local.', parseSpotifyConnect);

/**
 * Parse device information from a service
 * 
 * @param serviceType - Service type (e.g., "_hap._tcp.local.")
 * @param txtProperties - TXT record properties
 * @param instanceName - Service instance name
 * @returns Parsed device information or null if no parser found
 */
export function parseDeviceInfo(
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
 * Parse device information from multiple services
 * Merges information from all services, prioritizing more specific parsers
 * 
 * @param services - Array of services with their TXT properties
 * @returns Combined device information
 */
export function parseDeviceInfoFromServices(
  services: Array<{
    serviceType: string;
    txtProperties: Record<string, string>;
    instanceName: string;
  }>
): DeviceInfo {
  const allInfo: DeviceInfo[] = [];
  
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
  
  // Merge information (prioritize first non-null values)
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

