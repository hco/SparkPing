//! Device discovery module for finding local network devices.
//!
//! This module provides functionality to discover devices on the local network
//! using various discovery protocols, starting with mDNS (multicast DNS).
//!
//! Uses pure Rust mDNS implementation (mdns-sd) that works on all platforms
//! without requiring system dependencies.

use crate::vendor_discovery::VendorInfo;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

/// Information about a single service discovered on a device
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct DiscoveredService {
    /// Service type (e.g., "_http._tcp.local.")
    pub service_type: String,
    /// Full DNS name of the service (e.g., "MyDevice._http._tcp.local.")
    pub fullname: String,
    /// Service instance name (e.g., "MyDevice")
    pub instance_name: String,
    /// Port number the service is running on
    pub port: u16,
    /// TXT record properties as key-value pairs
    pub txt_properties: HashMap<String, String>,
}

/// A discovered device on the network
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredDevice {
    /// Human-readable name of the device (primary name)
    pub name: String,
    /// Primary IP address of the device (first IPv4, or first IPv6 if no IPv4)
    pub address: String,
    /// All IP addresses (IPv4 and IPv6)
    pub addresses: Vec<String>,
    /// Hostname of the device (e.g., "device.local.")
    pub hostname: String,
    /// All services discovered on this device
    pub services: Vec<DiscoveredService>,
    /// Combined TXT properties from all services (merged)
    pub txt_properties: HashMap<String, String>,
    /// TTL (Time To Live) if available
    pub ttl: Option<u32>,
    /// The method used to discover this device
    pub discovery_method: String,
    /// Vendor-specific information (fetched from device APIs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_info: Option<VendorInfo>,
}

/// Event sent during device discovery
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
#[allow(dead_code)] // Completed is part of the API but not used in indefinite discovery mode
pub enum DiscoveryEvent {
    /// A new device was found
    DeviceFound { device: DiscoveredDevice },
    /// An existing device was updated (e.g., new service discovered)
    DeviceUpdated { device: DiscoveredDevice },
    /// Discovery has started
    Started { message: String },
    /// Discovery has completed (kept for API compatibility)
    Completed {
        message: String,
        device_count: usize,
    },
    /// An error occurred during discovery
    Error { message: String },
}

/// The DNS-SD meta-query service type that returns all available service types
const META_QUERY_SERVICE_TYPE: &str = "_services._dns-sd._udp.local.";

