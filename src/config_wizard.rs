use crate::config::SocketType;
use console::{style, Term};
use dialoguer::{Confirm, Input, Select};
use std::io::IsTerminal;
use std::net::IpAddr;
use std::path::Path;
use std::time::Duration;

/// Result of testing a ping socket type
#[derive(Debug, Clone)]
pub struct SocketTestResult {
    pub works: bool,
    pub error: Option<String>,
}

/// Test if a specific socket type works for ICMP ping
fn test_socket_type(socket_type: SocketType) -> SocketTestResult {
    // Use a well-known address that should always be reachable (localhost)
    let test_addr: IpAddr = "127.0.0.1".parse().unwrap();

    let ping_socket_type = match socket_type {
        SocketType::Dgram => ping::SocketType::DGRAM,
        SocketType::Raw => ping::SocketType::RAW,
    };

    let result = ping::new(test_addr)
        .timeout(Duration::from_secs(2))
        .ttl(64)
        .seq_cnt(1)
        .socket_type(ping_socket_type)
        .send();

    match result {
        Ok(_) => SocketTestResult {
            works: true,
            error: None,
        },
        Err(e) => SocketTestResult {
            works: false,
            error: Some(e.to_string()),
        },
    }
}

/// Test both socket types and return results
pub fn test_ping_capabilities() -> (SocketTestResult, SocketTestResult) {
    let dgram_result = test_socket_type(SocketType::Dgram);
    let raw_result = test_socket_type(SocketType::Raw);
    (dgram_result, raw_result)
}

