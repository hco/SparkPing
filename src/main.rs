mod api;
mod config;
mod config_file;
mod config_wizard;
mod discovery;
mod logging;
mod ping;
mod storage;
mod tasks;

use crate::api::create_router;
use crate::config::AppConfig;
use crate::logging::init_logging;
use crate::tasks::start_ping_task;
use chrono::{DateTime, Utc};
use clap::Parser;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::RwLock;
use std::time::Duration;
use tokio::signal;
use tracing::{debug, error, info, warn};
use tsink::{StorageBuilder, TimestampPrecision};
use uuid::Uuid;

/// SparkPing - A Rust application with configurable settings
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// Path to the configuration file (TOML format)
    #[arg(short, long, default_value = "config.toml")]
    config: PathBuf,

    /// Initialize a new configuration file interactively
    #[arg(long)]
    init: bool,
}

/// Get the time range of all data in tsink storage
fn get_data_time_range(
    storage: &dyn tsink::Storage,
) -> Result<Option<(i64, i64)>, Box<dyn std::error::Error>> {
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

/// Reload config from file
fn reload_config(path: &PathBuf) -> Result<AppConfig, String> {
    let settings = ::config::Config::builder()
        .add_source(::config::File::with_name(
            path.to_str().expect("Invalid config file path"),
        ))
        .build()
        .map_err(|e| format!("Failed to build config: {}", e))?;

    let app_config: AppConfig = settings
        .try_deserialize()
        .map_err(|e| format!("Failed to deserialize config: {}", e))?;
    Ok(app_config)
}


/// Reload targets by comparing old and new configs
async fn reload_targets(
    old_config: &AppConfig,
    new_config: &AppConfig,
    storage: Arc<dyn tsink::Storage>,
    task_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
) {
    info!("Reloading targets due to config change");

    let mut handles = task_handles.write().unwrap_or_else(|e| {
        error!("Failed to acquire write lock on task handles: {}", e);
        panic!("Failed to acquire write lock");
    });

    // Build maps for comparison
    let old_targets: HashMap<String, &crate::config::Target> = old_config
        .targets
        .iter()
        .map(|t| (t.id.clone(), t))
        .collect();

    let new_targets: HashMap<String, &crate::config::Target> = new_config
        .targets
        .iter()
        .map(|t| (t.id.clone(), t))
        .collect();

    // Check if socket_type changed - if so, restart all tasks
    let socket_type_changed = old_config.ping.socket_type != new_config.ping.socket_type;
    if socket_type_changed {
        info!("Socket type changed from {:?} to {:?}, restarting all ping tasks", 
              old_config.ping.socket_type, new_config.ping.socket_type);
    }

    // Find removed targets
    for (id, _) in old_targets.iter() {
        if !new_targets.contains_key(id) {
            info!("Stopping ping task for removed target: {}", id);
            if let Some(handle) = handles.remove(id) {
                handle.abort();
            }
        }
    }

    // Find modified or new targets
    for (id, new_target) in new_targets.iter() {
        let needs_restart = if let Some(old_target) = old_targets.get(id) {
            // Check if any field changed or socket_type changed
            socket_type_changed
                || old_target.address != new_target.address
                || old_target.name != new_target.name
                || old_target.ping_count != new_target.ping_count
                || old_target.ping_interval != new_target.ping_interval
        } else {
            // New target
            true
        };

        if needs_restart {
            if let Some(old_handle) = handles.remove(id) {
                info!("Restarting ping task for modified target: {}", id);
                old_handle.abort();
            } else {
                info!("Starting ping task for new target: {}", id);
            }

            let handle = start_ping_task(new_target, Arc::clone(&storage), new_config.ping.socket_type);
            handles.insert(id.clone(), handle);
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Install panic handler to ensure panics are visible
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("PANIC: {}", panic_info);
        if let Some(location) = panic_info.location() {
            eprintln!("Location: {}:{}:{}", location.file(), location.line(), location.column());
        }
        if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            eprintln!("Message: {}", s);
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            eprintln!("Message: {}", s);
        }
    }));

    let args = Args::parse();
    let config_path = args.config.clone();

    // Determine the actual config file path (with .toml extension if not specified)
    let config_file_path = if config_path.extension().is_some() {
        config_path.clone()
    } else {
        config_path.with_extension("toml")
    };

    // Handle --init flag: run the configuration wizard
    if args.init {
        if config_file_path.exists() {
            eprintln!(
                "Config file '{}' already exists. Remove it first or use a different path.",
                config_file_path.display()
            );
            std::process::exit(1);
        }

        let config_content = config_wizard::run_config_wizard(&config_file_path)
            .map_err(|e| {
                eprintln!("ERROR: Configuration wizard failed: {}", e);
                e
            })?;

        config_wizard::write_config_file(&config_file_path, &config_content)
            .map_err(|e| {
                eprintln!("ERROR: Failed to write config file: {}", e);
                e
            })?;

        eprintln!(
            "Configuration saved to '{}'. Run SparkPing without --init to start.",
            config_file_path.display()
        );
        std::process::exit(0);
    }

    // Check if config file exists
    if !config_file_path.exists() {
        // If running in an interactive terminal, offer to create config
        if config_wizard::is_interactive() {
            let should_create = config_wizard::prompt_create_config(&config_file_path)
                .map_err(|e| {
                    eprintln!("ERROR: Failed to prompt user: {}", e);
                    e
                })?;

            if should_create {
                let config_content = config_wizard::run_config_wizard(&config_file_path)
                    .map_err(|e| {
                        eprintln!("ERROR: Configuration wizard failed: {}", e);
                        e
                    })?;

                config_wizard::write_config_file(&config_file_path, &config_content)
                    .map_err(|e| {
                        eprintln!("ERROR: Failed to write config file: {}", e);
                        e
                    })?;

                eprintln!();
                eprintln!(
                    "Configuration saved! Starting SparkPing..."
                );
                eprintln!();
            } else {
                eprintln!();
                eprintln!(
                    "No configuration file. Run with --init to create one, or provide a config file with -c."
                );
                std::process::exit(1);
            }
        } else {
            // Non-interactive mode: just error out
            eprintln!(
                "ERROR: Config file '{}' not found.",
                config_file_path.display()
            );
            eprintln!();
            eprintln!("To create a configuration file interactively, run:");
            eprintln!("  {} --init", std::env::args().next().unwrap_or_else(|| "sparkping".to_string()));
            eprintln!();
            std::process::exit(1);
        }
    }

    // Load configuration from the specified file
    // Output errors to stderr before logging is initialized
    // Use File::new() for absolute paths, or File::with_name() for relative paths
    let config_file_source = if config_path.is_absolute() {
        ::config::File::from(config_path.clone())
    } else {
        ::config::File::with_name(
            config_path.to_str().expect("Invalid config file path"),
        )
    };
    
    let settings = ::config::Config::builder()
        .add_source(config_file_source)
        .build()
        .map_err(|e| {
            eprintln!("ERROR: Failed to load config file '{}': {}", config_path.display(), e);
            e
        })?;

    let mut app_config: AppConfig = settings.try_deserialize()
        .map_err(|e| {
            eprintln!("ERROR: Failed to deserialize config: {}", e);
            e
        })?;

    // Ensure all targets have IDs (migrate if needed)
    let mut needs_save = false;
    for target in &mut app_config.targets {
        if target.id.is_empty() {
            target.id = Uuid::new_v4().to_string();
            needs_save = true;
        }
    }

    // Save migrated config if needed
    if needs_save {
        info!("Migrating config: adding IDs to targets without IDs");
        let mut doc = config_file::read_config_file(&config_path)?;
        if let Some(targets_array) = doc
            .get_mut("targets")
            .and_then(|item| item.as_array_of_tables_mut())
        {
            let mut idx = 0;
            for target_table in targets_array.iter_mut() {
                if !target_table.contains_key("id") {
                    if idx < app_config.targets.len() {
                        let id = app_config.targets[idx].id.clone();
                        target_table["id"] = toml_edit::Item::Value(toml_edit::Value::String(
                            toml_edit::Formatted::new(id),
                        ));
                    }
                }
                idx += 1;
            }
        }
        let write_flag = Arc::new(AtomicBool::new(false));
        config_file::write_config_file(&config_path, &doc, &write_flag)?;
    }

    // Initialize logging before any other output
    init_logging(&app_config.logging)
        .map_err(|e| {
            eprintln!("ERROR: Failed to initialize logging: {}", e);
            e
        })?;

    info!("Configuration loaded successfully from: {:?}", args.config);
    
    // Log version information
    info!("Version: {}", env!("CARGO_PKG_VERSION"));
    
    // Log hostname
    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.to_str().map(|s| s.to_string()))
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "unknown".to_string());
    info!("Hostname: {}", hostname);
    
    // Log local IP addresses
    match if_addrs::get_if_addrs() {
        Ok(interfaces) => {
            let mut ipv4_addrs = Vec::new();
            let mut ipv6_addrs = Vec::new();
            
            for iface in interfaces {
                if iface.is_loopback() {
                    continue;
                }
                match iface.ip() {
                    std::net::IpAddr::V4(ip) => ipv4_addrs.push((iface.name.clone(), ip.to_string())),
                    std::net::IpAddr::V6(ip) => ipv6_addrs.push((iface.name.clone(), ip.to_string())),
                }
            }
            
            if !ipv4_addrs.is_empty() {
                info!("Local IPv4 addresses:");
                for (name, addr) in &ipv4_addrs {
                    info!("  {}: {}", name, addr);
                }
            }
            if !ipv6_addrs.is_empty() {
                info!("Local IPv6 addresses:");
                for (name, addr) in &ipv6_addrs {
                    info!("  {}: {}", name, addr);
                }
            }
            if ipv4_addrs.is_empty() && ipv6_addrs.is_empty() {
                info!("No non-loopback network interfaces found");
            }
        }
        Err(e) => {
            warn!("Failed to enumerate network interfaces: {}", e);
        }
    }
    
    info!(
        "Server: {}:{}",
        app_config.server.host, app_config.server.port
    );
    if app_config.server.home_assistant_ingress_only {
        info!("Home Assistant ingress-only mode: enabled (restricting access to 172.30.32.2)");
    }
    debug!(
        "Logging: level={}, file={}",
        app_config.logging.level, app_config.logging.file
    );
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
    let storage = Arc::new(
        StorageBuilder::new()
            .with_data_path(&app_config.database.path)
            .with_wal_enabled(true)
            .with_retention(Duration::from_secs(365 * 24 * 3600 * 20)) // 20 years
            .with_timestamp_precision(TimestampPrecision::Milliseconds)
            .with_max_writers(16)
            .with_write_timeout(Duration::from_secs(60))
            .with_partition_duration(Duration::from_secs(6 * 3600)) // 6 hours
            .with_wal_buffer_size(16384) // 16KB
            .build()
            .map_err(|e| {
                eprintln!("ERROR: Failed to initialize storage at '{}': {}", app_config.database.path, e);
                e
            })?,
    );

    info!(
        "tsink database initialized at: {}",
        app_config.database.path
    );

    // Check if WAL directory exists and has files
    let wal_path = std::path::Path::new(&app_config.database.path).join("wal");
    if wal_path.exists() {
        let wal_files: Vec<_> = std::fs::read_dir(&wal_path)
            .unwrap_or_else(|_| std::fs::read_dir(".").unwrap())
            .filter_map(|e| e.ok())
            .collect();
        info!("WAL directory found with {} files", wal_files.len());
        for entry in wal_files.iter().take(5) {
            if let Ok(metadata) = entry.metadata() {
                info!(
                    "  WAL file: {} ({} bytes)",
                    entry.file_name().to_string_lossy(),
                    metadata.len()
                );
            }
        }
    } else {
        info!("WAL directory not found: {:?}", wal_path);
    }

    // Query and display data time range
    match get_data_time_range(&**storage) {
        Ok(Some((earliest, latest))) => {
            let earliest_dt = DateTime::from_timestamp(earliest, 0).unwrap_or_else(|| Utc::now());
            let latest_dt = DateTime::from_timestamp(latest, 0).unwrap_or_else(|| Utc::now());
            info!(
                "Data in tsink available from {} to {} ({} data points)",
                earliest_dt.format("%Y-%m-%d %H:%M:%S UTC"),
                latest_dt.format("%Y-%m-%d %H:%M:%S UTC"),
                count_data_points(&**storage).unwrap_or(0)
            );
        }
        Ok(None) => {
            info!("No data in tsink storage");
        }
        Err(e) => {
            error!("Error querying data time range: {}", e);
        }
    }
    info!("Starting ping loop (each target runs independently in parallel)...");
    for target in &app_config.targets {
        info!(
            "  - {} (id: {}): {} pings back-to-back, then wait {}s",
            target.name.as_ref().unwrap_or(&target.address),
            target.id,
            target.ping_count,
            target.ping_interval
        );
    }

    // Create shared state for config and task management
    let server_host = app_config.server.host.clone();
    let server_port = app_config.server.port;
    let config_state = Arc::new(RwLock::new(app_config));
    let task_handles = Arc::new(RwLock::new(
        HashMap::<String, tokio::task::AbortHandle>::new(),
    ));
    let write_flag = Arc::new(AtomicBool::new(false));

    // Start initial ping tasks
    {
        let config = config_state.read().unwrap();
        let mut handles = task_handles.write().unwrap();
        let socket_type = config.ping.socket_type;
        for target in config.targets.iter() {
            let handle = start_ping_task(target, Arc::clone(&storage), socket_type);
            handles.insert(target.id.clone(), handle);
        }
    }

    // Determine static files directory (from env var or default)
    let static_dir = std::env::var("STATIC_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            // Default to ./frontend/dist if it exists
            let default_path = PathBuf::from("./frontend/dist");
            if default_path.exists() {
                Some(default_path)
            } else {
                None
            }
        });

    if let Some(ref dir) = static_dir {
        info!("Serving static files from: {:?}", dir);
    } else {
        info!("Static file serving disabled (no static directory found)");
    }

    // Create HTTP API router with shared state
    let app = create_router(
        Arc::clone(&storage),
        Arc::clone(&config_state),
        Arc::clone(&task_handles),
        Arc::clone(&write_flag),
        config_path.clone(),
        static_dir,
    );
    let addr: SocketAddr = format!("{}:{}", server_host, server_port)
        .parse()
        .map_err(|e| {
            let msg = format!("Invalid server address '{}:{}': {}", server_host, server_port, e);
            eprintln!("ERROR: {}", msg);
            msg
        })?;

    info!("Starting HTTP API server on http://{}", addr);

    // Spawn HTTP server task
    let server_task = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .unwrap_or_else(|e| {
                let msg = format!("Failed to bind HTTP server to {}: {}", addr, e);
                eprintln!("ERROR: {}", msg);
                panic!("{}", msg);
            });
        // Use IntoMakeServiceWithConnectInfo to enable connection info tracking
        // This allows middleware to access the peer IP address via ConnectInfo
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap_or_else(|e| {
                let msg = format!("HTTP server error: {}", e);
                eprintln!("ERROR: {}", msg);
                panic!("{}", msg);
            });
    });

    // Set up file watcher for config reloading
    // The config_path might not have .toml extension (config crate adds it)
    // So we need to construct the actual file path for watching
    let config_file_path = if config_path.extension().is_none() {
        config_path.with_extension("toml")
    } else {
        config_path.clone()
    };
    let config_path_for_watcher = config_file_path.clone();
    let config_state_for_watcher = Arc::clone(&config_state);
    let storage_for_watcher = Arc::clone(&storage);
    let task_handles_for_watcher = Arc::clone(&task_handles);
    let write_flag_for_watcher = Arc::clone(&write_flag);

    let watcher_task = tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<notify::Result<notify::Event>>(100);

        let mut watcher: RecommendedWatcher = match Watcher::new(
            move |res| {
                if tx.blocking_send(res).is_err() {
                    // Channel closed, ignore
                }
            },
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                error!("Failed to create file watcher: {}", e);
                return Ok::<(), String>(());
            }
        };

        if let Err(e) = watcher.watch(&config_path_for_watcher, RecursiveMode::NonRecursive) {
            error!("Failed to watch config file: {}", e);
            return Ok::<(), String>(());
        }

        info!(
            "Watching config file for changes: {:?}",
            config_path_for_watcher
        );

        while let Some(event) = rx.recv().await {
            match event {
                Ok(event) => {
                    // Check if this is a modify event for our config file
                    if matches!(event.kind, EventKind::Modify(_)) {
                        // Check write flag - if true, ignore (it's our own write)
                        if write_flag_for_watcher.load(Ordering::SeqCst) {
                            debug!("Ignoring config file change (our own write)");
                            continue;
                        }

                        // Small delay to ensure file write is complete
                        tokio::time::sleep(Duration::from_millis(100)).await;

                        // Reload config
                        info!("Config file changed, reloading...");
                        match reload_config(&config_path_for_watcher) {
                            Ok(new_config) => {
                                let old_config = {
                                    let config = config_state_for_watcher
                                        .read()
                                        .map_err(|e| format!("Failed to read config: {}", e))?;
                                    config.clone()
                                };

                                // Update config state
                                {
                                    let mut config = config_state_for_watcher
                                        .write()
                                        .map_err(|e| format!("Failed to write config: {}", e))?;
                                    *config = new_config.clone();
                                }

                                // Reload targets
                                reload_targets(
                                    &old_config,
                                    &new_config,
                                    Arc::clone(&storage_for_watcher),
                                    Arc::clone(&task_handles_for_watcher),
                                )
                                .await;
                            }
                            Err(e) => {
                                error!("Failed to reload config: {}", e);
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("File watcher error: {}", e);
                }
            }
        }

        Ok::<(), String>(())
    });

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

    // Run HTTP server, file watcher, and shutdown handler concurrently
    tokio::select! {
        result = server_task => {
            error!("HTTP server task ended: {:?}", result);
        }
        result = watcher_task => {
            match result {
                Ok(Ok(())) => info!("File watcher completed"),
                Ok(Err(e)) => error!("File watcher error: {}", e),
                Err(e) => error!("File watcher task panicked: {:?}", e),
            }
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
