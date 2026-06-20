//! HTTP surface: route table, request handlers, SSE stream, and the scan trigger.

use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use harness_core::scan::{self, ScanStats};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{Any, CorsLayer};

/// Error wrapper that renders as a 500 with the message.
pub struct AppError(anyhow::Error);
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
    }
}
impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(e: E) -> Self {
        Self(e.into())
    }
}
type ApiResult = Result<Json<Value>, AppError>;

#[derive(Debug, Deserialize)]
pub struct RangeParams {
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: Option<i64>,
    pub sort: Option<String>,
}
impl RangeParams {
    fn since(&self) -> Option<&str> {
        self.since.as_deref().filter(|s| !s.is_empty())
    }
    fn until(&self) -> Option<&str> {
        self.until.as_deref().filter(|s| !s.is_empty())
    }
    fn limit(&self, default: i64) -> i64 {
        self.limit.unwrap_or(default).clamp(1, 1000)
    }
}

/// Event broadcast to SSE subscribers after each scan.
#[derive(Debug, Clone, Serialize)]
pub struct ScanEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub n: Option<ScanCounts>,
    pub reason: Option<String>,
    pub message: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ScanCounts {
    pub files: i64,
    pub messages: i64,
    pub tools: i64,
}

/// Run a scan now (on a blocking thread) and broadcast the result. Returns counts.
pub async fn scan_now(state: &AppState) -> ScanStats {
    if state.scanning.swap(true, Ordering::SeqCst) {
        let _ = state.tx.send(ScanEvent {
            kind: "scan-skip".into(),
            n: None,
            reason: Some("already-running".into()),
            message: None,
        });
        return ScanStats::default();
    }
    let db = state.db.clone();
    let dir = state.projects_dir.clone();
    let res = tokio::task::spawn_blocking(move || scan::scan_dir(&db, dir.as_path())).await;
    state.scanning.store(false, Ordering::SeqCst);

    match res {
        Ok(Ok(stats)) => {
            let _ = state.tx.send(ScanEvent {
                kind: "scan".into(),
                n: Some(ScanCounts {
                    files: stats.files,
                    messages: stats.messages,
                    tools: stats.tools,
                }),
                reason: None,
                message: None,
            });
            stats
        }
        other => {
            let msg = match other {
                Ok(Err(e)) => e.to_string(),
                Err(e) => e.to_string(),
                _ => "unknown".into(),
            };
            let _ = state.tx.send(ScanEvent {
                kind: "error".into(),
                n: None,
                reason: None,
                message: Some(msg),
            });
            ScanStats::default()
        }
    }
}

pub fn router(state: AppState) -> Router {
    let mut app = Router::new()
        .route("/", get(root))
        .route("/api/overview", get(overview))
        .route("/api/overview-bundle", get(overview_bundle))
        .route("/api/prompts", get(prompts))
        .route("/api/projects", get(projects))
        .route("/api/tools", get(tools))
        .route("/api/sessions", get(sessions))
        .route("/api/sessions/{id}", get(session_detail))
        .route("/api/daily", get(daily))
        .route("/api/by-model", get(by_model))
        .route("/api/skills", get(empty_array))
        .route("/api/subagents", get(subagents_stub))
        .route("/api/workspaces", get(workspaces_stub))
        .route("/api/cross-workspace-leaks", get(empty_array))
        .route("/api/tips", get(empty_array))
        .route("/api/rtk", get(rtk))
        .route("/api/plan", get(get_plan).post(set_plan))
        .route("/api/settings", get(get_settings).post(post_settings))
        .route("/api/scan", get(scan_blocking))
        .route("/api/refresh", post(refresh))
        .route("/api/tips/dismiss", post(ok))
        .route("/api/stream", get(stream))
        .with_state(state.clone());

    if state.dev {
        app = app.layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );
    }
    app
}

async fn root() -> &'static str {
    "harness-dashboard API. In dev the UI runs on http://127.0.0.1:3000"
}

async fn overview(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let t = s.db.overview_totals(&s.pricing, q.since(), q.until())?;
    Ok(Json(serde_json::to_value(t)?))
}

