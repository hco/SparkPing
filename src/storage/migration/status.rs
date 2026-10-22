use serde::Serialize;
use std::sync::RwLock;

/// Progress of the tsink 0.5 → 0.10 migration, shared with the API.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum MigrationState {
    /// No legacy data was found at startup.
    NotNeeded,
    Running {
        percent: u8,
        points_migrated: u64,
        /// Why inserting is paused at the moment, if it is.
        paused: Option<String>,
    },
    /// Finished this run. `failed_partitions` were kept and are retried on the
    /// next start. Memory used by the migration is only released on restart.
    Completed {
        failed_partitions: usize,
        points_migrated: u64,
    },
    Failed {
        error: String,
    },
}

#[derive(Debug)]
pub struct MigrationStatus(RwLock<MigrationState>);

impl MigrationStatus {
    pub fn new(state: MigrationState) -> Self {
        Self(RwLock::new(state))
    }

    pub fn get(&self) -> MigrationState {
        self.0
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn set(&self, state: MigrationState) {
        *self
            .0
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = state;
    }
}
