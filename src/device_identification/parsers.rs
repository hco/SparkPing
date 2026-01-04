//! Device parsers for various service types and vendors.
//!
//! This module contains the logic for parsing device information from
//! mDNS services, TXT records, and vendor-specific information.

use super::DeviceInfo;
use crate::discovery::DiscoveredService;
use crate::vendor_discovery::VendorInfo;
use std::collections::HashMap;
use tracing::debug;

/// Parsed device information from a single parser
#[derive(Debug, Default)]
struct ParsedInfo {
    device_type: Option<String>,
    manufacturer: Option<String>,
    model: Option<String>,
    firmware_version: Option<String>,
    mac_address: Option<String>,
    friendly_name: Option<String>,
    icon_hint: Option<String>,
}

impl ParsedInfo {
    fn is_empty(&self) -> bool {
        self.device_type.is_none()
            && self.manufacturer.is_none()
            && self.model.is_none()
            && self.firmware_version.is_none()
            && self.mac_address.is_none()
            && self.friendly_name.is_none()
            && self.icon_hint.is_none()
    }
}

/// Identify a device based on its services, TXT properties, and vendor info
pub fn identify_device(
    name: &str,
    primary_address: &str,
    addresses: &[String],
    hostname: Option<&str>,
    services: &[DiscoveredService],
    txt_properties: &HashMap<String, String>,
    vendor_info: Option<&VendorInfo>,
) -> DeviceInfo {
    let mut info = DeviceInfo::new(
        name.to_string(),
        primary_address.to_string(),
        addresses.to_vec(),
    );
    info.hostname = hostname.map(|s| s.to_string());

    // First, try vendor-specific parsing (highest priority)
    if let Some(vendor) = vendor_info {
        let vendor_parsed = parse_vendor_info(vendor);
        apply_parsed_info(&mut info, &vendor_parsed);
    }

    // Then parse each service
    for service in services {
        let service_parsed = parse_service(service);
        if !service_parsed.is_empty() {
            apply_parsed_info(&mut info, &service_parsed);
        }
    }

    // Finally, try to extract info from combined TXT properties
    let txt_parsed = parse_txt_properties(txt_properties);
    apply_parsed_info(&mut info, &txt_parsed);

    // If no icon hint was set, derive it from manufacturer
    if info.icon_hint.is_none() {
        info.icon_hint = derive_icon_hint(&info);
    }

    debug!(
        "Identified device: {} (type: {:?}, manufacturer: {:?}, model: {:?})",
        info.name, info.device_type, info.manufacturer, info.model
    );

    info
}

fn apply_parsed_info(info: &mut DeviceInfo, parsed: &ParsedInfo) {
    if info.device_type.is_none() && parsed.device_type.is_some() {
        info.device_type = parsed.device_type.clone();
    }
    if info.manufacturer.is_none() && parsed.manufacturer.is_some() {
        info.manufacturer = parsed.manufacturer.clone();
    }
    if info.model.is_none() && parsed.model.is_some() {
        info.model = parsed.model.clone();
    }
    if info.firmware_version.is_none() && parsed.firmware_version.is_some() {
        info.firmware_version = parsed.firmware_version.clone();
    }
    if info.mac_address.is_none() && parsed.mac_address.is_some() {
        info.mac_address = parsed.mac_address.clone();
    }
    if info.friendly_name.is_none() && parsed.friendly_name.is_some() {
        info.friendly_name = parsed.friendly_name.clone();
    }
    if info.icon_hint.is_none() && parsed.icon_hint.is_some() {
        info.icon_hint = parsed.icon_hint.clone();
    }
}

