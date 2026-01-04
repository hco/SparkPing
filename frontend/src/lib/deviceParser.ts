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
 * Parse Xiaomi Mi IoT (miio) device information
 * Service type: _miio._udp.local.
 * 
 * Xiaomi devices use a consistent naming pattern in their instance name:
 * - Format: {brand}-{devicetype}-{version}_miio{deviceid}
 * - Examples:
 *   - zhimi-airpurifier-v7_miio357210272 (Zhimi Air Purifier v7)
 *   - yeelink-light-ceiling1_miio12345678 (Yeelight Ceiling Light)
 *   - chuangmi-plug-m1_miio87654321 (Chuangmi Smart Plug M1)
 * 
 * Known brand prefixes (Xiaomi ecosystem brands):
 * - zhimi: Air purifiers, humidifiers, fans
 * - yeelink: Smart lights (Yeelight)
 * - chuangmi: Smart plugs, cameras
 * - viomi: Kitchen appliances, vacuum cleaners
 * - dmaker: Fans
 * - roborock: Robot vacuums
 * - rockrobo: Robot vacuums
 * - lumi: Sensors, gateways (Aqara)
 * - dreame: Vacuums, hair dryers
 * - roidmi: Vacuums, air purifiers
 * - philips: Philips-branded Xiaomi lights
 */
