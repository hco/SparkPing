use crate::discovery::{run_mdns_discovery, DiscoveryEvent};
use async_stream::stream;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::Stream;
use std::convert::Infallible;
use tokio::sync::mpsc;
use tracing::{error, info};

/// HTTP handler for GET /api/discovery/start (SSE endpoint)
///
/// Starts device discovery and streams discovered devices as SSE events.
/// Discovery runs indefinitely until the client closes the connection.
pub async fn start_discovery() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    info!("Starting indefinite device discovery");

    let stream = stream! {
        let (tx, mut rx) = mpsc::channel::<DiscoveryEvent>(100);

        // Spawn the discovery task
        tokio::spawn(async move {
            run_mdns_discovery(tx).await;
        });

        // Stream events as they arrive
        // Discovery runs until the client disconnects (which closes rx)
        while let Some(event) = rx.recv().await {
            match serde_json::to_string(&event) {
                Ok(json) => {
                    yield Ok(Event::default().data(json));
                }
                Err(e) => {
                    error!("Failed to serialize discovery event: {}", e);
                }
            }

            // If this was an error event, we're done
            if matches!(event, DiscoveryEvent::Error { .. }) {
                break;
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