fn derive_icon_hint(info: &DeviceInfo) -> Option<String> {
    // Derive icon hint from manufacturer or device type
    if let Some(ref manufacturer) = info.manufacturer {
        let hint = manufacturer.to_lowercase();
        return Some(match hint.as_str() {
            "apple" | "apple inc." | "apple inc" => "apple".to_string(),
            "google" | "google inc." | "google llc" => "google".to_string(),
            "sonos" | "sonos, inc." => "sonos".to_string(),
            "philips" | "signify" => "philips".to_string(),
            "xiaomi" | "xiaomi inc." => "xiaomi".to_string(),
            "aqara" | "lumi" => "aqara".to_string(),
            "shelly" | "allterco" => "shelly".to_string(),
            "espressif" | "esphome" => "esphome".to_string(),
            "roborock" => "roborock".to_string(),
            "wiz" => "wiz".to_string(),
            "samsung" => "samsung".to_string(),
            "amazon" => "amazon".to_string(),
            "hp" | "hewlett-packard" | "hewlett packard" => "hp".to_string(),
            "epson" => "epson".to_string(),
            "canon" => "canon".to_string(),
            "brother" => "brother".to_string(),
            _ => hint,
        });
    }

    // Try device type as fallback
    if let Some(ref device_type) = info.device_type {
        let dt = device_type.to_lowercase();
        if dt.contains("printer") {
            return Some("printer".to_string());
        }
        if dt.contains("speaker") || dt.contains("audio") {
            return Some("speaker".to_string());
        }
        if dt.contains("light") || dt.contains("bulb") {
            return Some("light".to_string());
        }
        if dt.contains("camera") {
            return Some("camera".to_string());
        }
        if dt.contains("router") || dt.contains("gateway") {
            return Some("router".to_string());
        }
    }

    None
}

/// Parse vendor-specific information
fn parse_vendor_info(vendor_info: &VendorInfo) -> ParsedInfo {
    match vendor_info {
        VendorInfo::Sonos(sonos) => ParsedInfo {
            device_type: Some("Smart Speaker".to_string()),
            manufacturer: Some("Sonos".to_string()),
            model: sonos.model_name.clone().or(sonos.series_id.clone()),
            firmware_version: sonos
                .display_version
                .clone()
                .or(sonos.software_version.clone()),
            mac_address: sonos.mac_address.clone(),
            friendly_name: Some(sonos.zone_name.clone()),
            icon_hint: Some("sonos".to_string()),
        },
    }
}

/// Parse a single mDNS service
fn parse_service(service: &DiscoveredService) -> ParsedInfo {
    let service_type = service.service_type.to_lowercase();
    let txt = &service.txt_properties;
    let instance_name = &service.instance_name;

    // Match service type to appropriate parser
    if service_type.contains("_hap._tcp") || service_type.contains("_homekit._tcp") {
        return parse_homekit(txt);
    }
    if service_type.contains("_airplay._tcp") || service_type.contains("_raop._tcp") {
        return parse_airplay(txt);
    }
    if service_type.contains("_googlecast._tcp") {
        return parse_chromecast(txt);
    }
    if service_type.contains("_ipp._tcp")
        || service_type.contains("_printer._tcp")
        || service_type.contains("_pdl-datastream._tcp")
    {
        return parse_printer(txt);
    }
    if service_type.contains("_sonos._tcp") {
        return parse_sonos(txt);
    }
    if service_type.contains("_shelly._tcp") {
        return parse_shelly(txt);
    }
    if service_type.contains("_esphomelib._tcp") {
        return parse_esphome(txt, instance_name);
    }
    if service_type.contains("_spotify-connect._tcp") {
        return parse_spotify_connect(instance_name);
    }
    if service_type.contains("_hue._tcp") {
        return parse_hue(txt, instance_name);
    }
    if service_type.contains("_wiz._udp") {
        return parse_wiz(txt, instance_name);
    }
    if service_type.contains("_miio._udp") {
        return parse_miio(txt, instance_name);
    }
    if service_type.contains("_aqara") {
        return parse_aqara(&service_type, txt, instance_name);
    }
    if service_type.contains("_http._tcp") || service_type.contains("_https._tcp") {
        return parse_http_service(txt, instance_name);
    }

    ParsedInfo::default()
}

