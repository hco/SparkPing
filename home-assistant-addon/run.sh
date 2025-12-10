#!/usr/bin/with-contenv bashio

CONFIG_PATH="/data/config.toml"

# Create default config if it doesn't exist
if [ ! -f "$CONFIG_PATH" ]; then
    bashio::log.info "Creating default configuration..."
    cp /app/config.toml.template "$CONFIG_PATH"
fi

# Migration: Ensure [ping] section exists with raw socket type
# This is needed for existing installations that were created without this section
if ! grep -q '^\[ping\]' "$CONFIG_PATH"; then
    bashio::log.info "Adding [ping] section for raw socket support..."
    # Insert [ping] section before the targets comment or at the end
    if grep -q '# Add ping targets' "$CONFIG_PATH"; then
        sed -i '/# Add ping targets/i\[ping]\n# Use raw sockets (requires NET_RAW capability)\nsocket_type = "raw"\n' "$CONFIG_PATH"
    else
        echo -e '\n[ping]\n# Use raw sockets (requires NET_RAW capability)\nsocket_type = "raw"' >> "$CONFIG_PATH"
    fi
fi

# Read user options
LOG_LEVEL=$(bashio::config 'log_level')

# Port is fixed for ingress - must match ingress_port in config.yaml
PORT=8080

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
ls -al /data || true
ls -al /data/tsink-data || true
ls -al /data/sparkping.log || true

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

bashio::log.info "Binary version:"
/app/sparkping --version 2>&1
/app/sparkping --version

bashio::log.info "Launching SparkPing..."

# Launch SparkPing with stderr redirected to stdout so errors are visible
# Use exec to replace shell process, but ensure errors are captured
exec /app/sparkping --config "$CONFIG_PATH" 2>&1

