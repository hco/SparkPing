use axum::body::Body;
use axum::http::Request;
use axum::{extract::ConnectInfo, http::StatusCode, middleware::Next, response::Response};
use std::net::SocketAddr;
use tracing::{debug, warn};

/// Home Assistant ingress IP addresses
/// The ingress gateway can be at either 172.30.32.1 or 172.30.32.2 depending on the setup
pub(crate) const HA_INGRESS_IPS: &[&str] = &["172.30.32.1", "172.30.32.2"];

/// Check if an IP address string is an allowed Home Assistant ingress IP
pub(crate) fn is_allowed_ingress_ip(ip: &str) -> bool {
    HA_INGRESS_IPS.contains(&ip)
}

/// Check if any IP in an X-Forwarded-For header matches an allowed ingress IP
/// The header format is: "client_ip, proxy1_ip, proxy2_ip, ..."
pub(crate) fn check_xff_contains_ingress_ip(xff_header: &str) -> bool {
    xff_header
        .split(',')
        .map(|s| s.trim())
        .any(|ip| is_allowed_ingress_ip(ip))
}

/// Create middleware for Home Assistant ingress IP filtering
pub(crate) async fn ingress_ip_filter_middleware(
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let start = std::time::Instant::now();

    // Determine the remote peer IP from the connection info.
    // In Home Assistant ingress mode, the TCP peer should be the
    // supervisor's ingress proxy (typically 172.30.32.1 or 172.30.32.2).
    // The original client (browser) IP is usually forwarded via
    // X-Forwarded-For; we log it for diagnostics but do not use
    // it for access control.
    let peer_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.ip());

    let forwarded_for = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    // Check if peer IP matches any of the allowed ingress IPs
    let is_allowed = if let Some(ip) = peer_ip {
        is_allowed_ingress_ip(&ip.to_string())
    } else {
        // Fallback: if ConnectInfo is not available, check X-Forwarded-For
        if let Some(ref xff) = forwarded_for {
            check_xff_contains_ingress_ip(xff)
        } else {
            false
        }
    };

    debug!(
        "Ingress check took {:?} - peer: {:?}, xff: {:?}, allowed: {}",
        start.elapsed(),
        peer_ip.map(|ip| ip.to_string()),
        forwarded_for,
        is_allowed
    );

    if !is_allowed {
        warn!(
            "Rejected request - peer IP: {:?}, X-Forwarded-For: {:?}",
            peer_ip.map(|ip| ip.to_string()),
            forwarded_for
        );
        return Err(StatusCode::FORBIDDEN);
    }

    let check_elapsed = start.elapsed();
    let result = next.run(req).await;
    let total_elapsed = start.elapsed();

    debug!(
        "Request timing - middleware check: {:?}, handler: {:?}, total: {:?}",
        check_elapsed,
        total_elapsed - check_elapsed,
        total_elapsed
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_allowed_ingress_ip_valid_ips() {
        // Both known Home Assistant ingress IPs should be allowed
        assert!(is_allowed_ingress_ip("172.30.32.1"));
        assert!(is_allowed_ingress_ip("172.30.32.2"));
    }

    #[test]
    fn test_is_allowed_ingress_ip_invalid_ips() {
        // Other IPs should be rejected
        assert!(!is_allowed_ingress_ip("192.168.1.1"));
        assert!(!is_allowed_ingress_ip("10.0.0.1"));
        assert!(!is_allowed_ingress_ip("172.30.32.3"));
        assert!(!is_allowed_ingress_ip("127.0.0.1"));
        assert!(!is_allowed_ingress_ip("0.0.0.0"));
    }

    #[test]
    fn test_is_allowed_ingress_ip_edge_cases() {
        // Empty string should be rejected
        assert!(!is_allowed_ingress_ip(""));
        // Partial matches should be rejected
        assert!(!is_allowed_ingress_ip("172.30.32"));
        assert!(!is_allowed_ingress_ip("172.30.32.10"));
        // Whitespace should not be trimmed (caller's responsibility)
        assert!(!is_allowed_ingress_ip(" 172.30.32.1"));
        assert!(!is_allowed_ingress_ip("172.30.32.1 "));
    }

    #[test]
    fn test_check_xff_contains_ingress_ip_single_ip() {
        // Single ingress IP in header
        assert!(check_xff_contains_ingress_ip("172.30.32.1"));
        assert!(check_xff_contains_ingress_ip("172.30.32.2"));
        // Single non-ingress IP
        assert!(!check_xff_contains_ingress_ip("192.168.1.1"));
    }

    #[test]
    fn test_check_xff_contains_ingress_ip_chain() {
        // Typical chain: client -> ingress proxy
        assert!(check_xff_contains_ingress_ip("192.168.83.217, 172.30.32.1"));
        assert!(check_xff_contains_ingress_ip("192.168.83.217, 172.30.32.2"));
        // Chain without ingress IP
        assert!(!check_xff_contains_ingress_ip("192.168.83.217, 10.0.0.1"));
    }

    #[test]
    fn test_check_xff_contains_ingress_ip_multiple_proxies() {
        // Multiple proxies, ingress in the middle
        assert!(check_xff_contains_ingress_ip(
            "192.168.1.1, 172.30.32.1, 10.0.0.1"
        ));
        // Multiple proxies, ingress at the end
        assert!(check_xff_contains_ingress_ip(
            "192.168.1.1, 10.0.0.1, 172.30.32.2"
        ));
        // Multiple proxies, no ingress
        assert!(!check_xff_contains_ingress_ip(
            "192.168.1.1, 10.0.0.1, 10.0.0.2"
        ));
    }

    #[test]
    fn test_check_xff_contains_ingress_ip_whitespace_handling() {
        // Extra whitespace should be handled
        assert!(check_xff_contains_ingress_ip("  172.30.32.1  "));
        assert!(check_xff_contains_ingress_ip("192.168.1.1,   172.30.32.1"));
        assert!(check_xff_contains_ingress_ip(
            "192.168.1.1 , 172.30.32.1 , 10.0.0.1"
        ));
    }

    #[test]
    fn test_check_xff_contains_ingress_ip_empty() {
        assert!(!check_xff_contains_ingress_ip(""));
    }
}
