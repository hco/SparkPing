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

# Launch SparkPing
exec /app/sparkping --config "$CONFIG_PATH"

