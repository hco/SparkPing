# SparkPing Add-on Documentation

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the SparkPing add-on
3. Start the add-on
4. Access via the sidebar or add-on page

## Configuration

### Options

- **port**: Web interface port (default: 8080)
- **log_level**: Logging level (trace, debug, info, warn, error)

### Adding Ping Targets

Targets can be added through the web interface or by editing 
`/data/config.toml` manually.

#### Via Web UI

1. Open SparkPing from the sidebar
2. Navigate to Settings
3. Add your targets with IP addresses or hostnames

#### Via Configuration File

Access the configuration file at `/addon_configs/local_sparkping/config.toml`
and add targets in TOML format.

## Data Persistence

All data is stored in `/data/`:
- Configuration: `/data/config.toml`
- Database: `/data/tsink-data/`
- Logs: `/data/sparkping.log`

Data persists across add-on updates and restarts.

## Support

For issues and feature requests, visit:
https://github.com/hco/SparkPing/issues

