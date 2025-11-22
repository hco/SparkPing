use clap::Parser;
use config::Config;
use std::path::PathBuf;

/// SparkPing - A Rust application with configurable settings
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// Path to the configuration file (TOML format)
    #[arg(short, long, default_value = "config.toml")]
    config: PathBuf,
}

fn main() {
    let args = Args::parse();

    // Load configuration from the specified file
    let settings = Config::builder()
        .add_source(config::File::with_name(
            args.config.to_str().expect("Invalid config file path"),
        ))
        .build();

    match settings {
        Ok(config) => {
            println!("Configuration loaded successfully from: {:?}", args.config);
            
            // Example: Try to deserialize the entire config as a HashMap
            // You can replace this with your own configuration struct
            match config.try_deserialize::<std::collections::HashMap<String, config::Value>>() {
                Ok(map) => {
                    println!("Configuration values:");
                    for (key, value) in map.iter() {
                        println!("  {}: {:?}", key, value);
                    }
                }
                Err(e) => {
                    eprintln!("Error deserializing configuration: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("Error loading configuration from {:?}: {}", args.config, e);
            std::process::exit(1);
        }
    }
}
