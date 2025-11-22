use clap::Parser;
use config::Config;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tsink::{DataPoint, Label, Row, StorageBuilder};
use chrono::{DateTime, Utc};
use ping::ping;
use std::net::IpAddr;
use futures::future::join_all;
use tracing::{error, info, warn, debug};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, fmt};
use std::fs::OpenOptions;

/// SparkPing - A Rust application with configurable settings
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// Path to the configuration file (TOML format)
    #[arg(short, long, default_value = "config.toml")]
    config: PathBuf,
}

#[derive(Debug, Deserialize)]
struct AppConfig {
    server: ServerConfig,
    logging: LoggingConfig,
    database: DatabaseConfig,
    targets: Vec<Target>,
}

#[derive(Debug, Deserialize)]
struct ServerConfig {
    host: String,
    port: u16,
}

#[derive(Debug, Deserialize)]
struct LoggingConfig {
    level: String,
    file: String,
}

#[derive(Debug, Deserialize)]
struct DatabaseConfig {
    path: String,
}

#[derive(Debug, Deserialize)]
struct Target {
    address: String,
    name: Option<String>,
    /// Number of pings to perform per cycle (default: 3)
    #[serde(default = "default_ping_count")]
    ping_count: u16,
    /// Delay between individual pings in seconds (default: 1)
    #[serde(default = "default_ping_interval")]
    ping_interval: u64,
}

fn default_ping_count() -> u16 {
    3
}

fn default_ping_interval() -> u64 {
    1
}

struct PingResult {
    timestamp: DateTime<Utc>,
    target: String,
    target_name: Option<String>,
    sequence: u16,
    success: bool,
    latency_ms: Option<f64>,
}

// Custom time formatter for human-readable dates
struct HumanReadableTimer;

impl tracing_subscriber::fmt::time::FormatTime for HumanReadableTimer {
    fn format_time(&self, w: &mut tracing_subscriber::fmt::format::Writer<'_>) -> std::fmt::Result {
        let now = chrono::Local::now();
        write!(w, "{}", now.format("%Y-%m-%d %H:%M:%S%.3f"))
    }
}

fn init_logging(log_config: &LoggingConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Parse log level from config, defaulting to "info" if invalid
    let log_level = log_config.level.to_lowercase();
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&log_level));
    
    // Create file appender
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_config.file)?;
    
    // Build subscriber with both console and file outputs
    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            fmt::layer()
                .with_writer(std::io::stderr)
                .with_ansi(true)
                .with_timer(HumanReadableTimer)
                .compact()  // More compact, readable format for console
        )
        .with(
            fmt::layer()
                .with_writer(file)
                .with_ansi(false)
        )
        .init();
    
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    // Load configuration from the specified file
    let settings = Config::builder()
        .add_source(config::File::with_name(
            args.config.to_str().expect("Invalid config file path"),
        ))
        .build()?;

    let app_config: AppConfig = settings.try_deserialize()?;
    
    // Initialize logging before any other output
    init_logging(&app_config.logging)?;
    
    info!("Configuration loaded successfully from: {:?}", args.config);
    info!("Server: {}:{}", app_config.server.host, app_config.server.port);
    debug!("Logging: level={}, file={}", app_config.logging.level, app_config.logging.file);
    info!("Database path: {}", app_config.database.path);
    info!("Targets to ping:");
    for target in &app_config.targets {
        match &target.name {
            Some(name) => info!("  - {} ({})", target.address, name),
            None => info!("  - {}", target.address),
        }
    }

    // Initialize tsink storage with configured path
    let storage = Arc::new(StorageBuilder::new()
        .with_data_path(&app_config.database.path)
        .build()?);

    info!("tsink database initialized at: {}", app_config.database.path);
    info!("Starting ping loop (each target runs independently in parallel)...");
    for target in &app_config.targets {
        info!("  - {}: {} pings back-to-back, then wait {}s", 
            target.name.as_ref().unwrap_or(&target.address),
            target.ping_count,
            target.ping_interval
        );
    }

    // Spawn a continuous loop for each target
    let target_tasks: Vec<_> = app_config.targets.iter().map(|target| {
        let target_address = target.address.clone();
        let target_name = target.name.clone();
        let ping_count = target.ping_count;
        let ping_interval = target.ping_interval;
        let storage_clone = storage.clone();
        
        tokio::spawn(async move {
            loop {
                // Perform ping_count pings back-to-back (no delay between them)
                for sequence in 1..=ping_count {
                    let result = perform_ping(&target_address, sequence, &target_name).await;
                    
                    // Write result to tsink
                    if let Err(e) = write_ping_result(&**storage_clone, &result) {
                        error!("Error writing ping result to tsink: {}", e);
                    }
                }
                
                // Wait ping_interval seconds before next batch of pings
                tokio::time::sleep(Duration::from_secs(ping_interval)).await;
            }
        })
    }).collect();
    
    // Wait for all target tasks (they run forever, so this will block indefinitely)
    join_all(target_tasks).await;
    
    // This will never be reached, but needed for the return type
    Ok(())
}

async fn perform_ping(address: &str, sequence: u16, name: &Option<String>) -> PingResult {
    let timestamp = Utc::now();
    
    // Parse the address to IpAddr
    let ip_addr: IpAddr = match address.parse() {
        Ok(ip) => ip,
        Err(e) => {
            error!("Invalid IP address {}: {}", address, e);
            return PingResult {
                timestamp,
                target: address.to_string(),
                target_name: name.clone(),
                sequence,
                success: false,
                latency_ms: None,
            };
        }
    };
    
    // Perform the ping with a 2 second timeout
    // Measure time manually since ping() doesn't return latency
    let start = Instant::now();
    let ping_result = ping(
        ip_addr, 
        Some(Duration::from_secs(2)), 
        Some(64), 
        None,  // ident
        Some(sequence),  // seq_cnt
        None  // payload
    );
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
                target: address.to_string(),
                target_name: name.clone(),
                sequence,
                success: false,
                latency_ms: None,
            }
        }
    }
}

fn write_ping_result(storage: &dyn tsink::Storage, result: &PingResult) -> Result<(), Box<dyn std::error::Error>> {
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
