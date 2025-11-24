use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub logging: LoggingConfig,
    pub database: DatabaseConfig,
    pub targets: Vec<Target>,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub file: String,
}

#[derive(Debug, Deserialize)]
pub struct DatabaseConfig {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct Target {
    pub address: String,
    pub name: Option<String>,
    /// Number of pings to perform per cycle (default: 3)
    #[serde(default = "default_ping_count")]
    pub ping_count: u16,
    /// Delay between individual pings in seconds (default: 1)
    #[serde(default = "default_ping_interval")]
    pub ping_interval: u64,
}

fn default_ping_count() -> u16 {
    3
}

fn default_ping_interval() -> u64 {
    1
}

