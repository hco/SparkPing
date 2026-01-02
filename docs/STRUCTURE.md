# SparkPing Project Structure

This document describes the module structure and organization of the SparkPing codebase.

## Overview

SparkPing is a network ping monitoring application with:
- **Rust backend**: Ping execution, data storage, REST API
- **React frontend**: Dashboard, charts, target management
- **Home Assistant integration**: Add-on support for Home Assistant

## Backend (Rust)

The backend follows Rust best practices with a clear separation of concerns.

### Entry Point

#### `src/main.rs`
- Application entry point and orchestration
- CLI argument parsing (using `clap`)
- Configuration loading and hot-reloading via file watcher
- tsink storage initialization
- HTTP server startup (Axum)
- Graceful shutdown handling
- Ping task lifecycle management

### Core Modules

#### `src/config.rs`
- Configuration structures (`AppConfig`, `ServerConfig`, `LoggingConfig`, `DatabaseConfig`, `PingConfig`, `Target`)
- `SocketType` enum for ICMP socket configuration (dgram vs raw)
- Serde deserialization from TOML

#### `src/config_file.rs`
- TOML document manipulation using `toml_edit`
- Atomic config file writing (with Docker bind mount fallback)
- Target CRUD operations on config file (add, update, remove)
- File permission preservation

#### `src/logging.rs`
- Logging initialization and setup
- Custom time formatters
- Tracing subscriber configuration (console + file output)

#### `src/ping.rs`
- `PingResult` struct definition
- `perform_ping()` function - executes ICMP ping operations
- Support for both dgram (unprivileged) and raw (privileged) sockets

#### `src/storage.rs`
- `write_ping_result()` function - writes ping results to tsink
- Data point creation with labels and metrics
- Stores `ping_latency` and `ping_failed` metrics

#### `src/tasks.rs`
- `start_ping_task()` - spawns async ping tasks for targets
- Returns `AbortHandle` for task lifecycle management
- Configurable ping count and interval per target

#### `src/discovery.rs`
- Network device discovery via mDNS (multicast DNS)
- Uses `mdns-sd` crate for cross-platform support
- Streaming discovery with real-time events
- `DiscoveredDevice` and `DiscoveredService` structs
- Automatic service type detection via DNS-SD meta-query

### API Module (`src/api/`)

REST API built with Axum.

#### `src/api/mod.rs`
- Module exports and re-exports

#### `src/api/router.rs`
- API route definitions
- Static file serving for frontend SPA
- Conditional middleware application

#### `src/api/state.rs`
- `AppState` struct - shared state for API handlers
- Contains storage, config, task handles, config path

#### `src/api/middleware.rs`
- Home Assistant ingress IP filtering
- Restricts access to HA supervisor IPs when enabled

#### `src/api/ping/`
- `handlers.rs` - GET `/api/ping/data`, `/api/ping/aggregated`, `/api/storage/stats`
- `dto.rs` - Data transfer objects for ping responses
- `query.rs` - Query parameter structures

#### `src/api/targets/`
- `handlers.rs` - CRUD handlers for targets
- `dto.rs` - Request/response DTOs for targets

#### `src/api/discovery/`
- SSE endpoint for streaming device discovery results

## Frontend (React + TypeScript)

Single-page application built with Vite, React, and TanStack Router.

### Entry Point

#### `src/main.tsx`
- React app initialization
- Router setup
- Query client provider

### Routes (`src/routes/`)

#### `__root.tsx`
- Root layout with navigation
- Theme provider setup

#### `index.tsx`
- Dashboard page with target overview
- Sparkline charts for each target

#### `settings.tsx`
- Application settings page

#### `targets/$targetId.tsx`
- Individual target detail page
- Full ping history charts

### Components (`src/components/`)

#### UI Components (`ui/`)
- shadcn/ui components: button, card, input, select, popover, etc.

#### Chart Components (`charts/`)
- `D3CombinedChart.tsx` - Combined latency and packet loss chart
- `D3LatencyChart.tsx` - Latency-only chart
- `D3PacketLossChart.tsx` - Packet loss chart
- `D3RRDStyleChart.tsx` - RRD-style area chart
- `smoke-chart/` - Smoke test visualization components

#### Feature Components
- `DeviceDiscoveryPanel.tsx` - mDNS device discovery UI
- `TimeRangePicker.tsx` - Time range selection with presets
- `DurationPicker.tsx` - Duration input component
- `TargetStatsBar.tsx` - Target statistics display
- `Sparkline.tsx` - Compact inline charts
- `EmptyState.tsx`, `ErrorDisplay.tsx`, `LoadingState.tsx` - State displays
- `PageLayout.tsx` - Consistent page layout wrapper

### Hooks (`src/hooks/`)

- `useDashboardData.ts` - Dashboard data fetching
- `useTargetPingData.ts` - Individual target ping data
- `useTargetStats.ts` - Target statistics aggregation
- `useDeviceDiscovery.ts` - mDNS discovery SSE connection
- `useTimeRangeSearch.ts` - URL-based time range state
- `useUserPreferences.ts` - Local storage preferences
- `useTheme.ts` - Theme switching
- `useMediaQuery.ts` - Responsive breakpoints

### Library (`src/lib/`)

- `api.ts` (in `src/`) - API client functions
- `queryClient.ts` - TanStack Query configuration
- `basePath.ts` - Base path detection for HA ingress
- `chartColors.ts` - Chart color palette
- `deviceParser.ts` - Device name/icon parsing
- `brandIcons.tsx` - Brand icon components
- `utils.ts` - General utilities

### Context (`src/context/`)

- `ThemeContext.tsx` - Theme state provider
- `theme.ts` - Theme utilities

### Types

- `src/types.ts` - Shared TypeScript types

## Home Assistant Add-on (`home-assistant-addon/`)

Integration for running SparkPing as a Home Assistant add-on.

- `config.yaml` - Add-on configuration schema
- `Dockerfile` - Container build instructions
- `run.sh` - Startup script with config generation
- `DOCS.md` - User documentation
- `icon.png`, `logo.png` - Add-on branding

## Design Principles

1. **Separation of Concerns**: Each module has a single, well-defined responsibility
2. **Feature-Based Organization**: Code is organized by feature/domain, not technical layers
3. **Testability**: Functions are organized to be easily testable in isolation
4. **Hot Reloading**: Config changes are applied without restart
5. **Rust Conventions**: Uses `mod.rs` pattern for submodules
6. **React Best Practices**: TanStack Query for data fetching, custom hooks for logic

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ping/data` | GET | Raw ping data for time range |
| `/api/ping/aggregated` | GET | Aggregated ping statistics |
| `/api/targets` | GET | List all targets |
| `/api/targets` | POST | Create new target |
| `/api/targets/:id` | PUT | Update target |
| `/api/targets/:id` | DELETE | Delete target |
| `/api/storage/stats` | GET | Storage statistics |
| `/api/discovery/start` | GET (SSE) | Stream device discovery events |

## Import Notes

- The `config` crate is accessed using `::config::` syntax to avoid conflicts with the local `config` module
- All modules are declared in `main.rs` and use `crate::` paths for internal imports
