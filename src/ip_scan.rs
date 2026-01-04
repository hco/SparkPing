//! IP scan discovery module for finding devices by scanning IP ranges.
//!
//! This module provides functionality to discover devices by scanning
//! IP address ranges and attempting to connect to them via ping or TCP.

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::process::Command;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tracing::{debug, error, info, warn};

use crate::discovery::{DiscoveredDevice, DiscoveryEvent};

/// A subnet with additional metadata for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubnetSuggestion {
    /// Human-readable label for this subnet
    pub label: String,
    /// The subnet in CIDR notation (e.g., "192.168.1.0/24")
    pub cidr: String,
    /// Subnet mask (e.g., "255.255.255.0")
    pub subnet_mask: String,
    /// First usable IP in the range
    pub start_ip: String,
    /// Last usable IP in the range
    pub end_ip: String,
    /// Number of hosts in this subnet
    pub host_count: u32,
    /// Source of this suggestion (e.g., "local", "traceroute")
    pub source: String,
}

/// IP range specification for scanning
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpRangeSpec {
    /// Subnet specified in CIDR notation
    Cidr { cidr: String },
    /// Custom start and end IP range
    Range { start_ip: String, end_ip: String },
}

/// Request to start an IP scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpScanRequest {
    /// The IP range to scan
    pub range: IpRangeSpec,
    /// Ports to check for connectivity (default: [80, 443, 22])
    #[serde(default = "default_ports")]
    pub ports: Vec<u16>,
    /// Timeout for each connection attempt in milliseconds (default: 500)
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    /// Number of concurrent scans (default: 50)
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
}

fn default_ports() -> Vec<u16> {
    vec![80, 443, 22]
}

fn default_timeout_ms() -> u64 {
    500
}

fn default_concurrency() -> usize {
    50
}

/// Parse a CIDR notation string into network address, prefix length, and range
fn parse_cidr(cidr: &str) -> Result<(Ipv4Addr, u8, Ipv4Addr, Ipv4Addr), String> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid CIDR notation: {}", cidr));
    }

    let ip: Ipv4Addr = parts[0]
        .parse()
        .map_err(|e| format!("Invalid IP address: {}", e))?;
    let prefix: u8 = parts[1]
        .parse()
        .map_err(|e| format!("Invalid prefix length: {}", e))?;

    if prefix > 32 {
        return Err(format!("Invalid prefix length: {}", prefix));
    }

    // Calculate network mask
    let mask = if prefix == 0 {
        0u32
    } else {
        !0u32 << (32 - prefix)
    };

    let ip_u32 = u32::from(ip);
    let network = ip_u32 & mask;

    // Calculate first and last IP in range (excluding network and broadcast for /24 and larger)
    let (start, end) = if prefix >= 31 {
        // For /31 and /32, use all addresses
        (network, network | !mask)
    } else {
        // Skip network address and broadcast
        (network + 1, (network | !mask) - 1)
    };

    Ok((ip, prefix, Ipv4Addr::from(start), Ipv4Addr::from(end)))
}

/// Parse an IP range from start and end addresses
fn parse_ip_range(start: &str, end: &str) -> Result<(Ipv4Addr, Ipv4Addr), String> {
    let start_ip: Ipv4Addr = start
        .parse()
        .map_err(|e| format!("Invalid start IP: {}", e))?;
    let end_ip: Ipv4Addr = end.parse().map_err(|e| format!("Invalid end IP: {}", e))?;

    if u32::from(start_ip) > u32::from(end_ip) {
        return Err("Start IP must be less than or equal to end IP".to_string());
    }

    Ok((start_ip, end_ip))
}

/// Get all IPs in a range
fn get_ips_in_range(start: Ipv4Addr, end: Ipv4Addr) -> Vec<Ipv4Addr> {
    let start_u32 = u32::from(start);
    let end_u32 = u32::from(end);
    (start_u32..=end_u32).map(Ipv4Addr::from).collect()
}

/// Convert prefix length to subnet mask
fn prefix_to_mask(prefix: u8) -> Ipv4Addr {
    if prefix == 0 {
        Ipv4Addr::new(0, 0, 0, 0)
    } else {
        let mask = !0u32 << (32 - prefix);
        Ipv4Addr::from(mask)
    }
}

/// Check if an IP is a private network address
fn is_private_ip(ip: &Ipv4Addr) -> bool {
    let octets = ip.octets();
    // 10.0.0.0/8
    if octets[0] == 10 {
        return true;
    }
    // 172.16.0.0/12
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return true;
    }
    // 192.168.0.0/16
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }
    false
}

