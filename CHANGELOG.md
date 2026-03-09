# Changelog

## [0.1.67] - 2026-03-09

### 🐛 Bug Fixes

- Default query `to` to current time instead of i64::MAX
## [0.1.66] - 2026-03-09

### 🐛 Bug Fixes

- Increase ping timeout from 2s to 5s
- Move blocking storage queries to spawn_blocking
## [0.1.65] - 2026-03-09

### 🐛 Bug Fixes

- Don't check ident on DGRAM ICMP replies
## [0.1.64] - 2026-03-09

### 🐛 Bug Fixes

- Add diagnostic logging to dgram_native ping implementation
## [0.1.63] - 2026-03-09

### ✨ Features

- Add dgram_native ping implementation, expose socket type in HA config
## [0.1.62] - 2026-03-09

### 🐛 Bug Fixes

- Switch HA addon from raw to dgram ICMP sockets
## [0.1.61] - 2026-03-09

### 🐛 Bug Fixes

- Resolve EAGAIN errors on concurrent ping socket creation
## [0.1.60] - 2026-03-09

### 🐛 Bug Fixes

- Streaming WAL recovery to handle single giant segment
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
## [0.1.54] - 2026-01-04

### 📝 Other

- Reduce settings target list size
- Add target sorting to start page
## [0.1.52] - 2026-01-04

### ✨ Features

- Add GitHub release with changelog to addon-builder pipeline

### 📝 Other

- Improve aqara device detection
- Device identification is now being handled by the backend
## [0.1.51] - 2026-01-04

### 📝 Other

- Improve xiaomi discovery
## [0.1.50] - 2026-01-03

### 🐛 Bug Fixes

- Make sure the latest version of the frontend is used

### 📝 Other

- Add copy button for discovery json
## [0.1.48] - 2026-01-03

### 📝 Other

- Try to re-enable am64 builds
## [0.1.47] - 2026-01-03

### ✨ Features

- Add more variants of the smoke bar
## [0.1.46] - 2026-01-03

### 📝 Other

- Remove legacy charts

e.g. we now detect sonos device names,  and improved support for hue or shelly
- Improve tooltip
- Add detailed explanation of smoke chart
## [0.1.45] - 2026-01-03

### ✨ Features

- Add vendor specific discoveries

### 📝 Other

- Remove flickering of target name while changing time range
- Optionally generate a config on first start
- Add support for ip scanning discovery
## [0.1.44] - 2025-12-30

### ✨ Features

- Keep time range selection when switching devices
- Automatically change the bucket size if it is inappropriate for the selected duration

### 🐛 Bug Fixes

- Fix changelog
## [0.1.43] - 2025-12-30

### 📝 Other

- Extract duration picker and improve mobile experience of it
- Support back button for time range changes
- Make back button usage optional
- Type safety++
- Generate changelog for releases
- Ignore all chores
## [0.1.42] - 2025-12-29

### 📝 Other

- Improve settings mobile view
## [0.1.41] - 2025-12-29

### ✨ Features

- Improve mobile view of smoke chart

### 📝 Other

- Add some tests
- Extract rust api into multiple files
- Remove dead code
- Add knip to detect dead code
- Configure knip for tailwind
- Remove unused code and dependencies
- Merge pull request #1 from hco/cleanup

add knip to detect dead code
- Extract components/hooks
- Knip
- Improve mobile view of timerange picker
- Allow hiding stats panel
- Use shadcn card
- Use card in more places
- Improve mobile padding
## [0.1.40] - 2025-12-23

### 📝 Other

- Debug performance issues in HA addon
## [0.1.39] - 2025-12-23

### 📝 Other

- Keep on trying with host mode & ingress
## [0.1.38] - 2025-12-23

### 📝 Other

- Another try at host modeHA addon
## [0.1.37] - 2025-12-23

### 📝 Other

- Use host network in Home Assistant
## [0.1.35] - 2025-12-22

### 📝 Other

- Add icons to discovered devices
## [0.1.34] - 2025-12-22

### 📝 Other

- Improve Discovery

it’s now live, contains more details and has a search
## [0.1.33] - 2025-12-19

### 🐛 Bug Fixes

- Fix release task

### 📝 Other

- Translated log messages
- Add better time picker
- Implemented device discovery
- Try bumping rust app version on release
## [0.1.32] - 2025-12-18

### 📝 Other

- Maybe add logos to the HA addon
## [0.1.31] - 2025-12-18

### 📝 Other

- Allow limiting to P99
- Add some stats for the targets in settings
## [0.1.30] - 2025-12-18

### 📝 Other

- „fix“ release tasks
## [0.1.29] - 2025-12-18

### 📝 Other

- Ts fixes
## [0.1.28] - 2025-12-18