/// Parse combined TXT properties
fn parse_txt_properties(txt: &HashMap<String, String>) -> ParsedInfo {
    let mut info = ParsedInfo::default();

    // Try to extract manufacturer
    info.manufacturer = txt
        .get("manufacturer")
        .or_else(|| txt.get("mfr"))
        .or_else(|| txt.get("vendor"))
        .cloned();

    // Try to extract model
    if info.model.is_none() {
        info.model = txt
            .get("model")
            .or_else(|| txt.get("md"))
            .or_else(|| txt.get("product"))
            .cloned();
    }

    // Try to extract MAC address
    if info.mac_address.is_none() {
        info.mac_address = txt.get("mac").or_else(|| txt.get("macAddress")).cloned();
    }

    // Try to extract firmware version
    if info.firmware_version.is_none() {
        info.firmware_version = txt
            .get("version")
            .or_else(|| txt.get("ver"))
            .or_else(|| txt.get("fw"))
            .or_else(|| txt.get("fwVersion"))
            .cloned();
    }

    info
}

// ============================================================================
// Service-specific parsers
// ============================================================================

/// Parse HomeKit device information
fn parse_homekit(txt: &HashMap<String, String>) -> ParsedInfo {
    let model = txt.get("md").or_else(|| txt.get("model")).cloned();
    let category_id = txt.get("ci");

    // Map category ID to device type name
    let device_type = category_id.and_then(|ci| {
        Some(
            match ci.as_str() {
                "1" => "Other",
                "2" => "Bridge",
                "3" => "Fan",
                "4" => "Garage Door Opener",
                "5" => "Lightbulb",
                "6" => "Door Lock",
                "7" => "Outlet",
                "8" => "Switch",
                "9" => "Thermostat",
                "10" => "Sensor",
                "11" => "Security System",
                "12" => "Door",
                "13" => "Window",
                "14" => "Window Covering",
                "15" => "Programmable Switch",
                "16" => "Range Extender",
                "17" => "IP Camera",
                "18" => "Video Doorbell",
                "19" => "Air Purifier",
                "20" => "Heater",
                "21" => "Air Conditioner",
                "22" => "Humidifier",
                "23" => "Dehumidifier",
                _ => "HomeKit Device",
            }
            .to_string(),
        )
    });

    ParsedInfo {
        device_type: device_type.or(Some("HomeKit Device".to_string())),
        model,
        icon_hint: Some("homekit".to_string()),
        ..Default::default()
    }
}

/// Parse AirPlay device information
fn parse_airplay(txt: &HashMap<String, String>) -> ParsedInfo {
    let model = txt.get("model").or_else(|| txt.get("md")).cloned();
    let manufacturer = txt
        .get("manufacturer")
        .or_else(|| txt.get("mfr"))
        .cloned()
        .or_else(|| Some("Apple".to_string())); // Default to Apple for AirPlay
    let firmware = txt.get("osvers").or_else(|| txt.get("srcvers")).cloned();

    ParsedInfo {
        device_type: Some("AirPlay".to_string()),
        manufacturer,
        model,
        firmware_version: firmware,
        icon_hint: Some("apple".to_string()),
        ..Default::default()
    }
}

/// Parse Chromecast/Google Cast device information
fn parse_chromecast(txt: &HashMap<String, String>) -> ParsedInfo {
    let model = txt.get("md").or_else(|| txt.get("model")).cloned();
    let room_name = txt.get("rm").cloned();
    let version = txt.get("ve").cloned();

    // Try to extract device type from model name
    let device_type = model.as_ref().map(|m| {
        let model_lower = m.to_lowercase();
        if model_lower.contains("chromecast") {
            "Chromecast".to_string()
        } else if model_lower.contains("nest") {
            "Google Nest".to_string()
        } else if model_lower.contains("home") {
            "Google Home".to_string()
        } else {
            "Chromecast".to_string()
        }
    });

    ParsedInfo {
        device_type: device_type.or(Some("Chromecast".to_string())),
        manufacturer: Some("Google".to_string()),
        model,
        firmware_version: version,
        friendly_name: room_name,
        icon_hint: Some("google".to_string()),
        ..Default::default()
    }
}

