use crate::config::LoggingConfig;
use file_rotate::{compression::Compression, suffix::AppendCount, ContentLimit, FileRotate};
use std::fs::OpenOptions;
use std::sync::Mutex;
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

    // FileRotate swallows open errors and silently drops log lines, so check
    // up front that the file is writable.
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_config.file)?;

    // Size-based rotation keeps the log bounded; an unrotated log once grew
    // to 15 GB on a Home Assistant install.
    let max_bytes = usize::try_from(log_config.max_size_mb.max(1) * 1024 * 1024)?;
    let file = FileRotate::new(
        &log_config.file,
        AppendCount::new(log_config.max_files),
        ContentLimit::BytesSurpassed(max_bytes),
        Compression::None,
        None,
    );

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
        .with(fmt::layer().with_writer(Mutex::new(file)).with_ansi(false))
        .init();

    Ok(())
}
