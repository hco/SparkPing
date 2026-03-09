use crate::config::SocketType;
use crate::icmp;
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

    let start = Instant::now();
    let ping_result = tokio::task::spawn_blocking(move || match socket_type {
        SocketType::DgramNative => {
            let ident = (std::process::id() as u16).wrapping_add(sequence);
            icmp::ping_dgram(ip_addr, Duration::from_secs(5), ident, sequence)
                .map(|rtt| rtt.as_secs_f64() * 1000.0)
        }
        SocketType::Dgram => ping::new(ip_addr)
            .timeout(Duration::from_secs(5))
            .ttl(64)
            .seq_cnt(sequence)
            .socket_type(ping::SocketType::DGRAM)
            .send()
            .map(|_| start.elapsed().as_secs_f64() * 1000.0)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string())),
        SocketType::Raw => ping::new(ip_addr)
            .timeout(Duration::from_secs(5))
            .ttl(64)
            .seq_cnt(sequence)
            .socket_type(ping::SocketType::RAW)
            .send()
            .map(|_| start.elapsed().as_secs_f64() * 1000.0)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string())),
    })
    .await
    .unwrap_or_else(|e| Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())));
    let elapsed = start.elapsed();

    match ping_result {
        Ok(latency_ms) => {
            let latency_rounded = (latency_ms * 100.0).round() / 100.0;
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
            let latency_ms = elapsed.as_secs_f64() * 1000.0;
            warn!(
                target = %address,
                seq = sequence,
                error = %e,
                "✗ {} (seq {}) - Failed after {:.0}ms: {}", target_name, sequence, latency_ms, e
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