/// Check if we're running in an interactive terminal
pub fn is_interactive() -> bool {
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

/// Run the interactive configuration wizard
/// Returns the generated config content as a string, or an error
pub fn run_config_wizard(config_path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let term = Term::stdout();

    term.write_line("")?;
    term.write_line(&format!(
        "{}",
        style("╭─────────────────────────────────────────╮").cyan()
    ))?;
    term.write_line(&format!(
        "{}",
        style("│     SparkPing Configuration Wizard     │").cyan()
    ))?;
    term.write_line(&format!(
        "{}",
        style("╰─────────────────────────────────────────╯").cyan()
    ))?;
    term.write_line("")?;

    // Step 1: Database path
    term.write_line(&format!("{}", style("Step 1/3: Database Path").bold()))?;
    term.write_line("Where should SparkPing store its time-series data?")?;
    term.write_line("")?;

    let db_path: String = Input::new()
        .with_prompt("Database path")
        .default("./data".to_string())
        .interact_text()?;

    term.write_line("")?;

    // Step 2: Host selection
    term.write_line(&format!("{}", style("Step 2/3: Listen Address").bold()))?;
    term.write_line("Which network interface should SparkPing listen on?")?;
    term.write_line("")?;

    let host = select_host(&term)?;

    term.write_line("")?;

    // Step 3: Ping socket type
    term.write_line(&format!("{}", style("Step 3/3: Ping Socket Type").bold()))?;
    term.write_line("Testing ping capabilities...")?;
    term.write_line("")?;

    let socket_type = select_socket_type(&term)?;

    term.write_line("")?;

    // Generate config
    let config_content = generate_config(&db_path, &host, socket_type);

    // Show summary
    term.write_line(&format!("{}", style("Configuration Summary").bold().green()))?;
    term.write_line(&format!("  Database path: {}", style(&db_path).cyan()))?;
    term.write_line(&format!("  Listen address: {}", style(&host).cyan()))?;
    term.write_line(&format!(
        "  Socket type: {}",
        style(format!("{:?}", socket_type).to_lowercase()).cyan()
    ))?;
    term.write_line(&format!(
        "  Config file: {}",
        style(config_path.display()).cyan()
    ))?;
    term.write_line("")?;

    Ok(config_content)
}

/// Interactive host selection with 0.0.0.0 warning
fn select_host(term: &Term) -> Result<String, Box<dyn std::error::Error>> {
    loop {
        let options = vec![
            "127.0.0.1 (localhost only - recommended for security)",
            "0.0.0.0 (all interfaces - accessible from network)",
        ];

        let selection = Select::new()
            .with_prompt("Select listen address")
            .items(&options)
            .default(0)
            .interact()?;

        if selection == 0 {
            return Ok("127.0.0.1".to_string());
        }

        // User selected 0.0.0.0 - show warning and ask for confirmation
        term.write_line("")?;
        term.write_line(&format!(
            "{}",
            style("⚠️  Security Warning").yellow().bold()
        ))?;
        term.write_line(&format!(
            "{}",
            style("Binding to 0.0.0.0 makes SparkPing accessible from your network.").yellow()
        ))?;
        term.write_line(&format!(
            "{}",
            style("This could expose the application to unauthorized access.").yellow()
        ))?;
        term.write_line("")?;

        let confirmed = Confirm::new()
            .with_prompt("Are you sure you want to listen on all interfaces?")
            .default(false)
            .interact()?;

        if confirmed {
            return Ok("0.0.0.0".to_string());
        }

        term.write_line("")?;
        term.write_line("Returning to host selection...")?;
        term.write_line("")?;
    }
}

/// Test and select socket type
fn select_socket_type(term: &Term) -> Result<SocketType, Box<dyn std::error::Error>> {
    let (dgram_result, raw_result) = test_ping_capabilities();

    // Display test results
    let dgram_status = if dgram_result.works {
        style("✓ Working").green()
    } else {
        style("✗ Not available").red()
    };

    let raw_status = if raw_result.works {
        style("✓ Working").green()
    } else {
        style("✗ Not available").red()
    };

    term.write_line(&format!(
        "  DGRAM (unprivileged): {}",
        dgram_status
    ))?;
    if !dgram_result.works {
        if let Some(ref err) = dgram_result.error {
            term.write_line(&format!("    Error: {}", style(err).dim()))?;
        }
    }

    term.write_line(&format!(
        "  RAW (requires root):  {}",
        raw_status
    ))?;
    if !raw_result.works {
        if let Some(ref err) = raw_result.error {
            term.write_line(&format!("    Error: {}", style(err).dim()))?;
        }
    }

    term.write_line("")?;

    // Determine available options and default
    match (dgram_result.works, raw_result.works) {
        (false, false) => {
            // Neither works - this is a critical issue
            term.write_line(&format!(
                "{}",
                style("╔══════════════════════════════════════════════════════════════╗")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║  CRITICAL: Neither ping socket type is working!              ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║                                                              ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║  SparkPing requires ICMP ping capabilities to function.     ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║                                                              ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║  Possible solutions:                                         ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║  • Run SparkPing as root (for RAW sockets)                   ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║  • Enable unprivileged ICMP (for DGRAM sockets):             ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("║    sudo sysctl -w net.ipv4.ping_group_range=\"0 2147483647\"   ║")
                    .red()
                    .bold()
            ))?;
            term.write_line(&format!(
                "{}",
                style("╚══════════════════════════════════════════════════════════════╝")
                    .red()
                    .bold()
            ))?;
            term.write_line("")?;

            // Still let them choose, defaulting to dgram
            let options = vec!["dgram (unprivileged)", "raw (requires root)"];
            let selection = Select::new()
                .with_prompt("Select socket type anyway (you'll need to fix permissions)")
                .items(&options)
                .default(0)
                .interact()?;

            Ok(if selection == 0 {
                SocketType::Dgram
            } else {
                SocketType::Raw
            })
        }
        (true, false) => {
            // Only DGRAM works - use it as default
            term.write_line(&format!(
                "{}",
                style("Using DGRAM socket (only available option)").green()
            ))?;
            Ok(SocketType::Dgram)
        }
        (false, true) => {
            // Only RAW works - use it as default
            term.write_line(&format!(
                "{}",
                style("Using RAW socket (only available option)").green()
            ))?;
            Ok(SocketType::Raw)
        }
        (true, true) => {
            // Both work - let user choose, default to dgram
            let options = vec![
                "dgram (unprivileged) - recommended",
                "raw (requires root)",
            ];
            let selection = Select::new()
                .with_prompt("Both socket types work. Select preferred type")
                .items(&options)
                .default(0)
                .interact()?;

            Ok(if selection == 0 {
                SocketType::Dgram
            } else {
                SocketType::Raw
            })
        }
    }
}

/// Generate the config file content
fn generate_config(db_path: &str, host: &str, socket_type: SocketType) -> String {
    let socket_type_str = match socket_type {
        SocketType::Dgram => "dgram",
        SocketType::Raw => "raw",
    };

    format!(
        r#"[server]
host = "{host}"
port = 8080

[logging]
level = "info"
file = "sparkping.log"

[database]
path = "{db_path}"

[ping]
socket_type = "{socket_type_str}"

# Add ping targets below. They can also added through the web UI.
# [[targets]]
# address = "8.8.8.8"
# name = "Google DNS"
# ping_count = 3        # Number of pings back-to-back (default: 3)
# ping_interval = 60    # Wait time in seconds after each batch (default: 1)
"#
    )
}

/// Ask user if they want to generate a default config (for interactive mode when config is missing)
pub fn prompt_create_config(config_path: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    let term = Term::stdout();

    term.write_line("")?;
    term.write_line(&format!(
        "{}",
        style(format!(
            "Config file '{}' not found.",
            config_path.display()
        ))
        .yellow()
    ))?;
    term.write_line("")?;

    let create = Confirm::new()
        .with_prompt("Would you like to create a configuration file?")
        .default(true)
        .interact()?;

    Ok(create)
}

/// Write the config content to a file
pub fn write_config_file(
    config_path: &Path,
    content: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    std::fs::write(config_path, content)?;
    Ok(())
}