/// Parse printer device information
fn parse_printer(txt: &HashMap<String, String>) -> ParsedInfo {
    let ty = txt.get("ty").cloned();
    let product = txt
        .get("product")
        .or_else(|| txt.get("model"))
        .or_else(|| txt.get("md"))
        .cloned();

    // Extract manufacturer from 'ty' field if it contains manufacturer info
    let (manufacturer, model) = if let Some(ref ty_val) = ty {
        let parts: Vec<&str> = ty_val.splitn(2, ' ').collect();
        if parts.len() > 1 {
            (Some(parts[0].to_string()), Some(parts[1].to_string()))
        } else {
            (
                txt.get("manufacturer").or_else(|| txt.get("mfr")).cloned(),
                product,
            )
        }
    } else {
        (
            txt.get("manufacturer").or_else(|| txt.get("mfr")).cloned(),
            product,
        )
    };

    ParsedInfo {
        device_type: Some("Printer".to_string()),
        manufacturer,
        model,
        icon_hint: Some("printer".to_string()),
        ..Default::default()
    }
}

/// Parse Sonos device information (from mDNS, fallback when vendor_info not available)
fn parse_sonos(txt: &HashMap<String, String>) -> ParsedInfo {
    let model = txt.get("model").or_else(|| txt.get("md")).cloned();
    let version = txt.get("version").or_else(|| txt.get("ve")).cloned();

    ParsedInfo {
        device_type: Some("Smart Speaker".to_string()),
        manufacturer: Some("Sonos".to_string()),
        model,
        firmware_version: version,
        icon_hint: Some("sonos".to_string()),
        ..Default::default()
    }
}

/// Parse Shelly device information
fn parse_shelly(txt: &HashMap<String, String>) -> ParsedInfo {
    let app_code = txt.get("app").cloned();
    let generation = txt.get("gen").cloned();
    let version = txt.get("ver").cloned();

    // Map Shelly app codes to human-readable model names
    let model_name = app_code.as_ref().map(|code| {
        match code.as_str() {
            // Gen 3
            "PlugSG3" => "Plug S Gen 3",
            "MiniG3" => "Mini Gen 3",
            "Mini1G3" => "1PM Mini Gen 3",
            "1G3" => "1 Gen 3",
            "1PMG3" => "1PM Gen 3",
            "2PMG3" => "2PM Gen 3",
            // Gen 2 / Plus
            "PlusPlugS" => "Plus Plug S",
            "PlusPlugUS" => "Plus Plug US",
            "Plus1" => "Plus 1",
            "Plus1PM" => "Plus 1PM",
            "Plus2PM" => "Plus 2PM",
            "PlusI4" => "Plus i4",
            "PlusHT" => "Plus H&T",
            // Pro
            "Pro1" => "Pro 1",
            "Pro1PM" => "Pro 1PM",
            "Pro2" => "Pro 2",
            "Pro2PM" => "Pro 2PM",
            "Pro3" => "Pro 3",
            "Pro4PM" => "Pro 4PM",
            // Gen 1
            "1" => "1",
            "1L" => "1L",
            "1PM" => "1PM",
            "25" => "2.5",
            "Plug" => "Plug",
            "PlugS" => "Plug S",
            "Dimmer" => "Dimmer",
            "RGBW2" => "RGBW2",
            "Bulb" => "Bulb",
            "EM" => "EM",
            "3EM" => "3EM",
            "HT" => "H&T",
            _ => code.as_str(),
        }
        .to_string()
    });

    let device_type = model_name.as_ref().map(|m| format!("Shelly {}", m));

    ParsedInfo {
        device_type,
        manufacturer: Some("Shelly".to_string()),
        model: model_name,
        firmware_version: version.or(generation.map(|g| format!("Gen {}", g))),
        icon_hint: Some("shelly".to_string()),
        ..Default::default()
    }
}

/// Parse ESPHome device information
fn parse_esphome(txt: &HashMap<String, String>, instance_name: &str) -> ParsedInfo {
    let version = txt.get("version").or_else(|| txt.get("ve")).cloned();
    let project_name = txt
        .get("project_name")
        .or_else(|| txt.get("projectName"))
        .cloned();
    let friendly_name = txt
        .get("friendly_name")
        .or_else(|| txt.get("friendlyName"))
        .cloned();

    ParsedInfo {
        device_type: Some("ESPHome".to_string()),
        manufacturer: Some("ESPHome".to_string()),
        model: project_name.or_else(|| Some(instance_name.to_string())),
        firmware_version: version,
        friendly_name,
        icon_hint: Some("esphome".to_string()),
        ..Default::default()
    }
}

