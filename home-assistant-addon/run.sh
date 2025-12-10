#!/usr/bin/with-contenv bashio

CONFIG_PATH="/data/config.toml"

# Create default config if it doesn't exist
if [ ! -f "$CONFIG_PATH" ]; then
    bashio::log.info "Creating default configuration..."
    cp /app/config.toml.template "$CONFIG_PATH"
fi

# Read user options
PORT=$(bashio::config 'port')
LOG_LEVEL=$(bashio::config 'log_level')

bashio::log.info "Starting SparkPing..."
bashio::log.info "Port: $PORT"
bashio::log.info "Log Level: $LOG_LEVEL"
bashio::log.info "Config: $CONFIG_PATH"
bashio::log.info "Database: /data/tsink-data"

# Update config.toml with user options
sed -i "s/^port = .*/port = $PORT/" "$CONFIG_PATH"
sed -i "s/^level = .*/level = \"$LOG_LEVEL\"/" "$CONFIG_PATH"

# Ensure host is 0.0.0.0 for Ingress
sed -i 's/^host = .*/host = "0.0.0.0"/' "$CONFIG_PATH"

# Ensure required directories exist
mkdir -p /data/tsink-data
mkdir -p "$(dirname "$(grep '^file = ' "$CONFIG_PATH" | cut -d'"' -f2)")" 2>/dev/null || true

# Verify binary exists and is executable
if [ ! -f "/app/sparkping" ]; then
    bashio::log.error "ERROR: Binary not found at /app/sparkping"
    ls -la /app/ || true
    exit 1
fi

if [ ! -x "/app/sparkping" ]; then
    bashio::log.error "ERROR: Binary is not executable: /app/sparkping"
    ls -la /app/sparkping || true
    exit 1
fi

# Verify config file exists and is readable
if [ ! -f "$CONFIG_PATH" ]; then
    bashio::log.error "ERROR: Config file not found: $CONFIG_PATH"
    exit 1
fi

bashio::log.info "Binary verified, launching SparkPing..."

# Launch SparkPing with stderr redirected to stdout so errors are visible
# Use exec to replace shell process, but ensure errors are captured
exec /app/sparkping --config "$CONFIG_PATH" 2>&1