/// Get the local machine's network interfaces and their subnets
pub fn get_local_subnets() -> Vec<SubnetSuggestion> {
    let mut subnets = Vec::new();

    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for iface in interfaces {
            // Skip loopback interfaces
            if iface.is_loopback() {
                continue;
            }

            if let IpAddr::V4(ip) = iface.addr.ip() {
                // Skip non-private IPs
                if !is_private_ip(&ip) {
                    continue;
                }

                // Get the prefix length from the interface
                let prefix = match &iface.addr {
                    if_addrs::IfAddr::V4(v4) => {
                        // Count leading 1s in the netmask
                        let mask_u32 = u32::from(v4.netmask);
                        mask_u32.leading_ones() as u8
                    }
                    _ => 24, // Default to /24
                };

                let mask = prefix_to_mask(prefix);
                let ip_u32 = u32::from(ip);
                let mask_u32 = u32::from(mask);
                let network = Ipv4Addr::from(ip_u32 & mask_u32);

                // Calculate host count
                let host_count = if prefix >= 31 {
                    2u32.pow(32 - prefix as u32)
                } else {
                    2u32.pow(32 - prefix as u32) - 2 // Exclude network and broadcast
                };

                // Calculate first and last usable IP
                let network_u32 = u32::from(network);
                let (start, end) = if prefix >= 31 {
                    (network_u32, network_u32 | !mask_u32)
                } else {
                    (network_u32 + 1, (network_u32 | !mask_u32) - 1)
                };

                subnets.push(SubnetSuggestion {
                    label: format!("{} ({})", iface.name, ip),
                    cidr: format!("{}/{}", network, prefix),
                    subnet_mask: mask.to_string(),
                    start_ip: Ipv4Addr::from(start).to_string(),
                    end_ip: Ipv4Addr::from(end).to_string(),
                    host_count,
                    source: "local".to_string(),
                });
            }
        }
    }

    subnets
}

/// Run traceroute and extract private network hops
pub fn get_traceroute_subnets() -> Vec<SubnetSuggestion> {
    let mut subnets = Vec::new();
    let mut seen_networks = std::collections::HashSet::new();

    // Run traceroute to a well-known public IP (Google's DNS)
    let output = if cfg!(any(target_os = "macos", target_os = "linux")) {
        Command::new("traceroute")
            .args(["-n", "-m", "10", "-q", "1", "8.8.8.8"])
            .output()
    } else if cfg!(target_os = "windows") {
        Command::new("tracert")
            .args(["-d", "-h", "10", "8.8.8.8"])
            .output()
    } else {
        return subnets;
    };

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            debug!("Traceroute output:\n{}", stdout);

            for line in stdout.lines() {
                // Parse IP addresses from traceroute output
                // Format varies by OS but generally includes IP addresses
                for word in line.split_whitespace() {
                    // Try to parse as IPv4 address
                    if let Ok(ip) = word
                        .trim_matches(|c| c == '(' || c == ')')
                        .parse::<Ipv4Addr>()
                    {
                        // Stop if we hit a public IP
                        if !is_private_ip(&ip) {
                            debug!("Hit public IP {}, stopping traceroute parsing", ip);
                            return subnets;
                        }

                        // Assume /24 for discovered networks
                        let octets = ip.octets();
                        let network = Ipv4Addr::new(octets[0], octets[1], octets[2], 0);
                        let network_key = format!("{}/24", network);

                        if !seen_networks.contains(&network_key) {
                            seen_networks.insert(network_key.clone());
                            subnets.push(SubnetSuggestion {
                                label: format!("Gateway network (hop via {})", ip),
                                cidr: network_key,
                                subnet_mask: "255.255.255.0".to_string(),
                                start_ip: format!("{}.{}.{}.1", octets[0], octets[1], octets[2]),
                                end_ip: format!("{}.{}.{}.254", octets[0], octets[1], octets[2]),
                                host_count: 254,
                                source: "traceroute".to_string(),
                            });
                        }
                    }
                }
            }
        }
        Err(e) => {
            warn!("Failed to run traceroute: {}", e);
        }
    }

    subnets
}

/// Get all suggested subnets (local + traceroute)
pub fn get_suggested_subnets() -> Vec<SubnetSuggestion> {
    let mut subnets = Vec::new();

    // Add local subnets first
    subnets.extend(get_local_subnets());

    // Add traceroute subnets
    let traceroute_subnets = get_traceroute_subnets();

    // Filter out duplicates (same CIDR)
    let existing_cidrs: std::collections::HashSet<_> =
        subnets.iter().map(|s| s.cidr.clone()).collect();

    for subnet in traceroute_subnets {
        if !existing_cidrs.contains(&subnet.cidr) {
            subnets.push(subnet);
        }
    }

    subnets
}

/// Check if a host is reachable on any of the specified ports
async fn check_host(ip: Ipv4Addr, ports: &[u16], timeout_duration: Duration) -> Option<u16> {
    for &port in ports {
        let addr = format!("{}:{}", ip, port);
        if let Ok(result) = timeout(timeout_duration, TcpStream::connect(&addr)).await {
            if result.is_ok() {
                return Some(port);
            }
        }
    }
    None
}