/// Parse Spotify Connect device information
fn parse_spotify_connect(instance_name: &str) -> ParsedInfo {
    ParsedInfo {
        device_type: Some("Spotify Connect".to_string()),
        manufacturer: Some("Spotify".to_string()),
        model: Some(instance_name.to_string()),
        icon_hint: Some("spotify".to_string()),
        ..Default::default()
    }
}

/// Parse Philips Hue device information
fn parse_hue(txt: &HashMap<String, String>, instance_name: &str) -> ParsedInfo {
    let model_id = txt.get("modelid").cloned();

    // Map Hue model IDs to human-readable model names
    let (device_type, model) = match model_id.as_deref() {
        Some("BSB001") => ("Smart Home Hub", "Hue Bridge v1"),
        Some("BSB002") => ("Smart Home Hub", "Hue Bridge v2"),
        Some("BSB003") => ("Smart Home Hub", "Hue Bridge Pro"),
        Some("HSB001" | "HSB1") => ("HDMI Sync Box", "Hue Play HDMI Sync Box"),
        Some("HSB002" | "HSB2") => ("HDMI Sync Box", "Hue Play HDMI Sync Box 8K"),
        Some(id) if id.starts_with("BSB") => ("Smart Home Hub", "Hue Bridge"),
        Some(id) if id.starts_with("HSB") => ("HDMI Sync Box", "Hue Sync Box"),
        _ => {
            // Try to infer from instance name
            let name_lower = instance_name.to_lowercase();
            if name_lower.contains("bridge") {
                ("Smart Home Hub", "Hue Bridge")
            } else if name_lower.contains("sync") {
                ("HDMI Sync Box", "Hue Sync Box")
            } else {
                ("Hue Device", "Hue Device")
            }
        }
    };

    ParsedInfo {
        device_type: Some(device_type.to_string()),
        manufacturer: Some("Philips".to_string()),
        model: Some(model.to_string()),
        icon_hint: Some("philips".to_string()),
        ..Default::default()
    }
}

/// Parse WiZ smart light information
fn parse_wiz(txt: &HashMap<String, String>, instance_name: &str) -> ParsedInfo {
    let mac = txt.get("mac").cloned();
    let module_id = txt
        .get("moduleName")
        .or_else(|| txt.get("module"))
        .cloned();
    let fw_version = txt.get("fwVersion").or_else(|| txt.get("fw")).cloned();

    let name_lower = instance_name.to_lowercase();
    let device_type = if name_lower.contains("plug") || name_lower.contains("socket") {
        "Smart Plug"
    } else if name_lower.contains("strip") {
        "Light Strip"
    } else {
        "Smart Light"
    };

    ParsedInfo {
        device_type: Some(device_type.to_string()),
        manufacturer: Some("WiZ".to_string()),
        model: module_id,
        firmware_version: fw_version,
        mac_address: mac,
        icon_hint: Some("wiz".to_string()),
        ..Default::default()
    }
}

