use crate::config::{SocketType, Target};
use crate::ping::perform_ping;
use crate::storage::write_ping_result;
use std::sync::Arc;
use tokio::task::AbortHandle;
use tracing::error;
use tsink::Storage;

/// Start a ping task for a target and return its abort handle
pub fn start_ping_task(
    target: &Target,
    storage: Arc<dyn Storage>,
    socket_type: SocketType,
) -> AbortHandle {
    let target_id = target.id.clone();
    let target_address = target.address.clone();
    let target_name = target.name.clone();
    let ping_count = target.ping_count;
    let ping_interval = target.ping_interval;

    let handle = tokio::spawn(async move {
        loop {
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

                // Write result to tsink
                if let Err(e) = write_ping_result(&*storage, &result) {
                    error!("Error writing ping result to tsink: {}", e);
                }
            }

            // Wait ping_interval seconds before next batch of pings
            tokio::time::sleep(std::time::Duration::from_secs(ping_interval)).await;
        }
    })
    .abort_handle();

    handle
}
