use crate::config::AppConfig;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::RwLock;
use std::collections::HashMap;
use tsink::Storage;

/// Application state for API routes
#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub config: Arc<RwLock<AppConfig>>,
    pub task_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
    pub write_flag: Arc<AtomicBool>,
    pub config_path: PathBuf,
}

