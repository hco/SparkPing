# Stage 1: Build frontend
FROM node:24-slim AS frontend-builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app/frontend

# Copy package files
COPY frontend/package.json frontend/pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN pnpm build

# Stage 2: Build Rust backend
FROM rust:1.91-slim AS rust-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy Cargo files first for better layer caching
COPY Cargo.toml Cargo.lock ./

# Create a dummy main.rs to build dependencies (for caching)
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src target/release/SparkPing target/release/deps/SparkPing*

# Copy source code
COPY src ./src

# Build release binary (will rebuild with actual source)
RUN touch src/main.rs && cargo build --release

# Stage 3: Final image
FROM debian:bookworm-slim

WORKDIR /app

# Install ca-certificates for HTTPS and basic runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy built binary
COPY --from=rust-builder /app/target/release/SparkPing /app/sparkping

# Copy frontend dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy config file (can be overridden via volume)
# Use config_empty.toml as template, but modify host to 0.0.0.0 for Docker
COPY config_empty.toml /app/config.toml
RUN sed -i 's/^host = "127.0.0.1"/host = "0.0.0.0"/' /app/config.toml

# Expose port
EXPOSE 8080

# Set environment variable for static files directory
ENV STATIC_DIR=/app/frontend/dist

# Create directory for database
RUN mkdir -p /app/tsink-data

# Make binary executable (should be already, but ensure it)
RUN chmod +x /app/sparkping

# Create a startup script that provides better error visibility
RUN echo '#!/bin/sh\n\
set -e\n\
echo "=== SparkPing Container Starting ==="\n\
echo "Working directory: $(pwd)"\n\
cd /app\n\
CONFIG_PATH="config"\n\
echo "Config file path (for config crate): $CONFIG_PATH"\n\
CONFIG_FILE="${CONFIG_PATH}.toml"\n\
if [ ! -f "$CONFIG_FILE" ]; then\n\
    echo "ERROR: Config file not found: $CONFIG_FILE"\n\
    echo "Looking for: $CONFIG_FILE"\n\
    ls -la /app/ || true\n\
    exit 1\n\
fi\n\
echo "Config file exists: $CONFIG_FILE"\n\
echo "Config file contents:"\n\
cat "$CONFIG_FILE"\n\
echo ""\n\
echo "=== Starting SparkPing ==="\n\
echo "Binary: /app/sparkping"\n\
echo "Arguments: --config $CONFIG_PATH"\n\
if [ ! -x /app/sparkping ]; then\n\
    echo "ERROR: Binary is not executable"\n\
    ls -la /app/sparkping\n\
    exit 1\n\
fi\n\
# Run with error handling - capture stderr and stdout\n\
exec /app/sparkping --config "$CONFIG_PATH" 2>&1\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Run the application with relative config path
# The config crate File::with_name() works better with relative paths
ENTRYPOINT ["/app/entrypoint.sh"]

