# ARG must be declared before any FROM in multi-stage builds
# Home Assistant builder will override this with the appropriate base image
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest

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

# Get the target architecture from BUILD_FROM (passed from final stage)
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest

WORKDIR /app

# Install build dependencies including musl for static linking
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev musl-tools && \
    rustup target add x86_64-unknown-linux-musl aarch64-unknown-linux-musl armv7-unknown-linux-musleabihf && \
    rm -rf /var/lib/apt/lists/*

# Determine target architecture from BUILD_FROM image name
RUN ARCH=$(echo "$BUILD_FROM" | sed -n 's/.*\/\([^/]*\)-base:.*/\1/p') && \
    case "$ARCH" in \
        "amd64") TARGET="x86_64-unknown-linux-musl" ;; \
        "aarch64") TARGET="aarch64-unknown-linux-musl" ;; \
        "armv7") TARGET="armv7-unknown-linux-musleabihf" ;; \
        *) TARGET="x86_64-unknown-linux-musl" ;; \
    esac && \
    echo "Building for architecture: $ARCH -> $TARGET" && \
    echo "$TARGET" > /tmp/rust_target

# Copy Cargo files first for better layer caching
COPY Cargo.toml Cargo.lock ./

# Build dependencies for the target architecture
RUN TARGET=$(cat /tmp/rust_target) && \
    mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release --target "$TARGET" && \
    rm -rf src

# Copy source code
COPY src ./src

# Build for the target architecture
RUN TARGET=$(cat /tmp/rust_target) && \
    cargo build --release --target "$TARGET" && \
    cp "/app/target/$TARGET/release/SparkPing" /app/sparkping && \
    chmod +x /app/sparkping

# Stage 3: Final image - use Home Assistant base
FROM ${BUILD_FROM}

# Install runtime dependencies (minimal since we're using static binary)
RUN apk add --no-cache ca-certificates bash

WORKDIR /app

# Copy the binary from rust-builder (already copied to known location)
COPY --from=rust-builder --chmod=755 /app/sparkping /app/sparkping

COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy default config template and startup script
COPY config.toml /app/config.toml.template
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV STATIC_DIR=/app/frontend/dist

CMD [ "/run.sh" ]
