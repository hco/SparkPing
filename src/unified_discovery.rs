//! Unified device discovery module.
//!
//! This module coordinates multiple discovery methods (mDNS, IP scan) and
//! merges results into a unified stream. Devices are deduplicated by IP address
//! to ensure each device is only reported once, even if discovered by multiple methods.

use crate::discovery::{run_mdns_discovery, DiscoveredDevice, DiscoveryEvent};
use crate::ip_scan::{run_ip_scan_discovery, IpRangeSpec, IpScanRequest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info};

/// Configuration for unified discovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedDiscoveryConfig {
    /// Enable mDNS discovery
    #[serde(default = "default_true")]
    pub mdns_enabled: bool,

    /// Enable IP scan discovery
    #[serde(default)]
    pub ip_scan_enabled: bool,

    /// IP scan configuration (required if ip_scan_enabled is true)
    #[serde(default)]
    pub ip_scan: Option<IpScanConfig>,
}

fn default_true() -> bool {
    true
}

/// IP scan configuration for unified discovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpScanConfig {
    /// CIDR notation (e.g., "192.168.1.0/24")
    pub cidr: Option<String>,
    /// Start IP for custom range
    pub start_ip: Option<String>,
    /// End IP for custom range
    pub end_ip: Option<String>,
    /// Ports to scan
    #[serde(default = "default_ports")]
    pub ports: Vec<u16>,
    /// Timeout in milliseconds
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// Concurrency level
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
}

fn default_ports() -> Vec<u16> {
    vec![80, 443, 22]
}

fn default_timeout() -> u64 {
    500
}

fn default_concurrency() -> usize {
    50
}

/// State for tracking discovered devices and merging results
struct DiscoveryState {
    /// Devices indexed by IP address
    devices: HashMap<String, DiscoveredDevice>,
    /// Count of active discovery methods
    active_methods: usize,
    /// Methods that have completed
    completed_methods: usize,
}

impl DiscoveryState {
    fn new(active_methods: usize) -> Self {
        Self {
            devices: HashMap::new(),
            active_methods,
            completed_methods: 0,
        }
    }

    /// Merge a discovered device into the state.
    /// Returns Some(device) if this is a new device or an update, None if no change.
    fn merge_device(&mut self, device: DiscoveredDevice) -> Option<(DiscoveredDevice, bool)> {
        let address = device.address.clone();

        if let Some(existing) = self.devices.get_mut(&address) {
            // Merge the device information
            let mut updated = false;

            // Prefer non-IP names over IP addresses
            if existing.name == existing.address && device.name != device.address {
                existing.name = device.name.clone();
                updated = true;
            }

            // Merge addresses
            for addr in &device.addresses {
                if !existing.addresses.contains(addr) {
                    existing.addresses.push(addr.clone());
                    updated = true;
                }
            }

            // Update hostname if we got a better one
            if existing.hostname == existing.address && device.hostname != device.address {
                existing.hostname = device.hostname.clone();
                updated = true;
            }

            // Merge services
            for service in &device.services {
                let service_exists = existing.services.iter().any(|s| {
                    s.service_type == service.service_type && s.fullname == service.fullname
                });
                if !service_exists {
                    existing.services.push(service.clone());
                    updated = true;
                }
            }

            // Merge TXT properties
            for (key, value) in &device.txt_properties {
                if !existing.txt_properties.contains_key(key) {
                    existing.txt_properties.insert(key.clone(), value.clone());
                    updated = true;
                }
            }

            // Update discovery method to show both
            if !existing.discovery_method.contains(&device.discovery_method) {
                existing.discovery_method =
                    format!("{}, {}", existing.discovery_method, device.discovery_method);
                updated = true;
            }

            if updated {
                Some((existing.clone(), false)) // false = update, not new
            } else {
                None
            }
        } else {
            // New device
            self.devices.insert(address, device.clone());
            Some((device, true)) // true = new device
        }
    }

