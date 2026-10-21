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
- **retention_days**: Days of ping history to keep. Leave it unset to keep
  all data. Older data is deleted in the background once set.

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
- Logs: `/data/sparkping.log`, rotated at 10 MB with up to 5 old files
  (`sparkping.log.1` and so on)

Data persists across add-on updates and restarts.

### Upgrading from 0.2.3 or earlier

Newer versions store data in a new format. On the first start, SparkPing moves
the old data to `/data/tsink-data/legacy-v05/` and copies it into the new
format in the background. Pings are recorded right away; older history
appears in the charts as the migration progresses. A banner shows the
progress. With years of data this can take hours on a Raspberry Pi.

When the migration is done, restart the add-on to free the memory it used.
Data that could not be migrated stays in `legacy-v05/` and is retried on the
next start. Once migrated, the data cannot be read by older versions of the
add-on.

### Memory usage

SparkPing reads its data files through memory mapping. Tools that show the
resident memory (RSS), such as Netdata or the Supervisor, therefore report a
value close to the size of `/data/tsink-data/`. Most of it is file cache that
the kernel can free when memory gets tight. The actual heap grows by about
100 MB per year of stored history; set `retention_days` to limit it.

## Health

If something goes wrong, for example the database stopped after an error or
ping results are no longer stored, SparkPing shows a banner at the top of the
web interface and logs the problem. The same information is available at
`/api/health`.

If the database stops after a background error, SparkPing exits so it can be
restarted; the restart reopens the database and recovers recent data from its
write-ahead log. Turn on **Watchdog** on the add-on's Info page so the
Supervisor restarts it automatically.

## Support

For issues and feature requests, visit:
https://github.com/hco/SparkPing/issues

