//! Device discovery module for finding local network devices.
//!
//! This module provides functionality to discover devices on the local network
//! using various discovery protocols, starting with mDNS (multicast DNS).
//!
//! Uses pure Rust mDNS implementation (mdns-sd) that works on all platforms
//! without requiring system dependencies.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashSet;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

/// A discovered device on the network
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredDevice {
    /// Human-readable name of the device
    pub name: String,
    /// IP address of the device
    pub address: String,
    /// The service type that was discovered (e.g., "_http._tcp.local.")
    pub service_type: String,
    /// The method used to discover this device
    pub discovery_method: String,
}

/// Event sent during device discovery
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
pub enum DiscoveryEvent {
    /// A new device was found
    DeviceFound { device: DiscoveredDevice },
    /// Discovery has started
    Started { message: String },
    /// Discovery has completed
    Completed { message: String, device_count: usize },
    /// An error occurred during discovery
    Error { message: String },
}

/// The DNS-SD meta-query service type that returns all available service types
const META_QUERY_SERVICE_TYPE: &str = "_services._dns-sd._udp.local.";

/// Runs mDNS discovery and sends discovered devices to the provided channel.
///
/// This function uses a two-phase approach:
/// 1. First, discover all available service types using the DNS-SD meta-query
/// 2. Then, browse for devices on each discovered service type
///
/// # Arguments
/// * `tx` - Channel sender to send discovery events
/// * `duration` - How long to run discovery before completing
pub async fn run_mdns_discovery(tx: mpsc::Sender<DiscoveryEvent>, duration: Duration) {
    info!("Starting mDNS discovery for {:?}", duration);

    // Send started event
    if tx
        .send(DiscoveryEvent::Started {
            message: format!("Starting mDNS discovery for {:?}", duration),
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

    // Give the daemon a moment to initialize
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Phase 1: Discover all available service types using meta-query
    info!("Phase 1: Discovering available service types via meta-query: {}", META_QUERY_SERVICE_TYPE);
    
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

    // Collect service types for a portion of the total time
    let service_type_discovery_time = duration / 4; // 25% of time for discovering service types
    let device_discovery_time = duration - service_type_discovery_time; // 75% for devices
    
    let mut discovered_service_types: HashSet<String> = HashSet::new();
    let service_type_timeout = tokio::time::sleep(service_type_discovery_time);
    tokio::pin!(service_type_timeout);

    info!("Collecting service types for {:?}...", service_type_discovery_time);
    
    loop {
        tokio::select! {
            _ = &mut service_type_timeout => {
                info!("Service type discovery phase complete");
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                // Poll for events
                while let Ok(event) = meta_receiver.try_recv() {
                    match event {
                        ServiceEvent::ServiceFound(_, fullname) => {
                            // The fullname from meta-query is like "_http._tcp.local."
                            // We need to convert it to a browseable service type
                            let service_type = extract_service_type_from_meta(&fullname);
                            if let Some(st) = service_type {
                                if discovered_service_types.insert(st.clone()) {
                                    info!("Discovered service type: {}", st);
                                }
                            }
                        }
                        ServiceEvent::ServiceResolved(info) => {
                            // Meta-query can also return resolved services with the service type info
                            let fullname = info.get_fullname();
                            if let Some(st) = extract_service_type_from_meta(fullname) {
                                if discovered_service_types.insert(st.clone()) {
                                    info!("Discovered service type (resolved): {}", st);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if discovered_service_types.is_empty() {
        warn!("No service types discovered via meta-query, discovery may be limited");
    } else {
        info!("Discovered {} service types: {:?}", discovered_service_types.len(), discovered_service_types);
    }

    // Phase 2: Browse for devices on each discovered service type
    info!("Phase 2: Browsing {} service types for devices...", discovered_service_types.len());
    
    let mut receivers = Vec::new();
    for service_type in &discovered_service_types {
        match mdns.browse(service_type) {
            Ok(receiver) => {
                debug!("Browsing for service type: {}", service_type);
                receivers.push((service_type.clone(), receiver));
            }
            Err(e) => {
                warn!("Failed to browse for {}: {}", service_type, e);
            }
        }
        // Small delay between browse requests
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    info!(
        "Started {} service browsers, waiting for devices for {:?}...",
        receivers.len(),
        device_discovery_time
    );

    // Track seen addresses to avoid duplicates
    let mut seen_addresses: HashSet<String> = HashSet::new();
    let mut device_count = 0;
    let mut found_count = 0;
    let mut resolved_count = 0;

    // Give the network time to respond to initial queries
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Create a timeout future for device discovery
    let device_timeout = tokio::time::sleep(device_discovery_time);
    tokio::pin!(device_timeout);

    // Process events from all receivers
    loop {
        let mut got_event = false;

        for (service_type, receiver) in &receivers {
            // Non-blocking check for events
            while let Ok(event) = receiver.try_recv() {
                got_event = true;

                match &event {
                    ServiceEvent::SearchStarted(stype) => {
                        debug!("SearchStarted for {}", stype);
                    }
                    ServiceEvent::ServiceFound(stype, name) => {
                        found_count += 1;
                        debug!("ServiceFound: {} (type: {})", name, stype);
                    }
                    ServiceEvent::ServiceResolved(info) => {
                        resolved_count += 1;
                        debug!(
                            "ServiceResolved: {} at {:?}",
                            info.get_fullname(),
                            info.get_addresses()
                        );

                        // Extract device information
                        if let Some(device) = process_service_resolved(info, service_type) {
                            // Only send if we haven't seen this address before
                            if seen_addresses.insert(device.address.clone()) {
                                device_count += 1;
                                info!(
                                    "Discovered device: {} at {} via {}",
                                    device.name, device.address, device.service_type
                                );
                                if tx
                                    .send(DiscoveryEvent::DeviceFound { device })
                                    .await
                                    .is_err()
                                {
                                    // Channel closed, stop discovery
                                    info!("Discovery channel closed, stopping");
                                    let _ = mdns.shutdown();
                                    return;
                                }
                            }
                        }
                    }
                    ServiceEvent::ServiceRemoved(_, name) => {
                        debug!("ServiceRemoved: {}", name);
                    }
                    ServiceEvent::SearchStopped(stype) => {
                        debug!("SearchStopped for {}", stype);
                    }
                }
            }
        }

        // Check if timeout has elapsed
        tokio::select! {
            _ = &mut device_timeout => {
                info!(
                    "mDNS discovery completed: {} service types, {} found, {} resolved, {} unique devices",
                    discovered_service_types.len(), found_count, resolved_count, device_count
                );
                let _ = tx
                    .send(DiscoveryEvent::Completed {
                        message: format!(
                            "Discovery completed: {} service types scanned, {} devices found",
                            discovered_service_types.len(), device_count
                        ),
                        device_count,
                    })
                    .await;
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(100)), if !got_event => {
                // Small delay when no events to reduce CPU usage
            }
            else => {
                // Got events, continue immediately
            }
        }
    }

    // Shutdown mDNS daemon
    if let Err(e) = mdns.shutdown() {
        warn!("Error shutting down mDNS daemon: {}", e);
    }
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
        // Check if it has the right structure: _something._tcp.local or _something._udp.local
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

/// Process a ServiceResolved event and extract device information
fn process_service_resolved(info: &ServiceInfo, service_type: &str) -> Option<DiscoveredDevice> {
    // Get the first IPv4 address, fall back to IPv6
    let address = info
        .get_addresses()
        .iter()
        .find(|addr| addr.is_ipv4())
        .or_else(|| info.get_addresses().iter().next())
        .map(|addr| addr.to_string())?;

    // Get the service name, removing the service type suffix
    let full_name = info.get_fullname();
    let service_type_no_dot = service_type.trim_end_matches('.');
    let name = full_name
        .strip_suffix(service_type)
        .or_else(|| full_name.strip_suffix(service_type_no_dot))
        .unwrap_or(full_name)
        .trim_end_matches('.')
        .to_string();

    // Clean up the name
    let name = if name.is_empty() {
        info.get_hostname().trim_end_matches('.').to_string()
    } else {
        name
    };

    Some(DiscoveredDevice {
        name,
        address,
        service_type: service_type.to_string(),
        discovery_method: "mdns".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discovery_event_serialization() {
        let device = DiscoveredDevice {
            name: "Test Device".to_string(),
            address: "192.168.1.100".to_string(),
            service_type: "_http._tcp.local.".to_string(),
            discovery_method: "mdns".to_string(),
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
