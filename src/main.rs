use clap::Parser;
use config::Config;
use serde::Deserialize;
use std::path::PathBuf;
use tsink::StorageBuilder;

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
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    // Load configuration from the specified file
    let settings = Config::builder()
        .add_source(config::File::with_name(
            args.config.to_str().expect("Invalid config file path"),
        ))
        .build()?;

    let app_config: AppConfig = settings.try_deserialize()?;
    
    println!("Configuration loaded successfully from: {:?}", args.config);
    println!("Server: {}:{}", app_config.server.host, app_config.server.port);
    println!("Logging: level={}, file={}", app_config.logging.level, app_config.logging.file);
    println!("Database path: {}", app_config.database.path);
    println!("Targets to ping:");
    for target in &app_config.targets {
        match &target.name {
            Some(name) => println!("  - {} ({})", target.address, name),
            None => println!("  - {}", target.address),
        }
    }

    // Initialize tsink storage with configured path
    let storage = StorageBuilder::new()
        .with_data_path(&app_config.database.path)
        .build()?;

    println!("tsink database initialized at: {}", app_config.database.path);

    // Cleanup on exit
    storage.close()?;
    
    Ok(())
}