async fn overview_bundle(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let totals = s.db.overview_totals(&s.pricing, q.since(), q.until())?;
    let projects = s.db.projects(q.since(), q.until())?;
    let sessions = s.db.recent_sessions(&s.pricing, 10, q.since(), q.until())?;
    let tools = s.db.tools(q.since(), q.until())?;
    let daily = s.db.daily(q.since(), q.until())?;
    let by_model = s.db.by_model(&s.pricing, q.since(), q.until())?;
    Ok(Json(json!({
        "totals": totals,
        "projects": projects,
        "sessions": sessions,
        "tools": tools,
        "daily": daily,
        "byModel": by_model,
    })))
}

async fn prompts(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let sort = q.sort.as_deref().unwrap_or("tokens");
    let rows = s.db.expensive_prompts(&s.pricing, q.limit(50), sort)?;
    Ok(Json(serde_json::to_value(rows)?))
}

async fn projects(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    Ok(Json(serde_json::to_value(
        s.db.projects(q.since(), q.until())?,
    )?))
}

async fn tools(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    Ok(Json(serde_json::to_value(
        s.db.tools(q.since(), q.until())?,
    )?))
}

async fn sessions(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let rows =
        s.db.recent_sessions(&s.pricing, q.limit(20), q.since(), q.until())?;
    Ok(Json(serde_json::to_value(rows)?))
}

async fn session_detail(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    Ok(Json(serde_json::to_value(s.db.session_detail(&id)?)?))
}

async fn daily(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    Ok(Json(serde_json::to_value(
        s.db.daily(q.since(), q.until())?,
    )?))
}

async fn by_model(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    Ok(Json(serde_json::to_value(s.db.by_model(
        &s.pricing,
        q.since(),
        q.until(),
    )?)?))
}

async fn empty_array() -> Json<Value> {
    Json(json!([]))
}

async fn subagents_stub() -> Json<Value> {
    Json(json!({
        "breakdown": [], "top_sessions": [], "by_kind": [],
        "by_entrypoint": [], "sdk_runs": [], "dispatch_tree": []
    }))
}

async fn workspaces_stub() -> Json<Value> {
    Json(json!({
        "nodes": [], "links": [], "total_calls": 0,
        "self_loop_calls": 0, "cross_workspace_calls": 0
    }))
}

async fn rtk() -> Json<Value> {
    Json(json!({
        "available": false,
        "install_url": "https://github.com/",
        "summary": Value::Null,
        "daily": [], "weekly": [], "monthly": []
    }))
}

async fn get_plan(State(s): State<AppState>) -> ApiResult {
    let plan = s.db.get_plan()?;
    Ok(Json(json!({ "plan": plan, "pricing": &*s.pricing })))
}

#[derive(Deserialize)]
struct PlanBody {
    plan: String,
}
async fn set_plan(State(s): State<AppState>, Json(b): Json<PlanBody>) -> ApiResult {
    s.db.set_plan(&b.plan)?;
    Ok(Json(json!({ "ok": true })))
}

async fn get_settings(State(s): State<AppState>) -> ApiResult {
    let claude = harness_core::paths::claude_dir();
    Ok(Json(json!({
        "claude_dir": claude.display().to_string(),
        "projects_dir": s.projects_dir.display().to_string(),
        "projects_overridden": std::env::var("CLAUDE_PROJECTS_DIR").is_ok(),
        "claude_dirs": [claude.display().to_string()],
        "plan": s.db.get_plan()?,
    })))
}

#[derive(Deserialize)]
struct SettingsBody {
    plan: Option<String>,
}
async fn post_settings(State(s): State<AppState>, Json(b): Json<SettingsBody>) -> ApiResult {
    if let Some(plan) = b.plan {
        s.db.set_plan(&plan)?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn scan_blocking(State(s): State<AppState>) -> ApiResult {
    let n = scan_now(&s).await;
    Ok(Json(
        json!({ "files": n.files, "messages": n.messages, "tools": n.tools }),
    ))
}

async fn refresh(State(s): State<AppState>) -> Json<Value> {
    tokio::spawn(async move { scan_now(&s).await });
    Json(json!({ "ok": true }))
}

async fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn stream(
    State(s): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = s.tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| {
        msg.ok()
            .and_then(|ev| Event::default().json_data(ev).ok())
            .map(Ok)
    });
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}
