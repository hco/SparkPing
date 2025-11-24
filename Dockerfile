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
    rm -rf src

# Copy source code
COPY src ./src

# Build release binary (will rebuild with actual source)
RUN cargo build --release

# Stage 3: Final image
FROM gcr.io/distroless/cc-debian12

WORKDIR /app

# Copy built binary
COPY --from=rust-builder /app/target/release/SparkPing /app/sparkping

# Copy frontend dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy config file (can be overridden via volume)
COPY config.toml /app/config.toml

# Expose port
EXPOSE 8080

# Set environment variable for static files directory
ENV STATIC_DIR=/app/frontend/dist

# Run the application
ENTRYPOINT ["/app/sparkping", "--config", "/app/config.toml"]

