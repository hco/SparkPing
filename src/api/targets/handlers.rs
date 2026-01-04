use super::dto::TargetRequest;
use crate::api::AppState;
use crate::config::Target;
use crate::config_file;
use crate::tasks::start_ping_task;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use std::sync::Arc;
use tracing::error;
use uuid::Uuid;

/// HTTP handler for GET /api/targets
pub(crate) async fn get_targets(
    State(state): State<AppState>,
) -> Result<Json<Vec<Target>>, (StatusCode, String)> {
    let config = state.config.read().map_err(|e| {
        error!("Failed to read config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read configuration".to_string(),
        )
    })?;

    Ok(Json(config.targets.clone()))
}

/// HTTP handler for POST /api/targets
pub(crate) async fn create_target(
    State(state): State<AppState>,
    Json(request): Json<TargetRequest>,
) -> Result<Json<Target>, (StatusCode, String)> {
    // Validate address
    if request.address.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Address is required".to_string()));
    }

    // Read current config
    let mut config = state.config.write().map_err(|e| {
        error!("Failed to write config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access configuration".to_string(),
        )
    })?;

    // Generate ID if not provided
    let id = request.id.unwrap_or_else(|| Uuid::new_v4().to_string());

    // Check if ID already exists
    if config.targets.iter().any(|t| t.id == id) {
        return Err((
            StatusCode::CONFLICT,
            format!("Target with id '{}' already exists", id),
        ));
    }

    // Create new target
    let new_target = Target {
        id: id.clone(),
        address: request.address,
        name: request.name,
        ping_count: request.ping_count.unwrap_or(3),
        ping_interval: request.ping_interval.unwrap_or(1),
    };

    // Read config file
    let mut doc = config_file::read_config_file(&state.config_path).map_err(|e| {
        error!("Failed to read config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config file: {}", e),
        )
    })?;

    // Add target to document
    config_file::add_target(&mut doc, &new_target).map_err(|e| {
        error!("Failed to add target: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to add target: {}", e),
        )
    })?;

    // Write config file
    config_file::write_config_file(&state.config_path, &doc, &state.write_flag).map_err(|e| {
        error!("Failed to write config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write config file: {}", e),
        )
    })?;

    // Update in-memory config
    config.targets.push(new_target.clone());
    drop(config);

    // Start ping task immediately
    {
        let config = state.config.read().map_err(|e| {
            error!("Failed to read config: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access config".to_string(),
            )
        })?;
        let socket_type = config.ping.socket_type;
        drop(config);

        let mut handles = state.task_handles.write().map_err(|e| {
            error!("Failed to write task handles: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access task handles".to_string(),
            )
        })?;
        let handle = start_ping_task(&new_target, Arc::clone(&state.storage), socket_type);
        handles.insert(new_target.id.clone(), handle);
    }

    Ok(Json(new_target))
}

/// HTTP handler for PUT /api/targets/{id}
pub(crate) async fn update_target(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<TargetRequest>,
) -> Result<Json<Target>, (StatusCode, String)> {
    // Validate address
    if request.address.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Address is required".to_string()));
    }

    // Read current config
    let mut config = state.config.write().map_err(|e| {
        error!("Failed to write config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access configuration".to_string(),
        )
    })?;

    // Find target
    let target_idx = config
        .targets
        .iter()
        .position(|t| t.id == id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Target with id '{}' not found", id),
            )
        })?;

    // Create updated target
    let updated_target = Target {
        id: request
            .id
            .unwrap_or_else(|| config.targets[target_idx].id.clone()),
        address: request.address,
        name: request.name,
        ping_count: request
            .ping_count
            .unwrap_or(config.targets[target_idx].ping_count),
        ping_interval: request
            .ping_interval
            .unwrap_or(config.targets[target_idx].ping_interval),
    };

    // Read config file
    let mut doc = config_file::read_config_file(&state.config_path).map_err(|e| {
        error!("Failed to read config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config file: {}", e),
        )
    })?;

    // Update target in document
    config_file::update_target(&mut doc, &id, &updated_target).map_err(|e| {
        error!("Failed to update target: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update target: {}", e),
        )
    })?;

    // Write config file
    config_file::write_config_file(&state.config_path, &doc, &state.write_flag).map_err(|e| {
        error!("Failed to write config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write config file: {}", e),
        )
    })?;

    // Update in-memory config and get socket_type before dropping
    config.targets[target_idx] = updated_target.clone();
    let socket_type = config.ping.socket_type;
    drop(config);

    // Restart ping task immediately
    {
        let mut handles = state.task_handles.write().map_err(|e| {
            error!("Failed to write task handles: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access task handles".to_string(),
            )
        })?;
        if let Some(old_handle) = handles.remove(&id) {
            old_handle.abort();
        }
        let handle = start_ping_task(&updated_target, Arc::clone(&state.storage), socket_type);
        handles.insert(updated_target.id.clone(), handle);
    }

    Ok(Json(updated_target))
}

/// HTTP handler for DELETE /api/targets/{id}
pub(crate) async fn delete_target(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Read current config
    let mut config = state.config.write().map_err(|e| {
        error!("Failed to write config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access configuration".to_string(),
        )
    })?;

    // Check if target exists
    if !config.targets.iter().any(|t| t.id == id) {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Target with id '{}' not found", id),
        ));
    }

    // Read config file
    let mut doc = config_file::read_config_file(&state.config_path).map_err(|e| {
        error!("Failed to read config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config file: {}", e),
        )
    })?;

    // Remove target from document
    config_file::remove_target(&mut doc, &id).map_err(|e| {
        error!("Failed to remove target: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to remove target: {}", e),
        )
    })?;

    // Write config file
    config_file::write_config_file(&state.config_path, &doc, &state.write_flag).map_err(|e| {
        error!("Failed to write config file: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write config file: {}", e),
        )
    })?;

    // Update in-memory config
    config.targets.retain(|t| t.id != id);
    drop(config);

    // Stop ping task
    {
        let mut handles = state.task_handles.write().map_err(|e| {
            error!("Failed to write task handles: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to access task handles".to_string(),
            )
        })?;
        if let Some(handle) = handles.remove(&id) {
            handle.abort();
        }
    }

    Ok(StatusCode::NO_CONTENT)
}