/// Run IP scan discovery and send discovered devices to the channel
pub async fn run_ip_scan_discovery(tx: mpsc::Sender<DiscoveryEvent>, request: IpScanRequest) {
    info!("Starting IP scan discovery");

    // Send started event
    if tx
        .send(DiscoveryEvent::Started {
            message: "Starting IP scan...".to_string(),
        })
        .await
        .is_err()
    {
        return;
    }

    // Parse the IP range
    let ips_to_scan = match &request.range {
        IpRangeSpec::Cidr { cidr } => match parse_cidr(cidr) {
            Ok((_, _, start, end)) => get_ips_in_range(start, end),
            Err(e) => {
                error!("Failed to parse CIDR: {}", e);
                let _ = tx
                    .send(DiscoveryEvent::Error {
                        message: format!("Invalid CIDR notation: {}", e),
                    })
                    .await;
                return;
            }
        },
        IpRangeSpec::Range { start_ip, end_ip } => match parse_ip_range(start_ip, end_ip) {
            Ok((start, end)) => get_ips_in_range(start, end),
            Err(e) => {
                error!("Failed to parse IP range: {}", e);
                let _ = tx
                    .send(DiscoveryEvent::Error {
                        message: format!("Invalid IP range: {}", e),
                    })
                    .await;
                return;
            }
        },
    };

    let total_ips = ips_to_scan.len();
    info!("Scanning {} IP addresses", total_ips);

    // Update status message
    let _ = tx
        .send(DiscoveryEvent::Started {
            message: format!("Scanning {} IP addresses...", total_ips),
        })
        .await;

    let timeout_duration = Duration::from_millis(request.timeout_ms);
    let ports = request.ports.clone();
    let concurrency = request.concurrency;

    // Use a semaphore to limit concurrency
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut handles = Vec::new();
    let found_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for ip in ips_to_scan {
        if tx.is_closed() {
            info!("Client disconnected, stopping IP scan");
            break;
        }

        let semaphore = semaphore.clone();
        let tx = tx.clone();
        let ports = ports.clone();
        let found_count = found_count.clone();

        let handle = tokio::spawn(async move {
            let _permit = semaphore.acquire().await;

            if let Some(port) = check_host(ip, &ports, timeout_duration).await {
                let device = DiscoveredDevice {
                    name: ip.to_string(),
                    address: ip.to_string(),
                    addresses: vec![ip.to_string()],
                    hostname: ip.to_string(),
                    services: vec![],
                    txt_properties: std::collections::HashMap::new(),
                    ttl: None,
                    discovery_method: format!("ip_scan (port {})", port),
                    vendor_info: None,
                };

                found_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let _ = tx.send(DiscoveryEvent::DeviceFound { device }).await;
            }
        });

        handles.push(handle);
    }

    // Wait for all scans to complete
    for handle in handles {
        let _ = handle.await;
    }

    let final_count = found_count.load(std::sync::atomic::Ordering::SeqCst);
    info!("IP scan completed, found {} devices", final_count);

    let _ = tx
        .send(DiscoveryEvent::Completed {
            message: format!("Scan complete. Found {} devices.", final_count),
            device_count: final_count,
        })
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cidr() {
        let (ip, prefix, start, end) = parse_cidr("192.168.1.0/24").unwrap();
        assert_eq!(ip, Ipv4Addr::new(192, 168, 1, 0));
        assert_eq!(prefix, 24);
        assert_eq!(start, Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(end, Ipv4Addr::new(192, 168, 1, 254));
    }

    #[test]
    fn test_parse_cidr_16() {
        let (_, prefix, start, end) = parse_cidr("10.0.0.0/16").unwrap();
        assert_eq!(prefix, 16);
        assert_eq!(start, Ipv4Addr::new(10, 0, 0, 1));
        assert_eq!(end, Ipv4Addr::new(10, 0, 255, 254));
    }

    #[test]
    fn test_parse_ip_range() {
        let (start, end) = parse_ip_range("192.168.1.1", "192.168.1.10").unwrap();
        assert_eq!(start, Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(end, Ipv4Addr::new(192, 168, 1, 10));
    }

    #[test]
    fn test_get_ips_in_range() {
        let start = Ipv4Addr::new(192, 168, 1, 1);
        let end = Ipv4Addr::new(192, 168, 1, 5);
        let ips = get_ips_in_range(start, end);
        assert_eq!(ips.len(), 5);
        assert_eq!(ips[0], Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(ips[4], Ipv4Addr::new(192, 168, 1, 5));
    }

    #[test]
    fn test_prefix_to_mask() {
        assert_eq!(prefix_to_mask(24), Ipv4Addr::new(255, 255, 255, 0));
        assert_eq!(prefix_to_mask(16), Ipv4Addr::new(255, 255, 0, 0));
        assert_eq!(prefix_to_mask(8), Ipv4Addr::new(255, 0, 0, 0));
    }

    #[test]
    fn test_is_private_ip() {
        assert!(is_private_ip(&Ipv4Addr::new(10, 0, 0, 1)));
        assert!(is_private_ip(&Ipv4Addr::new(172, 16, 0, 1)));
        assert!(is_private_ip(&Ipv4Addr::new(172, 31, 255, 255)));
        assert!(is_private_ip(&Ipv4Addr::new(192, 168, 1, 1)));
        assert!(!is_private_ip(&Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_private_ip(&Ipv4Addr::new(1, 1, 1, 1)));
    }
}