function parseMiioDevice(
  _serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  // Extract MAC from TXT properties
  const mac = txtProperties['mac'] || null;
  const epoch = txtProperties['epoch'] || null;
  
  if (mac) metadata['mac'] = mac;
  if (epoch) metadata['epoch'] = epoch;
  
  // Parse the instance name format: {brand}-{devicetype}-{version}_miio{deviceid}
  // Example: zhimi-airpurifier-v7_miio357210272
  let deviceType: string | null = null;
  let model: string | null = null;
  let manufacturer: string = 'Xiaomi';
  
  // Split by _miio to separate device info from device ID
  const miioSplit = instanceName.split('_miio');
  const devicePart = miioSplit[0];
  const deviceId = miioSplit[1] || null;
  
  if (deviceId) {
    metadata['deviceId'] = deviceId;
  }
  
  // Parse the device part: {brand}-{devicetype}-{version}
  // Handle cases with and without version
  const parts = devicePart.split('-');
  const brand = parts[0]?.toLowerCase() || '';
  
  // Map brand prefixes to manufacturer names and descriptions
  const brandMap: Record<string, { manufacturer: string; brandName: string }> = {
    'zhimi': { manufacturer: 'Xiaomi', brandName: 'Zhimi' },
    'yeelink': { manufacturer: 'Xiaomi', brandName: 'Yeelight' },
    'chuangmi': { manufacturer: 'Xiaomi', brandName: 'Chuangmi' },
    'viomi': { manufacturer: 'Viomi', brandName: 'Viomi' },
    'dmaker': { manufacturer: 'Xiaomi', brandName: 'Dmaker' },
    'roborock': { manufacturer: 'Roborock', brandName: 'Roborock' },
    'rockrobo': { manufacturer: 'Roborock', brandName: 'Roborock' },
    'lumi': { manufacturer: 'Aqara', brandName: 'Aqara' },
    'dreame': { manufacturer: 'Dreame', brandName: 'Dreame' },
    'roidmi': { manufacturer: 'Roidmi', brandName: 'Roidmi' },
    'philips': { manufacturer: 'Philips', brandName: 'Philips' },
    'xiaomi': { manufacturer: 'Xiaomi', brandName: 'Xiaomi' },
    'chunmi': { manufacturer: 'Xiaomi', brandName: 'Chunmi' },
    'qmi': { manufacturer: 'Xiaomi', brandName: 'Xiaomi' },
  };
  
  const brandInfo = brandMap[brand];
  if (brandInfo) {
    manufacturer = brandInfo.manufacturer;
    metadata['brand'] = brandInfo.brandName;
  } else if (brand) {
    // Unknown brand, still likely a Xiaomi ecosystem device
    metadata['brand'] = brand;
  }
  
  // Map device type keywords to human-readable names
  const deviceTypeMap: Record<string, string> = {
    'airpurifier': 'Air Purifier',
    'air-purifier': 'Air Purifier',
    'humidifier': 'Humidifier',
    'vacuum': 'Robot Vacuum',
    'light': 'Smart Light',
    'lamp': 'Smart Lamp',
    'ceiling': 'Ceiling Light',
    'bslamp': 'Bedside Lamp',
    'mono': 'Smart Light',
    'ct': 'Color Temperature Light',
    'color': 'Color Light',
    'strip': 'Light Strip',
    'plug': 'Smart Plug',
    'switch': 'Smart Switch',
    'gateway': 'Gateway',
    'sensor': 'Sensor',
    'fan': 'Smart Fan',
    'heater': 'Heater',
    'cooker': 'Rice Cooker',
    'kettle': 'Smart Kettle',
    'dishwasher': 'Dishwasher',
    'washer': 'Washing Machine',
    'camera': 'Camera',
    'cateye': 'Video Doorbell',
    'airfresh': 'Air Fresh System',
    'dehumidifier': 'Dehumidifier',
    'airmonitor': 'Air Quality Monitor',
    'waterheater': 'Water Heater',
    'ir': 'IR Controller',
    'remote': 'Remote',
    'curtain': 'Smart Curtain',
    'lock': 'Smart Lock',
  };
  
  // Extract device type from parts (usually the second part)
  if (parts.length >= 2) {
    const typeKey = parts[1].toLowerCase();
    deviceType = deviceTypeMap[typeKey] || null;
    
    // Build model string from parts (excluding brand)
    const modelParts = parts.slice(1);
    model = modelParts.map(p => {
      // Capitalize first letter of each part
      if (p.match(/^v\d+/)) return p.toUpperCase(); // Version like v7 -> V7
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
    
    // Clean up model name
    if (model) {
      // Remove redundant spacing
      model = model.replace(/\s+/g, ' ').trim();
    }
  }
  
  // If we couldn't determine device type, try to infer from the full device part
  if (!deviceType) {
    const lowerDevicePart = devicePart.toLowerCase();
    for (const [keyword, typeName] of Object.entries(deviceTypeMap)) {
      if (lowerDevicePart.includes(keyword)) {
        deviceType = typeName;
        break;
      }
    }
  }
  
  // Default device type if still unknown
  if (!deviceType) {
    deviceType = 'Mi IoT Device';
  }
  
  return {
    deviceType,
    manufacturer,
    model,
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
 * Parse Aqara device information
 * Service types: _aqara-setup._tcp.local., _aqara-fp2._tcp.local., etc.
 * 
 * Aqara devices are part of the Xiaomi/Lumi ecosystem and expose useful info:
 * - mac: MAC address
 * - serialNumber: Serial number
 * - id: Lumi device ID (format: lumi1.{hex_mac})
 * - ver: Version
 * 
 * Known Aqara model prefixes (from HomeKit 'md' field):
 * - PS-S02D: Presence Sensor FP2
 * - PS-S02: Presence Sensor FP1
 * - RTCGQ12LM: Motion Sensor P1
 * - RTCGQ14LM: Motion Sensor E1
 * - MCCGQ11LM: Door/Window Sensor
 * - MCCGQ14LM: Door/Window Sensor E1
 * - WSDCGQ11LM: Temperature & Humidity Sensor
 * - SJCGQ11LM: Water Leak Sensor
 * - LLKZMK11LM: Two-way Control Module
 * - QBKG03LM: Wall Switch (Double Rocker)
 * - DJT11LM: Vibration Sensor
 */
function parseAqaraDevice(
  serviceType: string,
  txtProperties: Record<string, string>,
  instanceName: string
): DeviceInfo {
  const metadata: Record<string, string> = {};
  
  // Extract common Aqara TXT properties
  const mac = txtProperties['mac'] || null;
  const serialNumber = txtProperties['serialNumber'] || txtProperties['sn'] || null;
  const lumiId = txtProperties['id'] || null;
  const version = txtProperties['ver'] || null;
  const setupId = txtProperties['setupid'] || null;
  const mnid = txtProperties['mnid'] || null;
  
  if (mac) metadata['mac'] = mac;
  if (serialNumber) metadata['serialNumber'] = serialNumber;
  if (lumiId) metadata['lumiId'] = lumiId;
  if (version) metadata['version'] = version;
  if (setupId) metadata['setupId'] = setupId;
  if (mnid) metadata['manufacturerId'] = mnid;
  
  // Try to determine device type from service type or instance name
  let deviceType = 'Aqara Device';
  let model: string | null = null;
  
  const serviceTypeLower = serviceType.toLowerCase();
  const instanceLower = instanceName.toLowerCase();
  
  // Map known Aqara device service types to human-readable names
  if (serviceTypeLower.includes('fp2') || instanceLower.includes('fp2')) {
    deviceType = 'Presence Sensor';
    model = 'FP2';
  } else if (serviceTypeLower.includes('fp1') || instanceLower.includes('fp1')) {
    deviceType = 'Presence Sensor';
    model = 'FP1';
  } else if (instanceLower.includes('presence') || instanceLower.includes('presence-sensor')) {
    deviceType = 'Presence Sensor';
  } else if (instanceLower.includes('motion')) {
    deviceType = 'Motion Sensor';
  } else if (instanceLower.includes('door') || instanceLower.includes('window')) {
    deviceType = 'Door/Window Sensor';
  } else if (instanceLower.includes('temperature') || instanceLower.includes('humidity')) {
    deviceType = 'Temperature & Humidity Sensor';
  } else if (instanceLower.includes('leak') || instanceLower.includes('water')) {
    deviceType = 'Water Leak Sensor';
  } else if (instanceLower.includes('switch')) {
    deviceType = 'Smart Switch';
  } else if (instanceLower.includes('plug')) {
    deviceType = 'Smart Plug';
  } else if (instanceLower.includes('hub') || instanceLower.includes('gateway')) {
    deviceType = 'Gateway';
  } else if (instanceLower.includes('cube')) {
    deviceType = 'Magic Cube';
  } else if (instanceLower.includes('vibration')) {
    deviceType = 'Vibration Sensor';
  } else if (instanceLower.includes('camera')) {
    deviceType = 'Camera';
  } else if (instanceLower.includes('lock')) {
    deviceType = 'Smart Lock';
  } else if (instanceLower.includes('curtain') || instanceLower.includes('blind')) {
    deviceType = 'Smart Curtain';
  }
  
  return {
    deviceType,
    manufacturer: 'Aqara',
    model,
    metadata,
  };
}

/**
 * Aqara model code mapping
 * Maps HomeKit model codes (from 'md' TXT property) to human-readable info
 */
const aqaraModelMap: Record<string, { name: string; type: string }> = {
  // Presence Sensors
  'PS-S02D': { name: 'Presence Sensor FP2', type: 'Presence Sensor' },
  'PS-S02': { name: 'Presence Sensor FP1', type: 'Presence Sensor' },
  // Motion Sensors
  'RTCGQ12LM': { name: 'Motion Sensor P1', type: 'Motion Sensor' },
  'RTCGQ14LM': { name: 'Motion Sensor E1', type: 'Motion Sensor' },
  'RTCGQ15LM': { name: 'Motion Sensor P2', type: 'Motion Sensor' },
  'RTCGQ01LM': { name: 'Motion Sensor', type: 'Motion Sensor' },
  'RTCGQ11LM': { name: 'Motion Sensor', type: 'Motion Sensor' },
  // Door/Window Sensors
  'MCCGQ11LM': { name: 'Door/Window Sensor', type: 'Door/Window Sensor' },
  'MCCGQ12LM': { name: 'Door/Window Sensor P1', type: 'Door/Window Sensor' },
  'MCCGQ14LM': { name: 'Door/Window Sensor E1', type: 'Door/Window Sensor' },
  // Temperature & Humidity Sensors
  'WSDCGQ11LM': { name: 'Temperature & Humidity Sensor', type: 'Climate Sensor' },
  'WSDCGQ12LM': { name: 'Temperature & Humidity Sensor T1', type: 'Climate Sensor' },
  // Water Leak Sensors
  'SJCGQ11LM': { name: 'Water Leak Sensor', type: 'Water Leak Sensor' },
  'SJCGQ13LM': { name: 'Water Leak Sensor E1', type: 'Water Leak Sensor' },
  // Vibration Sensors
  'DJT11LM': { name: 'Vibration Sensor', type: 'Vibration Sensor' },
  'DJT12LM': { name: 'Vibration Sensor T1', type: 'Vibration Sensor' },
  // Switches
  'QBKG03LM': { name: 'Wall Switch (Double)', type: 'Smart Switch' },
  'QBKG04LM': { name: 'Wall Switch (Single)', type: 'Smart Switch' },
  'QBKG11LM': { name: 'Wall Switch (Single, Neutral)', type: 'Smart Switch' },
  'QBKG12LM': { name: 'Wall Switch (Double, Neutral)', type: 'Smart Switch' },
  'QBKG21LM': { name: 'Wall Switch H1 (Single)', type: 'Smart Switch' },
  'QBKG22LM': { name: 'Wall Switch H1 (Double)', type: 'Smart Switch' },
  'WS-EUK01': { name: 'Wall Switch H1 EU (Single)', type: 'Smart Switch' },
  'WS-EUK02': { name: 'Wall Switch H1 EU (Double)', type: 'Smart Switch' },
  'WS-EUK03': { name: 'Wall Switch H1 EU (Triple)', type: 'Smart Switch' },
  'WS-EUK04': { name: 'Wall Switch H1 EU (Quad)', type: 'Smart Switch' },
  'WXKG11LM': { name: 'Wireless Mini Switch', type: 'Wireless Switch' },
  'WXKG12LM': { name: 'Wireless Mini Switch T1', type: 'Wireless Switch' },
  // Plugs
  'SP-EUC01': { name: 'Smart Plug EU', type: 'Smart Plug' },
  'ZNCZ02LM': { name: 'Smart Plug (Zigbee)', type: 'Smart Plug' },
  'ZNCZ04LM': { name: 'Smart Plug (USB)', type: 'Smart Plug' },
  'ZNCZ12LM': { name: 'Smart Plug (EU)', type: 'Smart Plug' },
  // Control Modules
  'LLKZMK11LM': { name: 'Two-way Control Module', type: 'Relay Module' },
  'SSM-U01': { name: 'Single Switch Module T1 (No Neutral)', type: 'Relay Module' },
  'SSM-U02': { name: 'Single Switch Module T1 (With Neutral)', type: 'Relay Module' },
  'DCM-K01': { name: 'Dual Relay Module T2', type: 'Relay Module' },
  // Dimmers
  'ZNDDMK11LM': { name: 'Dimmer T1', type: 'Dimmer' },
  // Curtain Controllers
  'ZNCLDJ11LM': { name: 'Curtain Controller', type: 'Smart Curtain' },
  'ZNCLDJ12LM': { name: 'Curtain Controller B1', type: 'Smart Curtain' },
  'ZNCLBL01LM': { name: 'Roller Shade Driver E1', type: 'Smart Blind' },
  // Hubs/Gateways
  'ZHWG11LM': { name: 'Hub E1', type: 'Gateway' },
  'ZHWG15LM': { name: 'Hub M1S', type: 'Gateway' },
  'ZHWG16LM': { name: 'Hub M2', type: 'Gateway' },
  'ZNGW01LM': { name: 'Gateway', type: 'Gateway' },
  // Cameras
  'CH-C01D': { name: 'Camera Hub G2H', type: 'Camera' },
  'CH-H01D': { name: 'Camera Hub G2H Pro', type: 'Camera' },
  'CH-H03D': { name: 'Camera Hub G3', type: 'Camera' },
  // Cube
  'MFKZQ01LM': { name: 'Cube', type: 'Magic Cube' },
  // Thermostat
  'SRTS-A01': { name: 'Smart Radiator Thermostat E1', type: 'Thermostat' },
  // Smoke/Gas Detectors
  'JY-GZ-01AQ': { name: 'Smart Smoke Detector', type: 'Smoke Detector' },
  'JY-GZ-02AQ': { name: 'Natural Gas Detector', type: 'Gas Detector' },
  // Pet Feeder
  'ZNCWWSQ01LM': { name: 'Smart Pet Feeder C1', type: 'Pet Feeder' },
  // LED Controller
  'ZNLDP12LM': { name: 'LED Controller T1', type: 'LED Controller' },
  // Air Quality
  'VOCKQJK11LM': { name: 'TVOC Air Quality Monitor', type: 'Air Quality Monitor' },
};

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
registerServiceTypeParser('_miio._udp.local.', parseMiioDevice);

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
