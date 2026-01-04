//! Device identification module.
//!
//! This module provides functionality to identify devices based on their
//! mDNS services, TXT records, and vendor-specific information.
//!
//! The identification process extracts high-level device information such as:
//! - Device type (e.g., "Smart Speaker", "Printer")
//! - Manufacturer (e.g., "Sonos", "Apple")
//! - Model name
//! - Firmware version
//! - MAC address (when available)

mod parsers;

use crate::discovery::{DiscoveredDevice, DiscoveredService};
use crate::vendor_discovery::VendorInfo;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use parsers::identify_device;

/// High-level device information extracted from discovery data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeviceInfo {
    /// Best available name for the device
    pub name: String,
    /// Friendly/zone name (e.g., Sonos room name)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub friendly_name: Option<String>,
    /// All IP addresses (IPv4 and IPv6)
    pub addresses: Vec<String>,
    /// Primary IP address (first IPv4, or first address if no IPv4)
    pub primary_address: String,
    /// Hostname (e.g., "device.local")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    /// Device type (e.g., "Smart Speaker", "Printer", "Router")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_type: Option<String>,
    /// Manufacturer name (e.g., "Sonos", "Apple", "Google")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    /// Device model (e.g., "Era 300", "Chromecast Ultra")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Firmware/software version
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firmware_version: Option<String>,
    /// MAC address (when available from TXT records or vendor info)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac_address: Option<String>,
    /// Hint for frontend icon selection (e.g., "sonos", "apple", "printer")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_hint: Option<String>,
}

/// Source of device discovery
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DiscoverySource {
    /// Device discovered via mDNS
    Mdns {
        /// Service types that were discovered (e.g., "_http._tcp.local.")
        service_types: Vec<String>,
    },
    /// Device discovered via IP scan
    IpScan {
        /// Ports that responded
        ports: Vec<u16>,
    },
}

/// Raw discovery data preserved for detailed inspection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawDiscoveryData {
    /// All discovered services with their full details
    pub services: Vec<DiscoveredService>,
    /// Combined TXT properties from all services
    pub txt_properties: HashMap<String, String>,
    /// Vendor-specific information (if fetched)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_info: Option<VendorInfo>,
    /// TTL from mDNS (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u32>,
}

/// A fully identified device with parsed information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentifiedDevice {
    /// High-level device information (parsed)
    pub device_info: DeviceInfo,
    /// Discovery sources that found this device
    pub discovery_sources: Vec<DiscoverySource>,
    /// Raw discovery data for detailed inspection
    pub raw_discovery: RawDiscoveryData,
}

impl DeviceInfo {
    /// Create a new DeviceInfo with required fields
    pub fn new(name: String, primary_address: String, addresses: Vec<String>) -> Self {
        Self {
            name,
            primary_address,
            addresses,
            ..Default::default()
        }
    }
}

#[allow(dead_code)]
impl DeviceInfo {
    /// Merge another DeviceInfo into this one, preferring non-None values from other
    pub fn merge(&mut self, other: &DeviceInfo) {
        if self.friendly_name.is_none() {
            self.friendly_name = other.friendly_name.clone();
        }
        if self.hostname.is_none() {
            self.hostname = other.hostname.clone();
        }
        if self.device_type.is_none() {
            self.device_type = other.device_type.clone();
        }
        if self.manufacturer.is_none() {
            self.manufacturer = other.manufacturer.clone();
        }
        if self.model.is_none() {
            self.model = other.model.clone();
        }
        if self.firmware_version.is_none() {
            self.firmware_version = other.firmware_version.clone();
        }
        if self.mac_address.is_none() {
            self.mac_address = other.mac_address.clone();
        }
        if self.icon_hint.is_none() {
            self.icon_hint = other.icon_hint.clone();
        }
    }
}

/// Discovery event sent during device discovery (updated version)
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
#[allow(dead_code)]
pub enum IdentifiedDiscoveryEvent {
    /// A new device was found
    DeviceFound { device: IdentifiedDevice },
    /// An existing device was updated (e.g., new service discovered)
    DeviceUpdated { device: IdentifiedDevice },
    /// Discovery has started
    Started { message: String },
    /// Discovery has completed
    Completed {
        message: String,
        device_count: usize,
    },
    /// An error occurred during discovery
    Error { message: String },
}

/// Convert a DiscoveredDevice to an IdentifiedDevice
///
/// This function takes a raw DiscoveredDevice from the discovery module
/// and enriches it with parsed device information.
pub fn convert_to_identified(device: DiscoveredDevice) -> IdentifiedDevice {
    // Build discovery sources
    let discovery_methods: Vec<&str> = device.discovery_method.split(", ").collect();
    let mut discovery_sources = Vec::new();

    for method in discovery_methods {
        if method.contains("mdns") {
            discovery_sources.push(DiscoverySource::Mdns {
                service_types: device
                    .services
                    .iter()
                    .map(|s| s.service_type.clone())
                    .collect(),
            });
        } else if method.contains("ip_scan") {
            // Extract ports from services or use empty vec
            let ports: Vec<u16> = device.services.iter().map(|s| s.port).collect();
            discovery_sources.push(DiscoverySource::IpScan { ports });
        }
    }

    // Identify the device
    let device_info = identify_device(
        &device.name,
        &device.address,
        &device.addresses,
        Some(&device.hostname),
        &device.services,
        &device.txt_properties,
        device.vendor_info.as_ref(),
    );

    // Build raw discovery data
    let raw_discovery = RawDiscoveryData {
        services: device.services.clone(),
        txt_properties: device.txt_properties.clone(),
        vendor_info: device.vendor_info,
        ttl: device.ttl,
    };

    IdentifiedDevice {
        device_info,
        discovery_sources,
        raw_discovery,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_info_merge() {
        let mut base = DeviceInfo::new(
            "Test Device".to_string(),
            "192.168.1.100".to_string(),
            vec!["192.168.1.100".to_string()],
        );
        base.manufacturer = Some("Sonos".to_string());

        let other = DeviceInfo {
            name: "Other".to_string(),
            friendly_name: Some("Living Room".to_string()),
            addresses: vec![],
            primary_address: String::new(),
            hostname: Some("speaker.local".to_string()),
            device_type: Some("Smart Speaker".to_string()),
            manufacturer: Some("Different".to_string()), // Should not override
            model: Some("Era 300".to_string()),
            firmware_version: Some("17.0".to_string()),
            mac_address: Some("AA:BB:CC:DD:EE:FF".to_string()),
            icon_hint: Some("sonos".to_string()),
        };

        base.merge(&other);

        assert_eq!(base.name, "Test Device"); // Original preserved
        assert_eq!(base.friendly_name, Some("Living Room".to_string()));
        assert_eq!(base.manufacturer, Some("Sonos".to_string())); // Original preserved
        assert_eq!(base.model, Some("Era 300".to_string()));
        assert_eq!(base.device_type, Some("Smart Speaker".to_string()));
    }

    #[test]
    fn test_discovery_source_serialization() {
        let mdns_source = DiscoverySource::Mdns {
            service_types: vec!["_http._tcp.local.".to_string()],
        };
        let json = serde_json::to_string(&mdns_source).unwrap();
        assert!(json.contains("\"type\":\"mdns\""));
        assert!(json.contains("service_types"));
    }
}
