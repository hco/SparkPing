# Changelog


## [0.3.1] - 2026-10-21

### 🐛 Bug Fixes
- Keep compaction from deleting a segment the flush has not published yet
- Restart after the storage stops instead of running without it
- Let the migration finish on partitions tsink 0.5 left behind


## [0.3.0] - 2026-10-20

### ✨ Features
- Report instance health in the API and UI

### 🐛 Bug Fixes
- Pass release notes through the environment instead of interpolating them
- Raise the open-files soft limit at startup
- Rotate the log file by size
- Log reachability and write-error changes instead of every failure
- Move storage to tsink 0.10
- Query all ping sequences in the per-target fast path
- Use a tsink 0.10.2 fork with the WAL reset race fixed
- Migrate tsink 0.5 data in the background
- Drop partitions left behind by failed tsink 0.5 flushes
- Keep renamed legacy WAL segments next to their originals
- Stop ping tasks before closing the storage on shutdown
- Order legacy WAL segments by modification time
- Use tsink fork that plans compaction without loading the whole level
- Use tsink fork that starts compaction after startup
- Stop segments from piling up under steady writes
- Pause the migration while compaction or the WAL fall behind

### 📚 Documentation
- Record the tsink 0.10 migration and document its effects
- Record the tsink fork fixes and migration measurements

### 🧪 Testing
- Check storage works with more files than the open-files limit


## [0.2.3] - 2026-09-15

### 📝 Other
- Build the add-on image on PRs and main to catch musl breaks before tagging
- Revert "Release 1.0.1"

This reverts commit 9c2d8f9fcb953c1745e0f216157cbae49f968822.


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



