mod api;
mod config;
mod logging;
mod ping;
mod storage;

use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tsink::{StorageBuilder, TimestampPrecision};
use futures::future::join_all;
use tracing::{error, info, debug};
use chrono::{DateTime, Utc};
use tokio::signal;
use crate::api::create_router;
use crate::config::AppConfig;
use crate::logging::init_logging;
use crate::ping::perform_ping;
use crate::storage::write_ping_result;

/// SparkPing - A Rust application with configurable settings
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// Path to the configuration file (TOML format)
    #[arg(short, long, default_value = "config.toml")]
    config: PathBuf,
}

/// Get the time range of all data in tsink storage
fn get_data_time_range(storage: &dyn tsink::Storage) -> Result<Option<(i64, i64)>, Box<dyn std::error::Error>> {
    let mut earliest: Option<i64> = None;
    let mut latest: Option<i64> = None;
    
    // Query both metrics
    for metric_name in &["ping_latency", "ping_failed"] {
        let all_results = storage.select_all(metric_name, 0, i64::MAX)?;
        for (_labels, points) in all_results {
            for point in points {
                if earliest.is_none() || point.timestamp < earliest.unwrap() {
                    earliest = Some(point.timestamp);
                }
                if latest.is_none() || point.timestamp > latest.unwrap() {
                    latest = Some(point.timestamp);
                }
            }
        }
    }
    
    match (earliest, latest) {
        (Some(e), Some(l)) => Ok(Some((e, l))),
        _ => Ok(None),
    }
}

/// Count total number of data points in tsink storage
fn count_data_points(storage: &dyn tsink::Storage) -> Result<usize, Box<dyn std::error::Error>> {
    let mut count = 0;
    
    // Query both metrics
    for metric_name in &["ping_latency", "ping_failed"] {
        let all_results = storage.select_all(metric_name, 0, i64::MAX)?;
        for (_labels, points) in all_results {
            count += points.len();
        }
    }
    
    Ok(count)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    // Load configuration from the specified file
    let settings = ::config::Config::builder()
        .add_source(::config::File::with_name(
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
    // WAL is enabled by default, but let's make sure
    let storage = Arc::new(StorageBuilder::new()
        .with_data_path(&app_config.database.path)
        .with_wal_enabled(true)
        .with_retention(Duration::from_secs(365 * 24 * 3600 * 20))  // 20 years
        .with_timestamp_precision(TimestampPrecision::Milliseconds)
        .with_max_writers(16)
        .with_write_timeout(Duration::from_secs(60))
        .with_partition_duration(Duration::from_secs(6 * 3600))  // 6 hours
        .with_wal_buffer_size(16384)  // 16KB
        .build()?);


    info!("tsink database initialized at: {}", app_config.database.path);
    
    // Check if WAL directory exists and has files
    let wal_path = std::path::Path::new(&app_config.database.path).join("wal");
    if wal_path.exists() {
        let wal_files: Vec<_> = std::fs::read_dir(&wal_path)
            .unwrap_or_else(|_| std::fs::read_dir(".").unwrap())
            .filter_map(|e| e.ok())
            .collect();
        info!("WAL-Verzeichnis gefunden mit {} Dateien", wal_files.len());
        for entry in wal_files.iter().take(5) {
            if let Ok(metadata) = entry.metadata() {
                info!("  WAL-Datei: {} ({} Bytes)", 
                    entry.file_name().to_string_lossy(),
                    metadata.len()
                );
            }
        }
    } else {
        info!("WAL-Verzeichnis nicht gefunden: {:?}", wal_path);
    }
    
    // Query and display data time range
    match get_data_time_range(&**storage) {
        Ok(Some((earliest, latest))) => {
            let earliest_dt = DateTime::from_timestamp(earliest, 0)
                .unwrap_or_else(|| Utc::now());
            let latest_dt = DateTime::from_timestamp(latest, 0)
                .unwrap_or_else(|| Utc::now());
            info!("Daten in tsink vorhanden von {} bis {} ({} Datenpunkte)", 
                earliest_dt.format("%Y-%m-%d %H:%M:%S UTC"),
                latest_dt.format("%Y-%m-%d %H:%M:%S UTC"),
                count_data_points(&**storage).unwrap_or(0)
            );
        }
        Ok(None) => {
            info!("Keine Daten in tsink vorhanden");
        }
        Err(e) => {
            error!("Fehler beim Abfragen der Daten-Zeitspanne: {}", e);
        }
    }
    info!("Starting ping loop (each target runs independently in parallel)...");
    for target in &app_config.targets {
        info!("  - {}: {} pings back-to-back, then wait {}s", 
            target.name.as_ref().unwrap_or(&target.address),
            target.ping_count,
            target.ping_interval
        );
    }

    // Create HTTP API router
    let app = create_router(Arc::clone(&storage));
    let addr: SocketAddr = format!("{}:{}", app_config.server.host, app_config.server.port)
        .parse()
        .expect("Invalid server address");
    
    info!("Starting HTTP API server on http://{}", addr);
    
    // Spawn HTTP server task
    let server_task = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(addr).await
            .expect("Failed to bind HTTP server");
        axum::serve(listener, app).await
            .expect("HTTP server error");
    });
    
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
    
    // Setup signal handler for graceful shutdown
    let storage_for_shutdown = storage.clone();
    let shutdown_task = tokio::spawn(async move {
        let ctrl_c = async {
            signal::ctrl_c()
                .await
                .expect("failed to install Ctrl+C handler");
        };

        #[cfg(unix)]
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("failed to install signal handler")
                .recv()
                .await;
        };

        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }

        info!("Shutdown signal received, closing storage...");
        if let Err(e) = storage_for_shutdown.close() {
            error!("Error closing storage: {}", e);
        } else {
            info!("Storage closed successfully");
        }
    });

    // Run HTTP server, ping tasks, and shutdown handler concurrently
    tokio::select! {
        result = server_task => {
            error!("HTTP server task ended: {:?}", result);
        }
        _ = join_all(target_tasks) => {
            // Ping tasks run forever, so this should never complete
            info!("All ping tasks completed (unexpected)");
        }
        _ = shutdown_task => {
            info!("Shutdown handler completed");
        }
    }
    
    // Ensure storage is closed before exit
    info!("Closing storage before exit...");
    if let Err(e) = storage.close() {
        error!("Error closing storage: {}", e);
    } else {
        info!("Storage closed successfully");
    }
    
    Ok(())
}