/// Parse Xiaomi Mi IoT (miio) device information
fn parse_miio(txt: &HashMap<String, String>, instance_name: &str) -> ParsedInfo {
    let mac = txt.get("mac").cloned();

    // Parse the instance name format: {brand}-{devicetype}-{version}_miio{deviceid}
    let miio_split: Vec<&str> = instance_name.split("_miio").collect();
    let device_part = miio_split.first().unwrap_or(&"");
    let parts: Vec<&str> = device_part.split('-').collect();
    let brand = parts.first().map(|s| s.to_lowercase());

    // Map brand prefixes to manufacturer names
    let manufacturer = brand.as_ref().map(|b| {
        match b.as_str() {
            "zhimi" | "chuangmi" | "dmaker" | "chunmi" | "qmi" | "xiaomi" => "Xiaomi",
            "yeelink" => "Yeelight",
            "viomi" => "Viomi",
            "roborock" | "rockrobo" => "Roborock",
            "lumi" => "Aqara",
            "dreame" => "Dreame",
            "roidmi" => "Roidmi",
            "philips" => "Philips",
            _ => "Xiaomi",
        }
        .to_string()
    });

    // Map device type keywords to human-readable names
    let device_type = if parts.len() >= 2 {
        let type_key = parts[1].to_lowercase();
        Some(
            match type_key.as_str() {
                "airpurifier" | "air-purifier" => "Air Purifier",
                "humidifier" => "Humidifier",
                "vacuum" => "Robot Vacuum",
                "light" | "lamp" | "ceiling" | "bslamp" | "mono" | "ct" | "color" => "Smart Light",
                "strip" => "Light Strip",
                "plug" => "Smart Plug",
                "switch" => "Smart Switch",
                "gateway" => "Gateway",
                "sensor" => "Sensor",
                "fan" => "Smart Fan",
                "heater" => "Heater",
                "cooker" => "Rice Cooker",
                "kettle" => "Smart Kettle",
                "camera" => "Camera",
                "cateye" => "Video Doorbell",
                "airfresh" => "Air Fresh System",
                "dehumidifier" => "Dehumidifier",
                "curtain" => "Smart Curtain",
                "lock" => "Smart Lock",
                _ => "Mi IoT Device",
            }
            .to_string(),
        )
    } else {
        Some("Mi IoT Device".to_string())
    };

    // Build model string from parts
    let model = if parts.len() > 1 {
        let model_parts: Vec<String> = parts[1..]
            .iter()
            .map(|p| {
                if p.starts_with('v') && p[1..].chars().all(|c| c.is_ascii_digit()) {
                    p.to_uppercase()
                } else {
                    let mut chars = p.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                }
            })
            .collect();
        Some(model_parts.join(" "))
    } else {
        None
    };

    ParsedInfo {
        device_type,
        manufacturer,
        model,
        mac_address: mac,
        icon_hint: Some("xiaomi".to_string()),
        ..Default::default()
    }
}

/// Parse Aqara device information
fn parse_aqara(service_type: &str, txt: &HashMap<String, String>, instance_name: &str) -> ParsedInfo {
    let mac = txt.get("mac").cloned();
    let version = txt.get("ver").cloned();

    let service_lower = service_type.to_lowercase();
    let instance_lower = instance_name.to_lowercase();

    let (device_type, model) = if service_lower.contains("fp2") || instance_lower.contains("fp2") {
        ("Presence Sensor", Some("FP2"))
    } else if service_lower.contains("fp1") || instance_lower.contains("fp1") {
        ("Presence Sensor", Some("FP1"))
    } else if instance_lower.contains("presence") {
        ("Presence Sensor", None)
    } else if instance_lower.contains("motion") {
        ("Motion Sensor", None)
    } else if instance_lower.contains("door") || instance_lower.contains("window") {
        ("Door/Window Sensor", None)
    } else if instance_lower.contains("temperature") || instance_lower.contains("humidity") {
        ("Temperature & Humidity Sensor", None)
    } else if instance_lower.contains("leak") || instance_lower.contains("water") {
        ("Water Leak Sensor", None)
    } else if instance_lower.contains("switch") {
        ("Smart Switch", None)
    } else if instance_lower.contains("plug") {
        ("Smart Plug", None)
    } else if instance_lower.contains("hub") || instance_lower.contains("gateway") {
        ("Gateway", None)
    } else if instance_lower.contains("cube") {
        ("Magic Cube", None)
    } else if instance_lower.contains("vibration") {
        ("Vibration Sensor", None)
    } else if instance_lower.contains("camera") {
        ("Camera", None)
    } else if instance_lower.contains("lock") {
        ("Smart Lock", None)
    } else if instance_lower.contains("curtain") || instance_lower.contains("blind") {
        ("Smart Curtain", None)
    } else {
        ("Aqara Device", None)
    };

    ParsedInfo {
        device_type: Some(device_type.to_string()),
        manufacturer: Some("Aqara".to_string()),
        model: model.map(|s| s.to_string()),
        firmware_version: version,
        mac_address: mac,
        icon_hint: Some("aqara".to_string()),
        ..Default::default()
    }
}

