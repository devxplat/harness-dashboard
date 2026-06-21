//! HTTP surface: route table, request handlers, SSE stream, and the scan trigger.

use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use harness_core::db::Db;
use harness_core::pricing::Pricing;
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

/// Run a read-only query on its own connection in the blocking pool. Reads use
/// separate connections (WAL allows many readers) so they never wait on the scan's
/// write lock on the shared connection, nor block an async worker thread.
async fn read_json<T, F>(s: &AppState, f: F) -> ApiResult
where
    T: Serialize + Send + 'static,
    F: FnOnce(&Db, &Pricing) -> harness_core::Result<T> + Send + 'static,
{
    let path = (*s.db_path).clone();
    let pricing = s.pricing.clone();
    let value = tokio::task::spawn_blocking(move || -> anyhow::Result<Value> {
        let db = Db::open_read(&path)?;
        Ok(serde_json::to_value(f(&db, &pricing)?)?)
    })
    .await??;
    Ok(Json(value))
}

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
        .route("/api/overview", get(overview))
        .route("/api/overview-bundle", get(overview_bundle))
        .route("/api/prompts", get(prompts))
        .route("/api/projects", get(projects))
        .route("/api/tools", get(tools))
        .route("/api/sessions", get(sessions))
        .route("/api/sessions/{id}", get(session_detail))
        .route("/api/daily", get(daily))
        .route("/api/by-model", get(by_model))
        .route("/api/skills", get(skills))
        .route("/api/subagents", get(subagents))
        .route("/api/workspaces", get(workspaces))
        .route("/api/cross-workspace-leaks", get(empty_array))
        .route("/api/tips", get(tips))
        .route("/api/rtk", get(rtk))
        .route("/api/plan", get(get_plan).post(set_plan))
        .route("/api/settings", get(get_settings).post(post_settings))
        .route("/api/scan", get(scan_blocking))
        .route("/api/refresh", post(refresh))
        .route("/api/tips/dismiss", post(ok))
        .route("/api/stream", get(stream))
        .with_state(state.clone());

    app = with_static_fallback(app);

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

#[cfg(feature = "release-embed")]
fn with_static_fallback(app: Router) -> Router {
    app.fallback(crate::static_assets::handler)
}

#[cfg(not(feature = "release-embed"))]
fn with_static_fallback(app: Router) -> Router {
    app.fallback(dev_root)
}

#[cfg(not(feature = "release-embed"))]
async fn dev_root() -> &'static str {
    "harness-dashboard API. In dev the UI runs on http://127.0.0.1:3000"
}

async fn overview(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, pr| {
        db.overview_totals(pr, since.as_deref(), until.as_deref())
    })
    .await
}

async fn overview_bundle(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let path = (*s.db_path).clone();
    let pr = s.pricing.clone();

    // Fan the six aggregations out across independent read-only connections so
    // they run concurrently instead of serializing on one connection (~5s -> ~1.5s
    // on a large database). Same SQL — no behavioral change, just parallelism.
    let totals = {
        let (path, pr, since, until) = (path.clone(), pr.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.overview_totals(&pr, since.as_deref(), until.as_deref())?)
        })
    };
    let projects = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.projects(since.as_deref(), until.as_deref())?)
        })
    };
    let sessions = {
        let (path, pr, since, until) = (path.clone(), pr.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.recent_sessions(
                &pr,
                10,
                since.as_deref(),
                until.as_deref(),
            )?)
        })
    };
    let tools = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.tools(since.as_deref(), until.as_deref())?)
        })
    };
    let daily = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.daily(since.as_deref(), until.as_deref())?)
        })
    };
    let activity = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.activity_buckets(since.as_deref(), until.as_deref())?)
        })
    };
    let by_model = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        Ok(Db::open_read(&path)?.by_model(&pr, since.as_deref(), until.as_deref())?)
    });

    Ok(Json(json!({
        "totals": totals.await??,
        "projects": projects.await??,
        "sessions": sessions.await??,
        "tools": tools.await??,
        "daily": daily.await??,
        "activity": activity.await??,
        "byModel": by_model.await??,
    })))
}

async fn prompts(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let sort = q.sort.clone().unwrap_or_else(|| "tokens".to_string());
    let limit = q.limit(50);
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, pr| {
        db.expensive_prompts(pr, limit, &sort, since.as_deref(), until.as_deref())
    })
    .await
}

async fn projects(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.projects(since.as_deref(), until.as_deref())
    })
    .await
}

async fn tools(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.tools(since.as_deref(), until.as_deref())
    })
    .await
}

async fn sessions(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let limit = q.limit(20);
    read_json(&s, move |db, pr| {
        db.recent_sessions(pr, limit, since.as_deref(), until.as_deref())
    })
    .await
}

async fn session_detail(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult {
    read_json(&s, move |db, _| db.session_detail(&id)).await
}

async fn daily(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.daily(since.as_deref(), until.as_deref())
    })
    .await
}

async fn by_model(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, pr| {
        db.by_model(pr, since.as_deref(), until.as_deref())
    })
    .await
}

async fn empty_array() -> Json<Value> {
    Json(json!([]))
}

async fn skills(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.skill_breakdown(since.as_deref(), until.as_deref())
    })
    .await
}

async fn subagents(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, pr| {
        let by_kind = db.subagents_by_kind(pr, since.as_deref(), until.as_deref())?;
        let by_entrypoint = db.subagents_by_entrypoint(pr, since.as_deref(), until.as_deref())?;
        Ok(json!({
            "by_kind": by_kind,
            "by_entrypoint": by_entrypoint,
            "breakdown": [],
            "top_sessions": [],
            "sdk_runs": [],
            "dispatch_tree": [],
        }))
    })
    .await
}

async fn workspaces(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.workspaces(since.as_deref(), until.as_deref())
    })
    .await
}

async fn tips(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| db.tips(since.as_deref(), until.as_deref())).await
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
    read_json(&s, move |db, pr| {
        Ok(json!({ "plan": db.get_plan()?, "pricing": pr }))
    })
    .await
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
    let claude = harness_core::paths::claude_dir().display().to_string();
    let projects = s.projects_dir.display().to_string();
    let overridden = std::env::var("CLAUDE_PROJECTS_DIR").is_ok();
    read_json(&s, move |db, _| {
        Ok(json!({
            "claude_dir": claude.clone(),
            "projects_dir": projects,
            "projects_overridden": overridden,
            "claude_dirs": [claude],
            "plan": db.get_plan()?,
        }))
    })
    .await
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