    /// Mark a method as completed. Returns true if all methods are done.
    fn method_completed(&mut self) -> bool {
        self.completed_methods += 1;
        self.completed_methods >= self.active_methods
    }
}

/// Internal event for coordinating discovery methods
enum InternalEvent {
    /// A device was discovered
    Device(DiscoveredDevice),
    /// A method started
    Started(String),
    /// A method completed
    Completed(String),
    /// An error occurred
    Error(String),
}

/// Run unified discovery with multiple methods and send merged results.
///
/// This function coordinates multiple discovery methods, merges their results
/// by IP address, and sends unified events to the client.
pub async fn run_unified_discovery(
    tx: mpsc::Sender<DiscoveryEvent>,
    config: UnifiedDiscoveryConfig,
) {
    info!("Starting unified discovery");

    // Count active methods
    let mut active_methods = 0;
    if config.mdns_enabled {
        active_methods += 1;
    }
    if config.ip_scan_enabled && config.ip_scan.is_some() {
        active_methods += 1;
    }

    if active_methods == 0 {
        let _ = tx
            .send(DiscoveryEvent::Error {
                message: "No discovery methods enabled".to_string(),
            })
            .await;
        return;
    }

    // Send started event
    let methods: Vec<&str> = [
        if config.mdns_enabled { Some("mDNS") } else { None },
        if config.ip_scan_enabled { Some("IP Scan") } else { None },
    ]
    .into_iter()
    .flatten()
    .collect();

    if tx
        .send(DiscoveryEvent::Started {
            message: format!("Starting discovery ({})...", methods.join(" + ")),
        })
        .await
        .is_err()
    {
        return;
    }

    // Create internal channel for coordinating discovery methods
    let (internal_tx, mut internal_rx) = mpsc::channel::<InternalEvent>(100);
    let state = Arc::new(Mutex::new(DiscoveryState::new(active_methods)));

    // Start mDNS discovery if enabled
    if config.mdns_enabled {
        let internal_tx = internal_tx.clone();
        tokio::spawn(async move {
            let (mdns_tx, mut mdns_rx) = mpsc::channel::<DiscoveryEvent>(100);

            // Spawn the mDNS discovery
            tokio::spawn(async move {
                run_mdns_discovery(mdns_tx).await;
            });

            // Forward events
            while let Some(event) = mdns_rx.recv().await {
                match event {
                    DiscoveryEvent::DeviceFound { device } | DiscoveryEvent::DeviceUpdated { device } => {
                        if internal_tx.send(InternalEvent::Device(device)).await.is_err() {
                            break;
                        }
                    }
                    DiscoveryEvent::Started { .. } => {
                        let _ = internal_tx.send(InternalEvent::Started("mDNS".to_string())).await;
                    }
                    DiscoveryEvent::Completed { .. } => {
                        let _ = internal_tx.send(InternalEvent::Completed("mDNS".to_string())).await;
                        break;
                    }
                    DiscoveryEvent::Error { message } => {
                        let _ = internal_tx.send(InternalEvent::Error(format!("mDNS: {}", message))).await;
                        break;
                    }
                }
            }
        });
    }

    // Start IP scan if enabled
    if config.ip_scan_enabled {
        if let Some(ip_config) = config.ip_scan {
            let internal_tx = internal_tx.clone();

            // Build IP scan request
            let range = if let Some(cidr) = ip_config.cidr {
                Some(IpRangeSpec::Cidr { cidr })
            } else if let (Some(start), Some(end)) = (ip_config.start_ip, ip_config.end_ip) {
                Some(IpRangeSpec::Range {
                    start_ip: start,
                    end_ip: end,
                })
            } else {
                None
            };

            if let Some(range) = range {
                let request = IpScanRequest {
                    range,
                    ports: ip_config.ports,
                    timeout_ms: ip_config.timeout_ms,
                    concurrency: ip_config.concurrency,
                };

                tokio::spawn(async move {
                    let (scan_tx, mut scan_rx) = mpsc::channel::<DiscoveryEvent>(100);

                    // Spawn the IP scan
                    tokio::spawn(async move {
                        run_ip_scan_discovery(scan_tx, request).await;
                    });

                    // Forward events
                    while let Some(event) = scan_rx.recv().await {
                        match event {
                            DiscoveryEvent::DeviceFound { device } | DiscoveryEvent::DeviceUpdated { device } => {
                                if internal_tx.send(InternalEvent::Device(device)).await.is_err() {
                                    break;
                                }
                            }
                            DiscoveryEvent::Started { .. } => {
                                let _ = internal_tx.send(InternalEvent::Started("IP Scan".to_string())).await;
                            }
                            DiscoveryEvent::Completed { .. } => {
                                let _ = internal_tx.send(InternalEvent::Completed("IP Scan".to_string())).await;
                                break;
                            }
                            DiscoveryEvent::Error { message } => {
                                let _ = internal_tx.send(InternalEvent::Error(format!("IP Scan: {}", message))).await;
                                break;
                            }
                        }
                    }
                });
            }
        }
    }

    // Drop our copy of internal_tx so the channel closes when all methods complete
    drop(internal_tx);

    // Process internal events and send merged results
    while let Some(event) = internal_rx.recv().await {
        if tx.is_closed() {
            info!("Client disconnected, stopping unified discovery");
            break;
        }

        match event {
            InternalEvent::Device(device) => {
                let mut state = state.lock().await;
                if let Some((merged_device, is_new)) = state.merge_device(device) {
                    let event = if is_new {
                        DiscoveryEvent::DeviceFound { device: merged_device }
                    } else {
                        DiscoveryEvent::DeviceUpdated { device: merged_device }
                    };
                    if tx.send(event).await.is_err() {
                        break;
                    }
                }
            }
            InternalEvent::Started(method) => {
                debug!("{} discovery started", method);
            }
            InternalEvent::Completed(method) => {
                debug!("{} discovery completed", method);
                let mut state = state.lock().await;
                if state.method_completed() {
                    // All methods completed
                    let device_count = state.devices.len();
                    let _ = tx
                        .send(DiscoveryEvent::Completed {
                            message: format!("Discovery complete. Found {} devices.", device_count),
                            device_count,
                        })
                        .await;
                    break;
                }
            }
            InternalEvent::Error(message) => {
                // Log error but continue with other methods
                debug!("Discovery error: {}", message);
            }
        }
    }

    info!("Unified discovery finished");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_merge() {
        let mut state = DiscoveryState::new(2);

        // First device from mDNS
        let device1 = DiscoveredDevice {
            name: "My Device".to_string(),
            address: "192.168.1.100".to_string(),
            addresses: vec!["192.168.1.100".to_string()],
            hostname: "mydevice.local".to_string(),
            services: vec![],
            txt_properties: HashMap::new(),
            ttl: None,
            discovery_method: "mdns".to_string(),
        };

        let result = state.merge_device(device1);
        assert!(result.is_some());
        let (device, is_new) = result.unwrap();
        assert!(is_new);
        assert_eq!(device.name, "My Device");

        // Same device from IP scan
        let device2 = DiscoveredDevice {
            name: "192.168.1.100".to_string(),
            address: "192.168.1.100".to_string(),
            addresses: vec!["192.168.1.100".to_string()],
            hostname: "192.168.1.100".to_string(),
            services: vec![],
            txt_properties: HashMap::new(),
            ttl: None,
            discovery_method: "ip_scan".to_string(),
        };

        let result = state.merge_device(device2);
        assert!(result.is_some());
        let (device, is_new) = result.unwrap();
        assert!(!is_new); // Should be an update
        assert_eq!(device.name, "My Device"); // Should keep the better name
        assert!(device.discovery_method.contains("mdns"));
        assert!(device.discovery_method.contains("ip_scan"));
    }
}
