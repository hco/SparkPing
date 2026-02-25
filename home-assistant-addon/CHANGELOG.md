# Changelog


## [0.1.59] - 2026-02-25

### 🐛 Bug Fixes
- Prevent OOM on startup from unbounded WAL growth


## [0.1.58] - 2026-02-10

### 🐛 Bug Fixes
- Remove startup full-database scan that OOM-kills on low-memory devices
- Chunked aggregation to prevent OOM on large time range queries


## [0.1.57] - 2026-01-06

### ✨ Features
- Add real histogram data (percentiles) to smoke charts


## [0.1.56] - 2026-01-05

### 📝 Other
- Add search to homepage/settings


## [0.1.55] - 2026-01-04

### ✨ Features
- Add brush-to-zoom functionality to smoke chart

### 📝 Other
- Limit HA addon changelog to last 5 releases

Add cliff-ha.toml config that uses Tera's slice filter in the header
template to render only the 5 most recent releases. Update release-it
to use this config for the home-assistant-addon changelog.



