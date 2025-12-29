use crate::api::{
    discovery::start_discovery,
    middleware::ingress_ip_filter_middleware,
    ping::handlers as ping_handlers,
    targets::handlers as target_handlers,
    AppState,
};
use crate::config::AppConfig;
use axum::{
    routing::{get, put},
    Router,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::RwLock;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;
use tsink::Storage;

/// Create the API router
pub fn create_router(
    storage: Arc<dyn Storage>,
    config: Arc<RwLock<AppConfig>>,
    task_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
    write_flag: Arc<AtomicBool>,
    config_path: PathBuf,
    static_dir: Option<PathBuf>,
) -> Router {
    // Convert config_path to actual file path (config crate uses path without extension)
    // The API needs the full path with .toml extension to read/write the file
    let config_file_path = if config_path.extension().is_none() {
        config_path.with_extension("toml")
    } else {
        config_path
    };
    
    let state = AppState {
        storage,
        config,
        task_handles,
        write_flag,
        config_path: config_file_path,
    };

    // Check if ingress-only filtering is enabled
    let ingress_only_enabled = {
        let config = state.config.read().ok();
        config.map(|c| c.server.home_assistant_ingress_only).unwrap_or(false)
    };

    let mut router = Router::new()
        .route("/api/ping/data", get(ping_handlers::get_ping_data))
        .route("/api/ping/aggregated", get(ping_handlers::get_ping_aggregated))
        .route("/api/targets", get(target_handlers::get_targets).post(target_handlers::create_target))
        .route("/api/targets/:id", put(target_handlers::update_target).delete(target_handlers::delete_target))
        .route("/api/storage/stats", get(ping_handlers::get_storage_stats))
        .route("/api/discovery/start", get(start_discovery))
        .with_state(state);

    // Apply IP filtering middleware if home_assistant_ingress_only is enabled
    if ingress_only_enabled {
        info!("Home Assistant ingress-only mode enabled - restricting access to 172.30.32.1 and 172.30.32.2");
        router = router.layer(axum::middleware::from_fn(ingress_ip_filter_middleware));
    }

    // Add static file serving if static directory is provided
    if let Some(static_path) = static_dir {
        let index_path = static_path.join("index.html");
        
        // Serve static files with fallback to index.html for SPA routing
        let serve_dir = ServeDir::new(&static_path)
            .not_found_service(ServeFile::new(&index_path));
        
        router = router.nest_service("/", serve_dir);
    }

    router
}