### 🐛 Bug Fixes

- Fix shadcn

### 📝 Other

- Improve statistics and legend color
- Redesign dashboard, add dark mode
- Hide devtools in prod
- Add current latency to dashboard
- Add logo
- Darkmodify
- UX!
- Add icon & favicon
## [0.1.27] - 2025-12-18

### 🐛 Bug Fixes

- Fix version thingy

### 📝 Other

- Remove smokebar from legend
- We should not need this, the `needs:` should be sufficient
- Well… 😂
- Split smoke chat
## [0.1.26] - 2025-12-18

### 📝 Other

- Add min/max/avg lines
- Addon build: use tags instead of github releases
- Install release-it
## [0.1.25] - 2025-12-18

### 📝 Other

- Ts fix
## [0.1.23] - 2025-12-18

### 🐛 Bug Fixes

- Fix ingress addon basepath detection

### 📝 Other

- Add vitest
- Add another ingress detection testcase
- Fix title
## [0.1.20] - 2025-12-18

### 📝 Other

- Add path to data mapping
- Add changes to config so that i can see it works
- Remove mapping?
- Add support for running as ingress to the frontend
## [0.1.19] - 2025-12-17

### 📝 Other

- Porque
## [0.1.18] - 2025-12-17

### 📝 Other

- Why doesnt it push anymore?!
## [0.1.17] - 2025-12-17

### 📝 Other

- Hopefully fix build
## [0.1.16] - 2025-12-17

### 📝 Other

- Maybe fix docker image version for releases
- Do not build amd64 :(
## [0.1.15] - 2025-12-17

### 📝 Other

- Revert "chore: bump add-on version to 0.1.14"

This reverts commit 657bb7aaddf30cadc90d76debffafc5036129c64.
## [0.1.14] - 2025-12-17

### 📝 Other

- Automatically bump ha version
- Remove old release workflow
- Allow disabling more parts of the smokechart
- Ts fix
## [0.1.13] - 2025-12-17

### 📝 Other

- New release
- Disable broken workflows for now
- Create better smoke chart and hide other charts
## [0.1.12] - 2025-12-10

### 🐛 Bug Fixes

- Fix usage of history api

### 📝 Other

- More buckets
## [0.1.11] - 2025-12-10

### 📝 Other

- Update to 0.1.10
- More permissions!11
- Wip
- Maybe fix ingress
## [0.1.9] - 2025-12-10

### 📝 Other

- Increase version
- Use raw sockets in HA
- Release v0.1.9
## [0.1.7] - 2025-12-10

### 📝 Other

- Maybe fix build
- Maybe add a release workflow
## [0.1.6] - 2025-12-10

### 📝 Other

- Increase ha addon version
- More debugging
## [0.1.5] - 2025-12-10

### 📝 Other

- Update HA addon to 0.1.4
- Improve debugging of not-starting HA addon
## [0.1.4] - 2025-12-10

### 🐛 Bug Fixes

- Fix docker image name

### 📝 Other

- One more try at not-crosscompiling
- Config.yaml aktualisieren
- Update image reference in config.yaml
## [0.1.2] - 2025-12-05

### 📝 Other

- Another try at not-crosscompiling
## [0.1.1] - 2025-12-04

### 📝 Other

- Do not cross-compile
## [0.1.3] - 2025-12-04

### 🐛 Bug Fixes

- Fix build failures
- Fix  docker image

### 📝 Other

- Initial commit
- Setup mise
- Setup clap & config
- Setup dev task
- Add tsink
- Add config for targets
- Sudo 🙈
- Add pinging with logging
- Extracted hooks
- Add tanstack query
- Router
- Add settings
- Add support for relative time ranges
- Add way too many charts
- Add docker image build
- Handle configuration without targets
- Preserve permissions and owner from original config
- Cleanup default config
- Add missing dependency
- Bootstrap HA addon
- Add linting CI
- Fmt should consider all files

we dont have so many anyways
- Coding style
- Make mise less mies.
- Coding style
- We don’t do cd, we have mp3 now
- Maybe fix HA addon build
- Ha build fixes again
- Typescript fixes
- Typescript stuff
- Add missing dependency
- Always build HA addon
- Maybe fix HA addon build
- Restructure mise tasks
- Only do amd64 build (for now)

maybe the arm build slows everything down?
- Maybe fix linting ci
- Another try at HA addon
- Re-add arm build
- Well.
- Maybe maybe.
- Cross compiling is super slow
- 🤷‍♂️
- Maybe fix addon…
- Lalala
- Disable mise cache in CI

apparently this breaks rustup. of course
- Disable docker build for now
- No
- Add support for dgram pings
- Make dockerfile more production-ready
- Fix config file updates
- Maybe fix addon build?
- Add frontend to addon build

