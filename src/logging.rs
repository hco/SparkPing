use crate::config::LoggingConfig;
use std::fs::OpenOptions;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Custom time formatter for human-readable dates
struct HumanReadableTimer;

impl tracing_subscriber::fmt::time::FormatTime for HumanReadableTimer {
    fn format_time(&self, w: &mut tracing_subscriber::fmt::format::Writer<'_>) -> std::fmt::Result {
        let now = chrono::Local::now();
        write!(w, "{}", now.format("%Y-%m-%d %H:%M:%S%.3f"))
    }
}

pub fn init_logging(log_config: &LoggingConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Parse log level from config, defaulting to "info" if invalid
    let log_level = log_config.level.to_lowercase();
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(&log_level));

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
                .compact(), // More compact, readable format for console
        )
        .with(fmt::layer().with_writer(file).with_ansi(false))
        .init();

    Ok(())
}
