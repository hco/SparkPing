use crate::api::AppState;
use crate::health::HealthReport;
use axum::{extract::State, http::StatusCode, response::Json};
use std::sync::Arc;
use tracing::error;

/// Health of this instance. Always 200 when the server answers; the status
/// field says whether something is wrong.
pub(crate) async fn get_health(
    State(state): State<AppState>,
) -> Result<Json<HealthReport>, (StatusCode, String)> {
    let health = Arc::clone(&state.health);
    tokio::task::spawn_blocking(move || health.report())
        .await
        .map(Json)
        .map_err(|e| {
            error!("Health check task failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Health check task failed".to_string(),
            )
        })
}
