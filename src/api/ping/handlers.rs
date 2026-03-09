use super::dto::{
    PingAggregatedQuery, PingAggregatedResponse, PingDataQuery, PingDataResponse, QueryMetadata,
    TimeRange,
};
use super::query::{
    calculate_statistics, calculate_storage_stats, parse_bucket_duration,
    query_ping_aggregated_chunked, query_ping_data_with_labels, resolve_time_range_value,
    ResolvedPingDataQuery,
};
use crate::api::AppState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
};
use std::sync::Arc;
use tracing::{error, info};

/// HTTP handler for GET /api/ping/data
pub(crate) async fn get_ping_data(
    State(state): State<AppState>,
    Query(query): Query<PingDataQuery>,
) -> Result<Json<PingDataResponse>, (StatusCode, String)> {
    info!("Querying ping data: {:?}", query);

    // Resolve relative time range to absolute timestamp
    let resolved_from = if let Some(ref from_value) = query.from {
        resolve_time_range_value(from_value).map_err(|e| {
            error!("Invalid time range: {}", e);
            (StatusCode::BAD_REQUEST, e)
        })?
    } else {
        0
    };
    let resolved_to = query.to.unwrap_or_else(|| chrono::Utc::now().timestamp());

    // Store resolved timestamp for response metadata
    let resolved_from_timestamp = Some(resolved_from);

    // Create resolved query for internal use
    let resolved_query = ResolvedPingDataQuery {
        target: query.target.clone(),
        from: resolved_from,
        to: resolved_to,
        metric: query.metric.clone(),
        limit: query.limit,
    };

    // Run blocking storage query on a dedicated thread to avoid blocking the async runtime
    let storage = Arc::clone(&state.storage);
    let points = tokio::task::spawn_blocking(move || {
        query_ping_data_with_labels(&*storage, &resolved_query)
    })
    .await
    .map_err(|e| {
        error!("Task join error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?
    .map_err(|e| {
        error!("Error querying ping data: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let statistics = calculate_statistics(&points);

    let data_time_range = if !points.is_empty() {
        Some(TimeRange {
            earliest: points.first().unwrap().timestamp_unix,
            latest: points.last().unwrap().timestamp_unix,
        })
    } else {
        None
    };

    let total_count = points.len();

    let response = PingDataResponse {
        query: QueryMetadata {
            target_filter: query.target.clone(),
            from_timestamp: resolved_from_timestamp,
            to_timestamp: query.to,
            metric_filter: query.metric.clone(),
            limit: query.limit,
            data_time_range,
        },
        data: points,
        statistics,
        total_count,
    };

    Ok(Json(response))
}

/// HTTP handler for GET /api/ping/aggregated
pub(crate) async fn get_ping_aggregated(
    State(state): State<AppState>,
    Query(query): Query<PingAggregatedQuery>,
) -> Result<Json<PingAggregatedResponse>, (StatusCode, String)> {
    info!("Querying aggregated ping data: {:?}", query);

    // Parse bucket duration
    let bucket_duration_seconds = parse_bucket_duration(&query.bucket).map_err(|e| {
        error!("Invalid bucket duration: {}", e);
        (StatusCode::BAD_REQUEST, e)
    })?;

    // Resolve relative time range to absolute timestamp
    let resolved_from = if let Some(ref from_value) = query.from {
        resolve_time_range_value(from_value).map_err(|e| {
            error!("Invalid time range: {}", e);
            (StatusCode::BAD_REQUEST, e)
        })?
    } else {
        0
    };
    let resolved_to = query.to.unwrap_or_else(|| chrono::Utc::now().timestamp());

    let resolved_from_timestamp = Some(resolved_from);
    let include_percentiles = query.include_percentiles.unwrap_or(false);

    // Run blocking storage query on a dedicated thread to avoid blocking the async runtime
    let storage = Arc::clone(&state.storage);
    let target_filter = query.target.clone();
    let (bucket_data, data_time_range) = tokio::task::spawn_blocking(move || {
        query_ping_aggregated_chunked(
            &*storage,
            target_filter.as_deref(),
            resolved_from,
            resolved_to,
            bucket_duration_seconds,
            include_percentiles,
        )
    })
    .await
    .map_err(|e| {
        error!("Task join error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?
    .map_err(|e| {
        error!("Error querying aggregated ping data: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let total_count = bucket_data.len();

    let response = PingAggregatedResponse {
        query: QueryMetadata {
            target_filter: query.target.clone(),
            from_timestamp: resolved_from_timestamp,
            to_timestamp: query.to,
            metric_filter: query.metric.clone(),
            limit: None,
            data_time_range,
        },
        data: bucket_data,
        total_count,
        bucket_duration_seconds,
    };

    Ok(Json(response))
}

/// HTTP handler for GET /api/storage/stats
pub(crate) async fn get_storage_stats(
    State(state): State<AppState>,
) -> Result<Json<super::dto::StorageStatsResponse>, (StatusCode, String)> {
    let config = state.config.read().map_err(|e| {
        error!("Failed to read config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read configuration".to_string(),
        )
    })?;

    let data_path = config.database.path.clone();
    drop(config);

    let stats = calculate_storage_stats(&data_path).map_err(|e| {
        error!("Failed to calculate storage stats: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to calculate storage stats: {}", e),
        )
    })?;

    Ok(Json(stats))
}
