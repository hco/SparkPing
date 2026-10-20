use crate::config::{SocketType, Target};
use crate::failure_streak::{FailureStreak, Transition};
use crate::ping::perform_ping;
use crate::storage::write::write_ping_result;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::task::AbortHandle;
use tracing::{error, info, warn};
use tsink::Storage;

const UNREACHABLE_REMINDER: Duration = Duration::from_secs(60 * 60);
const WRITE_ERROR_REMINDER: Duration = Duration::from_secs(15 * 60);

/// Start a ping task for a target and return its abort handle.
/// `stagger_ms` adds an initial delay to avoid all targets pinging simultaneously.
pub fn start_ping_task(
    target: &Target,
    storage: Arc<dyn Storage>,
    socket_type: SocketType,
    stagger_ms: u64,
) -> AbortHandle {
    let target_id = target.id.clone();
    let target_address = target.address.clone();
    let target_name = target.name.clone();
    let ping_count = target.ping_count;
    let ping_interval = target.ping_interval;

    let handle = tokio::spawn(async move {
        let label = target_name.clone().unwrap_or_else(|| target_address.clone());
        let mut reachability = FailureStreak::new(UNREACHABLE_REMINDER);
        let mut write_errors = FailureStreak::new(WRITE_ERROR_REMINDER);

        // Stagger start to avoid thundering herd on sockets
        if stagger_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(stagger_ms)).await;
        }
        loop {
            let mut any_success = false;
            let mut last_error = None;

            // Perform ping_count pings back-to-back (no delay between them)
            for sequence in 1..=ping_count {
                let result = perform_ping(
                    &target_id,
                    &target_address,
                    sequence,
                    &target_name,
                    socket_type,
                )
                .await;

                any_success |= result.success;
                if result.error.is_some() {
                    last_error = result.error.clone();
                }

                // Inserts can block on WAL I/O and shard locks shared with the
                // migration, so keep them off the async runtime threads.
                let storage = Arc::clone(&storage);
                let write_result =
                    tokio::task::spawn_blocking(move || write_ping_result(&*storage, &result))
                        .await
                        .unwrap_or_else(|e| Err(tsink::TsinkError::Other(e.to_string())));
                match write_errors.record(Instant::now(), write_result.is_ok()) {
                    Transition::Unchanged => {}
                    Transition::Started => {
                        if let Err(e) = &write_result {
                            error!(target = %target_address, "Error writing ping result for {}: {}", label, e);
                        }
                    }
                    Transition::Ongoing { duration, failures } => {
                        if let Err(e) = &write_result {
                            error!(
                                target = %target_address,
                                "Writing ping results for {} still failing after {}s ({} failed writes): {}",
                                label, duration.as_secs(), failures, e
                            );
                        }
                    }
                    Transition::Recovered { duration, failures } => {
                        info!(
                            target = %target_address,
                            "Writing ping results for {} recovered after {}s ({} failed writes)",
                            label, duration.as_secs(), failures
                        );
                    }
                }
            }

            // A cycle counts as unreachable only when every ping failed;
            // partial loss is visible in the charts.
            let error = last_error.as_deref().unwrap_or("unknown error");
            match reachability.record(Instant::now(), any_success) {
                Transition::Unchanged => {}
                Transition::Started => {
                    warn!(target = %target_address, "{} is unreachable: {}", label, error);
                }
                Transition::Ongoing { duration, failures } => {
                    warn!(
                        target = %target_address,
                        "{} still unreachable after {} min ({} failed cycles): {}",
                        label, duration.as_secs() / 60, failures, error
                    );
                }
                Transition::Recovered { duration, failures } => {
                    info!(
                        target = %target_address,
                        "{} reachable again after {} min ({} failed cycles)",
                        label, duration.as_secs() / 60, failures
                    );
                }
            }

            // Wait ping_interval seconds before next batch of pings
            tokio::time::sleep(std::time::Duration::from_secs(ping_interval)).await;
        }
    })
    .abort_handle();

    handle
}
