use crate::ping::PingResult;
use tsink::{DataPoint, Label, Row};

pub fn write_ping_result(storage: &dyn tsink::Storage, result: &PingResult) -> Result<(), Box<dyn std::error::Error>> {
    // Convert timestamp to Unix timestamp (seconds)
    let timestamp = result.timestamp.timestamp();
    
    // Build labels for the metric
    let mut labels = vec![
        Label::new("target", &result.target),
        Label::new("sequence", &result.sequence.to_string()),
    ];
    
    // Add target name label if available
    if let Some(ref name) = result.target_name {
        labels.push(Label::new("target_name", name));
    }
    
    // Create row based on ping result
    let row = if result.success {
        // For successful pings, store latency as the value
        let latency = result.latency_ms.unwrap_or(0.0);
        Row::with_labels("ping_latency", labels, DataPoint::new(timestamp, latency))
    } else {
        // For failed pings, store 0 as the value and use a different metric name
        Row::with_labels("ping_failed", labels, DataPoint::new(timestamp, 0.0))
    };
    
    // Insert the row into tsink
    storage.insert_rows(&[row])?;
    
    Ok(())
}

