use crate::config::SocketType;
use chrono::{DateTime, Utc};
use std::net::IpAddr;
use std::time::{Duration, Instant};
use tracing::{debug, error, warn};

pub struct PingResult {
    pub timestamp: DateTime<Utc>,
    pub target_id: String,
    pub target: String,
    pub target_name: Option<String>,
    pub sequence: u16,
    pub success: bool,
    pub latency_ms: Option<f64>,
}

pub async fn perform_ping(
    target_id: &str,
    address: &str,
    sequence: u16,
    name: &Option<String>,
    socket_type: SocketType,
) -> PingResult {
    let timestamp = Utc::now();

    // Parse the address to IpAddr
    let ip_addr: IpAddr = match address.parse() {
        Ok(ip) => ip,
        Err(e) => {
            error!("Invalid IP address {}: {}", address, e);
            return PingResult {
                timestamp,
                target_id: target_id.to_string(),
                target: address.to_string(),
                target_name: name.clone(),
                sequence,
                success: false,
                latency_ms: None,
            };
        }
    };

    // Convert our SocketType to ping crate's SocketType
    let ping_socket_type = match socket_type {
        SocketType::Dgram => ping::SocketType::DGRAM,
        SocketType::Raw => ping::SocketType::RAW,
    };

    // Perform the ping with a 2 second timeout using the builder pattern
    // Measure time manually since ping() doesn't return latency
    let start = Instant::now();
    let ping_result = ping::new(ip_addr)
        .timeout(Duration::from_secs(2))
        .ttl(64)
        .seq_cnt(sequence)
        .socket_type(ping_socket_type)
        .send();
    let elapsed = start.elapsed();

    match ping_result {
        Ok(_) => {
            let latency_ms = elapsed.as_secs_f64() * 1000.0;
            let latency_rounded = (latency_ms * 100.0).round() / 100.0; // Round to 2 decimal places
            let target_name = name.as_ref().map(|s| s.as_str()).unwrap_or(address);
            debug!(
                target = %address,
                seq = sequence,
                latency_ms = latency_rounded,
                "✓ {} (seq {}) - {:.2}ms", target_name, sequence, latency_rounded
            );
            PingResult {
                timestamp,
                target_id: target_id.to_string(),
                target: address.to_string(),
                target_name: name.clone(),
                sequence,
                success: true,
                latency_ms: Some(latency_ms),
            }
        }
        Err(e) => {
            let target_name = name.as_ref().map(|s| s.as_str()).unwrap_or(address);
            warn!(
                target = %address,
                seq = sequence,
                error = %e,
                "✗ {} (seq {}) - Failed: {}", target_name, sequence, e
            );
            PingResult {
                timestamp,
                target_id: target_id.to_string(),
                target: address.to_string(),
                target_name: name.clone(),
                sequence,
                success: false,
                latency_ms: None,
            }
        }
    }
}