/// How often to poll for events (lower = more responsive, higher = less CPU)
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Runs mDNS discovery indefinitely and sends discovered devices to the provided channel.
///
/// This function discovers service types and devices in parallel - no waiting phase.
/// As new service types are discovered via meta-query, browsers are started immediately.
/// Discovery runs until the channel is closed (client disconnects).
///
/// # Arguments
/// * `tx` - Channel sender to send discovery events
pub async fn run_mdns_discovery(tx: mpsc::Sender<DiscoveryEvent>) {
    info!("Starting mDNS discovery (streaming mode)");

    // Send started event
    if tx
        .send(DiscoveryEvent::Started {
            message: "Scanning for devices...".to_string(),
        })
        .await
        .is_err()
    {
        return; // Channel closed, exit
    }

    // Create the mDNS daemon
    let mdns = match ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(e) => {
            error!("Failed to create mDNS daemon: {}", e);
            let _ = tx
                .send(DiscoveryEvent::Error {
                    message: format!("Failed to initialize mDNS: {}", e),
                })
                .await;
            return;
        }
    };

    // Start the meta-query to discover service types
    let meta_receiver = match mdns.browse(META_QUERY_SERVICE_TYPE) {
        Ok(receiver) => receiver,
        Err(e) => {
            error!("Failed to browse for service types: {}", e);
            let _ = tx
                .send(DiscoveryEvent::Error {
                    message: format!("Failed to discover service types: {}", e),
                })
                .await;
            return;
        }
    };

    // State tracking
    let mut discovered_service_types: HashSet<String> = HashSet::new();
    let mut receivers: Vec<(String, flume::Receiver<ServiceEvent>)> = Vec::new();
    let mut devices: HashMap<String, DiscoveredDevice> = HashMap::new(); // Track devices by IP address
    let mut device_count = 0;

    info!("Discovery started - listening for service types and devices");

    // Main discovery loop - processes everything in parallel
    loop {
        // Check if channel is still open
        if tx.is_closed() {
            info!("Client disconnected, stopping discovery");
            break;
        }

        let mut got_event = false;

        // Process meta-query events - discover new service types
        while let Ok(event) = meta_receiver.try_recv() {
            got_event = true;
            match event {
                ServiceEvent::ServiceFound(_, fullname) => {
                    if let Some(st) = extract_service_type_from_meta(&fullname) {
                        if discovered_service_types.insert(st.clone()) {
                            debug!("Discovered service type: {}", st);
                            // Immediately start browsing for this service type
                            if let Ok(receiver) = mdns.browse(&st) {
                                info!("Started browsing for service type: {}", st);
                                receivers.push((st, receiver));
                            }
                        }
                    }
                }
                ServiceEvent::ServiceResolved(info) => {
                    let fullname = info.get_fullname();
                    if let Some(st) = extract_service_type_from_meta(fullname) {
                        if discovered_service_types.insert(st.clone()) {
                            debug!("Discovered service type (resolved): {}", st);
                            // Immediately start browsing for this service type
                            if let Ok(receiver) = mdns.browse(&st) {
                                info!("Started browsing for service type: {}", st);
                                receivers.push((st, receiver));
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // Process events from all service type browsers
        for (service_type, receiver) in &receivers {
            while let Ok(event) = receiver.try_recv() {
                got_event = true;

                if let ServiceEvent::ServiceResolved(info) = &event {
                    debug!(
                        "ServiceResolved: {} at {:?}",
                        info.get_fullname(),
                        info.get_addresses()
                    );

                    if let Some(service) = extract_service_info(info, service_type) {
                        // Get the primary IP address for device tracking
                        let primary_address = info
                            .get_addresses()
                            .iter()
                            .find(|addr| addr.is_ipv4())
                            .or_else(|| info.get_addresses().iter().next())
                            .map(|addr| addr.to_string());

                        if let Some(address) = primary_address {
                            let is_new_device = !devices.contains_key(&address);

                            if is_new_device {
                                // Create new device
                                let device = create_device_from_service(&service, info, &address);
                                device_count += 1;
                                info!(
                                    "Discovered device #{}: {} at {} via {}",
                                    device_count, device.name, device.address, service.service_type
                                );

                                devices.insert(address.clone(), device.clone());

                                // Send DeviceFound event
                                if tx
                                    .send(DiscoveryEvent::DeviceFound { device })
                                    .await
                                    .is_err()
                                {
                                    info!("Client disconnected, stopping discovery");
                                    let _ = mdns.shutdown();
                                    return;
                                }
                            } else {
                                // Update existing device with new service
                                let device = devices.get_mut(&address).unwrap();

                                // Check if this service already exists
                                let service_exists = device.services.iter().any(|s| {
                                    s.service_type == service.service_type
                                        && s.fullname == service.fullname
                                });

                                if !service_exists {
                                    device.services.push(service.clone());

                                    // Merge TXT properties
                                    for (key, value) in &service.txt_properties {
                                        device.txt_properties.insert(key.clone(), value.clone());
                                    }

                                    // Update addresses if needed
                                    let all_addresses: Vec<String> = info
                                        .get_addresses()
                                        .iter()
                                        .map(|a| a.to_string())
                                        .collect();
                                    for addr in all_addresses {
                                        if !device.addresses.contains(&addr) {
                                            device.addresses.push(addr);
                                        }
                                    }

                                    info!(
                                        "Updated device {} at {} with new service {}",
                                        device.name, device.address, service.service_type
                                    );

                                    // Send DeviceUpdated event
                                    if tx
                                        .send(DiscoveryEvent::DeviceUpdated {
                                            device: device.clone(),
                                        })
                                        .await
                                        .is_err()
                                    {
                                        info!("Client disconnected, stopping discovery");
                                        let _ = mdns.shutdown();
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Small delay when no events to reduce CPU usage
        if !got_event {
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    // Shutdown mDNS daemon
    if let Err(e) = mdns.shutdown() {
        warn!("Error shutting down mDNS daemon: {}", e);
    }

    info!("Discovery stopped after finding {} devices", device_count);
}

/// Extract a browseable service type from a meta-query response.
///
/// Meta-query responses come in formats like:
/// - "_http._tcp.local." (the service type itself as found name)
/// - "_tcp.local." with instance "_http"
///
/// We need to convert these to browseable service types like "_http._tcp.local."
fn extract_service_type_from_meta(fullname: &str) -> Option<String> {
    let fullname = fullname.trim_end_matches('.');

    // If it looks like a complete service type already, use it
    // Format: _service._protocol.local
    if fullname.starts_with('_') && fullname.ends_with(".local") {
        let parts: Vec<&str> = fullname.split('.').collect();
        if parts.len() >= 3 {
            let service_part = parts[0];
            let proto_part = parts[1];

            // Skip the meta-query type itself
            if service_part == "_services" {
                return None;
            }

            // Valid service type
            if service_part.starts_with('_') && (proto_part == "_tcp" || proto_part == "_udp") {
                return Some(format!("{}.", fullname));
            }
        }
    }

    None
}

/// Extract service information from a ServiceResolved event
fn extract_service_info(info: &ServiceInfo, service_type: &str) -> Option<DiscoveredService> {
    // Get the full DNS name
    let fullname = info.get_fullname().to_string();

    // Get the service instance name, removing the service type suffix
    let service_type_no_dot = service_type.trim_end_matches('.');
    let instance_name = fullname
        .strip_suffix(service_type)
        .or_else(|| fullname.strip_suffix(service_type_no_dot))
        .unwrap_or(&fullname)
        .trim_end_matches('.')
        .to_string();

    // Get port
    let port = info.get_port();

    // Extract TXT record properties
    let txt_properties: HashMap<String, String> = info
        .get_properties()
        .iter()
        .map(|prop| {
            let key = prop.key().to_string();
            let value = prop.val_str().to_string();
            (key, value)
        })
        .collect();

    Some(DiscoveredService {
        service_type: service_type.to_string(),
        fullname,
        instance_name,
        port,
        txt_properties,
    })
}

/// Create a DiscoveredDevice from a service and ServiceInfo
fn create_device_from_service(
    service: &DiscoveredService,
    info: &ServiceInfo,
    primary_address: &str,
) -> DiscoveredDevice {
    // Get all addresses
    let addresses: Vec<String> = info
        .get_addresses()
        .iter()
        .map(|addr| addr.to_string())
        .collect();

    // Get hostname
    let hostname = info.get_hostname().trim_end_matches('.').to_string();

    // Device name - use instance name, fall back to hostname
    let name = if service.instance_name.is_empty() {
        hostname.clone()
    } else {
        service.instance_name.clone()
    };

    // TTL is not directly available from mdns-sd ServiceInfo, so we'll leave it as None
    // If needed in the future, we could track this separately

    DiscoveredDevice {
        name,
        address: primary_address.to_string(),
        addresses,
        hostname,
        services: vec![service.clone()],
        txt_properties: service.txt_properties.clone(),
        ttl: None,
        discovery_method: "mdns".to_string(),
        vendor_info: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discovery_event_serialization() {
        let service = DiscoveredService {
            service_type: "_http._tcp.local.".to_string(),
            fullname: "Test Device._http._tcp.local.".to_string(),
            instance_name: "Test Device".to_string(),
            port: 80,
            txt_properties: HashMap::new(),
        };

        let device = DiscoveredDevice {
            name: "Test Device".to_string(),
            address: "192.168.1.100".to_string(),
            addresses: vec!["192.168.1.100".to_string()],
            hostname: "test-device.local".to_string(),
            services: vec![service],
            txt_properties: HashMap::new(),
            ttl: None,
            discovery_method: "mdns".to_string(),
            vendor_info: None,
        };

        let event = DiscoveryEvent::DeviceFound { device };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("device_found"));
        assert!(json.contains("192.168.1.100"));
    }

    #[test]
    fn test_started_event_serialization() {
        let event = DiscoveryEvent::Started {
            message: "Starting...".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("started"));
    }

    #[test]
    fn test_extract_service_type_from_meta() {
        assert_eq!(
            extract_service_type_from_meta("_http._tcp.local"),
            Some("_http._tcp.local.".to_string())
        );
        assert_eq!(
            extract_service_type_from_meta("_http._tcp.local."),
            Some("_http._tcp.local.".to_string())
        );
        assert_eq!(
            extract_service_type_from_meta("_ssh._tcp.local"),
            Some("_ssh._tcp.local.".to_string())
        );
        assert_eq!(
            extract_service_type_from_meta("_services._dns-sd._udp.local"),
            None
        );
    }
}
