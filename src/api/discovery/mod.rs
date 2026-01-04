use crate::device_identification::IdentifiedDiscoveryEvent;
use crate::ip_scan::{get_suggested_subnets, SubnetSuggestion};
use crate::unified_discovery::{run_unified_discovery, UnifiedDiscoveryConfig};
use async_stream::stream;
use axum::extract::Query;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::Json;
use futures::Stream;
use serde::Deserialize;
use std::convert::Infallible;
use tokio::sync::mpsc;
use tracing::{error, info};

/// HTTP handler for GET /api/discovery/subnets
///
/// Returns suggested subnets for IP scanning based on:
/// - Local network interfaces
/// - Traceroute to discover private network hops
pub async fn get_subnets() -> Json<Vec<SubnetSuggestion>> {
    info!("Getting subnet suggestions");

    // Run in blocking task since traceroute is a blocking operation
    let subnets = tokio::task::spawn_blocking(get_suggested_subnets)
        .await
        .unwrap_or_default();

    Json(subnets)
}

/// Query parameters for unified discovery
#[derive(Debug, Deserialize)]
pub struct UnifiedDiscoveryQuery {
    /// Enable mDNS discovery (default: true)
    #[serde(default = "default_true")]
    pub mdns: bool,
    /// Enable IP scan discovery (default: false)
    #[serde(default)]
    pub ip_scan: bool,
    /// CIDR notation for IP scan (e.g., "192.168.1.0/24")
    #[serde(default)]
    pub cidr: Option<String>,
    /// Start IP for custom range
    #[serde(default)]
    pub start_ip: Option<String>,
    /// End IP for custom range
    #[serde(default)]
    pub end_ip: Option<String>,
    /// Ports to check (comma-separated)
    #[serde(default)]
    pub ports: Option<String>,
    /// Timeout per connection in milliseconds
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// Number of concurrent connections
    #[serde(default)]
    pub concurrency: Option<usize>,
}

fn default_true() -> bool {
    true
}

/// HTTP handler for GET /api/discovery/unified (SSE endpoint)
///
/// Starts unified device discovery with multiple methods and streams merged results.
/// Devices discovered by multiple methods are deduplicated by IP address.
pub async fn start_unified_discovery(
    Query(query): Query<UnifiedDiscoveryQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    info!(
        "Starting unified discovery (mDNS: {}, IP scan: {})",
        query.mdns, query.ip_scan
    );

    // Build IP scan config if enabled
    let ip_scan_config = if query.ip_scan {
        // Parse ports
        let ports = query
            .ports
            .as_ref()
            .map(|p| p.split(',').filter_map(|s| s.trim().parse().ok()).collect())
            .unwrap_or_else(|| vec![80, 443, 22]);

        Some(crate::unified_discovery::IpScanConfig {
            cidr: query.cidr.clone(),
            start_ip: query.start_ip.clone(),
            end_ip: query.end_ip.clone(),
            ports,
            timeout_ms: query.timeout_ms.unwrap_or(500),
            concurrency: query.concurrency.unwrap_or(50),
        })
    } else {
        None
    };

    let config = UnifiedDiscoveryConfig {
        mdns_enabled: query.mdns,
        ip_scan_enabled: query.ip_scan,
        ip_scan: ip_scan_config,
    };

    let stream = stream! {
        let (tx, mut rx) = mpsc::channel::<IdentifiedDiscoveryEvent>(100);

        // Spawn the unified discovery task
        tokio::spawn(async move {
            run_unified_discovery(tx, config).await;
        });

        // Stream events as they arrive
        while let Some(event) = rx.recv().await {
            match serde_json::to_string(&event) {
                Ok(json) => {
                    yield Ok(Event::default().data(json));
                }
                Err(e) => {
                    error!("Failed to serialize discovery event: {}", e);
                }
            }

            // If this was an error or completed event, we're done
            if matches!(event, IdentifiedDiscoveryEvent::Error { .. } | IdentifiedDiscoveryEvent::Completed { .. }) {
                break;
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}
