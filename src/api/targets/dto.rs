use serde::Deserialize;

/// Request body for creating/updating a target
#[derive(Debug, Deserialize)]
pub struct TargetRequest {
    pub id: Option<String>,
    pub address: String,
    pub name: Option<String>,
    pub ping_count: Option<u16>,
    pub ping_interval: Option<u64>,
}

