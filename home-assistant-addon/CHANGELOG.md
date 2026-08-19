# Changelog


## [0.2.2] - 2026-08-19

### 🐛 Bug Fixes
- Skip jemalloc on musl targets to unbreak Home Assistant add-on build


## [0.2.1] - 2026-08-19

### 🐛 Bug Fixes
- Parse ICMP replies correctly on macOS/BSD
- Bound tsink's unbounded memory growth under long-running deployments

### 📝 Other
- Merge pull request #2 from hco/fix/macos-icmp-dgram-header

fix: parse ICMP replies correctly on macOS/BSD
- Bump docker/login-action to v4 to run on supported Node 24 runtime


## [0.2.0] - 2026-07-14

### ✨ Features
- Make low packet loss visible with log-spaced severity colors

### 🐛 Bug Fixes
- Copy pnpm-workspace.yaml into Docker build so esbuild build is approved


## [0.1.73] - 2026-04-14

### ⚡ Performance
- Use tsink label-filtered queries for single-target data fetching


## [0.1.72] - 2026-04-02

### ✨ Features
- Log peak memory usage every minute