/// Parse generic HTTP/HTTPS service information
fn parse_http_service(txt: &HashMap<String, String>, instance_name: &str) -> ParsedInfo {
    let instance_lower = instance_name.to_lowercase();

    let device_type = if instance_lower.contains("printer") || instance_lower.contains("print") {
        Some("Printer".to_string())
    } else if instance_lower.contains("router") || instance_lower.contains("gateway") {
        Some("Router".to_string())
    } else if instance_lower.contains("nas") || instance_lower.contains("storage") {
        Some("NAS".to_string())
    } else if instance_lower.contains("camera") {
        Some("Camera".to_string())
    } else if instance_lower.contains("tv") || instance_lower.contains("television") {
        Some("TV".to_string())
    } else {
        None // Don't set device type for generic HTTP servers
    };

    let manufacturer = txt.get("manufacturer").or_else(|| txt.get("mfr")).cloned();
    let model = txt.get("model").or_else(|| txt.get("md")).cloned();

    ParsedInfo {
        device_type,
        manufacturer,
        model,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_homekit() {
        let mut txt = HashMap::new();
        txt.insert("md".to_string(), "LIFX A19".to_string());
        txt.insert("ci".to_string(), "5".to_string()); // Lightbulb

        let info = parse_homekit(&txt);
        assert_eq!(info.device_type, Some("Lightbulb".to_string()));
        assert_eq!(info.model, Some("LIFX A19".to_string()));
    }

    #[test]
    fn test_parse_chromecast() {
        let mut txt = HashMap::new();
        txt.insert("md".to_string(), "Chromecast Ultra".to_string());
        txt.insert("rm".to_string(), "Living Room".to_string());

        let info = parse_chromecast(&txt);
        assert_eq!(info.device_type, Some("Chromecast".to_string()));
        assert_eq!(info.manufacturer, Some("Google".to_string()));
        assert_eq!(info.model, Some("Chromecast Ultra".to_string()));
        assert_eq!(info.friendly_name, Some("Living Room".to_string()));
    }

    #[test]
    fn test_parse_shelly() {
        let mut txt = HashMap::new();
        txt.insert("app".to_string(), "PlugSG3".to_string());
        txt.insert("gen".to_string(), "3".to_string());

        let info = parse_shelly(&txt);
        assert_eq!(info.device_type, Some("Shelly Plug S Gen 3".to_string()));
        assert_eq!(info.manufacturer, Some("Shelly".to_string()));
        assert_eq!(info.model, Some("Plug S Gen 3".to_string()));
    }

    #[test]
    fn test_parse_miio() {
        let txt = HashMap::new();
        let instance_name = "zhimi-airpurifier-v7_miio357210272";

        let info = parse_miio(&txt, instance_name);
        assert_eq!(info.device_type, Some("Air Purifier".to_string()));
        assert_eq!(info.manufacturer, Some("Xiaomi".to_string()));
        assert!(info.model.is_some());
    }

    #[test]
    fn test_identify_device() {
        let services = vec![DiscoveredService {
            service_type: "_googlecast._tcp.local.".to_string(),
            fullname: "Living Room._googlecast._tcp.local.".to_string(),
            instance_name: "Living Room".to_string(),
            port: 8009,
            txt_properties: {
                let mut txt = HashMap::new();
                txt.insert("md".to_string(), "Google Home".to_string());
                txt.insert("rm".to_string(), "Living Room".to_string());
                txt
            },
        }];

        let txt_properties = services[0].txt_properties.clone();

        let info = identify_device(
            "Living Room",
            "192.168.1.100",
            &["192.168.1.100".to_string()],
            Some("google-home.local"),
            &services,
            &txt_properties,
            None,
        );

        assert_eq!(info.name, "Living Room");
        assert_eq!(info.device_type, Some("Google Home".to_string()));
        assert_eq!(info.manufacturer, Some("Google".to_string()));
        assert_eq!(info.friendly_name, Some("Living Room".to_string()));
        assert_eq!(info.icon_hint, Some("google".to_string()));
    }
}
