//! Vendor-specific device discovery module.
//!
//! This module provides functionality to fetch additional device information
//! from vendor-specific APIs after a device has been discovered via mDNS or IP scan.

pub mod sonos;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, warn};

/// Default timeout for vendor discovery HTTP requests
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(3);

/// Vendor-specific information discovered from a device
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "vendor", rename_all = "snake_case")]
pub enum VendorInfo {
    /// Sonos speaker information
    Sonos(sonos::SonosInfo),
}

/// Identifies the vendor of a device based on its services or other characteristics
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vendor {
    Sonos,
}

/// Check if a device is from a specific vendor based on its service types
pub fn detect_vendor(service_types: &[String]) -> Option<Vendor> {
    for service_type in service_types {
        let service_lower = service_type.to_lowercase();
        if service_lower.contains("_sonos.") {
            return Some(Vendor::Sonos);
        }
    }
    None
}

/// Fetch vendor-specific information for a device
///
/// # Arguments
/// * `vendor` - The detected vendor
/// * `ip_address` - The IP address of the device
///
/// # Returns
/// Vendor-specific information if successfully fetched, None otherwise
pub async fn fetch_vendor_info(vendor: Vendor, ip_address: &str) -> Option<VendorInfo> {
    match vendor {
        Vendor::Sonos => {
            debug!("Fetching Sonos info for {}", ip_address);
            match sonos::fetch_sonos_info(ip_address, DEFAULT_TIMEOUT).await {
                Ok(info) => Some(VendorInfo::Sonos(info)),
                Err(e) => {
                    warn!("Failed to fetch Sonos info for {}: {}", ip_address, e);
                    None
                }
            }
        }
    }
}

/// Fetch vendor-specific information and extract the device name if available
///
/// Returns a tuple of (vendor_info, device_name) where device_name is the
/// vendor-specific device name if available
pub async fn fetch_vendor_info_with_name(
    vendor: Vendor,
    ip_address: &str,
) -> (Option<VendorInfo>, Option<String>) {
    match fetch_vendor_info(vendor, ip_address).await {
        Some(VendorInfo::Sonos(ref info)) => {
            let name = Some(info.zone_name.clone());
            (Some(VendorInfo::Sonos(info.clone())), name)
        }
        None => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_vendor_sonos() {
        let services = vec!["_sonos._tcp.local.".to_string()];
        assert_eq!(detect_vendor(&services), Some(Vendor::Sonos));
    }

    #[test]
    fn test_detect_vendor_none() {
        let services = vec!["_http._tcp.local.".to_string()];
        assert_eq!(detect_vendor(&services), None);
    }

    #[test]
    fn test_detect_vendor_case_insensitive() {
        let services = vec!["_SONOS._TCP.local.".to_string()];
        assert_eq!(detect_vendor(&services), Some(Vendor::Sonos));
    }
}
