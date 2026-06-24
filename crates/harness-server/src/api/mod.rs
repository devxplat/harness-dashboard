//! HTTP surface: route table, request handlers, SSE stream, and the scan trigger.

use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use harness_core::db::{Db, Grain};
use harness_core::model::ProviderId;
use harness_core::pricing::Pricing;
use harness_core::scan::{self, ScanStats};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::path::PathBuf;
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
    pub providers: Option<String>,
    pub grain: Option<String>,
    /// 0-based page index for server-side pagination (sessions/projects/prompts).
    pub page: Option<i64>,
    /// Rows per page for server-side pagination.
    pub page_size: Option<i64>,
    /// Minutes east of UTC for bucketing UTC message timestamps into local
    /// hours (productivity matrix). Commits carry their own offset and ignore it.
    pub tz_offset_min: Option<i64>,
}
impl RangeParams {
    fn since(&self) -> Option<&str> {
        self.since.as_deref().filter(|s| !s.is_empty())
    }
    fn until(&self) -> Option<&str> {
        self.until.as_deref().filter(|s| !s.is_empty())
    }
    fn providers(&self) -> Vec<ProviderId> {
        self.providers
            .as_deref()
            .unwrap_or("")
            .split(',')
            .filter_map(|s| s.parse().ok())
            .collect()
    }
    fn providers_none(&self) -> bool {
        self.providers
            .as_deref()
            .map(|s| s.split(',').any(|part| part.trim() == "__none"))
            .unwrap_or(false)
    }
    fn limit(&self, default: i64) -> i64 {
        self.limit.unwrap_or(default).clamp(1, 1000)
    }
    /// 0-based page index (clamped ≥ 0) for server-side pagination.
    fn page(&self) -> i64 {
        self.page.unwrap_or(0).max(0)
    }
    /// Rows per page (clamped to a sane range) for server-side pagination.
    fn page_size(&self, default: i64) -> i64 {
        self.page_size.unwrap_or(default).clamp(1, 200)
    }
    /// Clamped to a sane ±14h window; defaults to UTC.
    fn tz_offset_min(&self) -> i64 {
        self.tz_offset_min.unwrap_or(0).clamp(-840, 840)
    }
}

fn empty_totals() -> Value {
    json!({
        "sessions": 0,
        "turns": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_create_5m_tokens": 0,
        "cache_create_1h_tokens": 0,
        "cost_usd": null,
        "cost_estimated": false,
        "reported_cost_usd": null,
    })
}

/// Empty AI-ROI shape returned when every provider is deselected.
fn empty_ai_roi() -> Value {
    json!({
        "cost_usd": null, "cost_estimated": false, "reported_cost_usd": null,
        "active_days": 0, "merged_prs": 0, "commits": 0, "lines_shipped": 0,
        "cost_per_active_day": null, "cost_per_merged_pr": null,
        "cost_per_commit": null, "cost_per_1k_lines": null,
        "by_provider": [], "by_project": [],
    })
}

/// Empty AI-impact bundle (all four quadrants zeroed) for the all-deselected case.
fn empty_ai_impact() -> Value {
    json!({
        "lines": {
            "summary": {
                "ai_lines": 0, "human_lines": 0, "total_lines": 0,
                "ai_line_pct": null, "ai_commit_pct": null,
                "pr_ai_lines": 0, "pr_human_lines": 0, "pr_ai_line_pct": null,
            },
            "daily": [],
        },
        "roi": empty_ai_roi(),
        "correlation": {
            "series": [],
            "coeffs": {
                "usage_vs_commits": null, "usage_vs_merged_prs": null, "tokens_vs_lead_hours": null,
            },
            "previous_period": null,
        },
        "adoption": {
            "active_days": 0, "span_days": 0, "sessions": 0, "messages": 0, "agent_tasks": 0,
            "pct_active_days": null, "avg_sessions_per_active_day": null, "daily": [],
        },
    })
}

/// The prior equal-length window immediately before `[since, until)`, for the
/// correlation period-over-period comparison. `None` when either bound is missing /
/// unparseable or the window is non-positive.
fn prev_window(since: Option<&str>, until: Option<&str>) -> Option<(String, String)> {
    let s = parse_dt(since?)?;
    let u = parse_dt(until?)?;
    if u <= s {
        return None;
    }
    let span = u - s;
    Some((fmt_dt(s - span), fmt_dt(s)))
}

fn parse_dt(s: &str) -> Option<chrono::NaiveDateTime> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.naive_utc());
    }
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
}

fn fmt_dt(dt: chrono::NaiveDateTime) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Event broadcast to SSE subscribers after each scan.
#[derive(Debug, Clone, Serialize)]
pub struct ScanEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub n: Option<ScanCounts>,
    pub reason: Option<String>,
    pub message: Option<String>,
    /// GitHub-sync progress (only on `github-progress` / `github-sync` events).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<crate::github::GithubProgress>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ScanCounts {
    pub files: i64,
    pub messages: i64,
    pub tools: i64,
    pub repos: i64,
    pub commits: i64,
}

/// Run a scan now (on a blocking thread) and broadcast the result. Returns counts.
pub async fn scan_now(state: &AppState) -> ScanStats {
    if state.scanning.swap(true, Ordering::SeqCst) {
        let _ = state.tx.send(ScanEvent {
            kind: "scan-skip".into(),
            n: None,
            reason: Some("already-running".into()),
            message: None,
            progress: None,
        });
        return ScanStats::default();
    }
    // Tell listeners a scan started, so the UI can show a live "indexing" state
    // (the terminal `scan` event clears it).
    let _ = state.tx.send(ScanEvent {
        kind: "scan-start".into(),
        n: None,
        reason: None,
        message: None,
        progress: None,
    });
    let db = state.db.clone();
    let dir = state.projects_dir.clone();
    let res = tokio::task::spawn_blocking(move || scan::scan_all(&db, dir.as_path())).await;
    state.scanning.store(false, Ordering::SeqCst);

    match res {
        Ok(Ok(stats)) => {
            let _ = state.tx.send(ScanEvent {
                kind: "scan".into(),
                n: Some(ScanCounts {
                    files: stats.files,
                    messages: stats.messages,
                    tools: stats.tools,
                    repos: stats.repos,
                    commits: stats.commits,
                }),
                reason: None,
                message: None,
                progress: None,
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
                progress: None,
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
        .route("/api/commits", get(commits))
        .route("/api/commits/daily", get(commits_daily))
        .route("/api/productivity", get(productivity))
        .route("/api/productivity/insights", get(productivity_insights))
        .route("/api/integrations", get(integrations))
        .route(
            "/api/integrations/github",
            post(set_github_token).delete(disconnect_github),
        )
        .route("/api/integrations/github/sync", post(sync_github_now))
        .route("/api/integrations/github/repos", get(github_repos_list))
        .route(
            "/api/integrations/github/repos/toggle",
            post(toggle_github_repo),
        )
        .route(
            "/api/integrations/github/settings",
            get(get_github_settings).post(set_github_settings),
        )
        .route("/api/integrations/github/status", get(github_status))
        .route("/api/integrations/google/start", get(google_start))
        .route("/api/integrations/google/callback", get(google_callback))
        .route("/api/integrations/google/sync", post(google_sync))
        .route(
            "/api/integrations/google",
            axum::routing::delete(disconnect_google),
        )
        .route("/api/pull-requests", get(pull_requests))
        .route("/api/deployments", get(deployments))
        .route("/api/meetings/impact", get(meeting_impact))
        .route("/api/meetings/daily", get(meetings_daily))
        .route("/api/dora", get(dora))
        .route("/api/dora/bundle", get(dora_bundle))
        .route("/api/ai/lines", get(ai_lines))
        .route("/api/ai/adoption", get(ai_adoption))
        .route("/api/ai/roi", get(ai_roi))
        .route("/api/ai/correlation", get(ai_correlation))
        .route("/api/ai/impact-bundle", get(ai_impact_bundle))
        .route("/api/allocation", get(allocation))
        .route("/api/incidents", get(incidents))
        .route("/api/authors", get(authors))
        .route("/api/authors/dora", get(authors_dora))
        .route("/api/survey", get(survey_get).post(survey_post))
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
        .route("/api/ingest", get(ingest_status))
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
    if q.providers_none() {
        return Ok(Json(empty_totals()));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, pr| {
        db.overview_totals_for_providers(pr, since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn overview_bundle(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!({
            "totals": empty_totals(),
            "projects": [],
            "sessions": [],
            "tools": [],
            "daily": [],
            "activity": [],
            "providers": [],
            "byModel": [],
            "commitsDaily": [],
            "productivity": [],
            "meetingsDaily": [],
        })));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let tz = q.tz_offset_min();
    let providers = q.providers();
    let path = (*s.db_path).clone();
    let pr = s.pricing.clone();

    let totals = {
        let (path, pr, since, until, providers) = (
            path.clone(),
            pr.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.overview_totals_for_providers(
                &pr,
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let projects = {
        let (path, since, until, providers) = (
            path.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            let mut rows = Db::open_read(&path)?.projects_for_providers(
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?;
            rows.truncate(20);
            Ok(rows)
        })
    };
    let sessions = {
        let (path, pr, since, until, providers) = (
            path.clone(),
            pr.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.recent_sessions_for_providers(
                &pr,
                10,
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let daily = {
        let (path, since, until, providers) = (
            path.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.daily_for_providers(
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let activity = {
        let (path, since, until, providers) = (
            path.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.activity_buckets_for_providers(
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let provider_summaries = {
        let (path, pr, since, until, providers) = (
            path.clone(),
            pr.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.provider_summaries(
                &pr,
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let by_model = {
        let (path, pr, since, until, providers) = (
            path.clone(),
            pr.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.by_model_for_providers(
                &pr,
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let tools = {
        let (path, since, until, providers) = (
            path.clone(),
            since.clone(),
            until.clone(),
            providers.clone(),
        );
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.tools_for_providers(
                since.as_deref(),
                until.as_deref(),
                &providers,
            )?)
        })
    };
    let commits_daily = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.commits_daily(since.as_deref(), until.as_deref())?)
        })
    };
    let productivity = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.productive_hours(tz, since.as_deref(), until.as_deref())?)
        })
    };
    let meetings_daily = {
        let (path, since, until) = (path.clone(), since.clone(), until.clone());
        tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
            Ok(Db::open_read(&path)?.meetings_daily(since.as_deref(), until.as_deref())?)
        })
    };
    Ok(Json(json!({
        "totals": totals.await??,
        "projects": projects.await??,
        "sessions": sessions.await??,
        "tools": tools.await??,
        "daily": daily.await??,
        "activity": activity.await??,
        "providers": provider_summaries.await??,
        "byModel": by_model.await??,
        "commitsDaily": commits_daily.await??,
        "productivity": productivity.await??,
        "meetingsDaily": meetings_daily.await??,
    })))
}

async fn prompts(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!({ "rows": [], "total": 0 })));
    }
    let sort = q.sort.clone().unwrap_or_else(|| "tokens".to_string());
    let page_size = q.page_size(25);
    let offset = (q.page() * page_size) as usize;
    let take = page_size as usize;
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, pr| {
        let total = db.count_expensive_prompts_for_providers(
            since.as_deref(),
            until.as_deref(),
            &providers,
        )?;
        // Rank the top `offset+take` by the chosen order, then slice the page.
        let ranked = db.expensive_prompts_for_providers(
            pr,
            (offset + take) as i64,
            &sort,
            since.as_deref(),
            until.as_deref(),
            &providers,
        )?;
        let rows: Vec<_> = ranked.into_iter().skip(offset).take(take).collect();
        Ok(json!({ "rows": rows, "total": total }))
    })
    .await
}

async fn projects(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!([])));
    }
    // Projects are already repo-aggregated server-side (bounded by repo count), so the
    // page renders the full set with client-side pagination.
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, _| {
        db.projects_for_providers(since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn tools(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!([])));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, _| {
        db.tools_for_providers(since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn sessions(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!({ "rows": [], "total": 0 })));
    }
    let page_size = q.page_size(25);
    let offset = (q.page() * page_size) as usize;
    let take = page_size as usize;
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, pr| {
        let total =
            db.count_sessions_for_providers(since.as_deref(), until.as_deref(), &providers)?;
        // Recent-first; fetch through the requested page, then slice it.
        let recent = db.recent_sessions_for_providers(
            pr,
            (offset + take) as i64,
            since.as_deref(),
            until.as_deref(),
            &providers,
        )?;
        let rows: Vec<_> = recent.into_iter().skip(offset).take(take).collect();
        Ok(json!({ "rows": rows, "total": total }))
    })
    .await
}

#[derive(Debug, Deserialize)]
struct SessionDetailParams {
    provider: Option<String>,
}

async fn session_detail(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<SessionDetailParams>,
) -> ApiResult {
    let provider = q.provider.as_deref().and_then(|p| p.parse().ok());
    read_json(&s, move |db, _| {
        db.session_detail_for_provider(&id, provider)
    })
    .await
}

async fn daily(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!([])));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, _| {
        db.daily_for_providers(since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn by_model(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!([])));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, pr| {
        db.by_model_for_providers(pr, since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

// ---------- integrations (Phase 2: GitHub) ----------

#[derive(Deserialize)]
struct TokenBody {
    token: String,
}

const ALLOWED_UNITS: &[&str] = &["days", "weeks", "months", "all", "recent"];
const ALLOWED_PR_SCOPES: &[&str] = &["all", "mine"];

/// PR scope setting: `all` (every author's PRs — baselines) or `mine`. Default `all`.
fn gh_pr_scope(db: &Db) -> harness_core::Result<String> {
    Ok(db
        .get_setting("github_pr_scope")?
        .filter(|v| ALLOWED_PR_SCOPES.contains(&v.as_str()))
        .unwrap_or_else(|| "all".into()))
}

/// Backfill setting (value, unit) with defaults.
fn gh_backfill(db: &Db) -> harness_core::Result<(String, String)> {
    let value = db
        .get_setting("github_backfill_value")?
        .unwrap_or_else(|| "90".into());
    let unit = db
        .get_setting("github_backfill_unit")?
        .unwrap_or_else(|| "days".into());
    Ok((value, unit))
}

/// Auto-sync setting (enabled, interval_min) with defaults + clamp.
fn gh_autosync(db: &Db) -> harness_core::Result<(bool, i64)> {
    let enabled = db.get_setting("github_autosync_enabled")?.as_deref() == Some("1");
    let interval = db
        .get_setting("github_autosync_interval_min")?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(60)
        .clamp(15, 1440);
    Ok((enabled, interval))
}

fn gh_rate(db: &Db) -> harness_core::Result<Value> {
    let num = |k: &str| -> harness_core::Result<Option<i64>> {
        Ok(db.get_setting(k)?.and_then(|v| v.parse::<i64>().ok()))
    };
    Ok(json!({
        "remaining": num("github_rate_remaining")?,
        "limit": num("github_rate_limit")?,
        "reset_utc": db.get_setting("github_rate_reset_utc")?,
    }))
}

/// Status of the opt-in integrations (drives the Settings panel + conditional UI).
async fn integrations(State(s): State<AppState>) -> ApiResult {
    let syncing = s.github_syncing.load(Ordering::SeqCst);
    let db = &s.db;
    let scopes: Vec<String> = db
        .get_setting("github_scopes")?
        .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
        .unwrap_or_default();
    let (bf_value, bf_unit) = gh_backfill(db)?;
    let (auto_enabled, auto_interval) = gh_autosync(db)?;
    let github = json!({
        "configured": db.get_setting("github_token")?.is_some(),
        "repo_count": db.github_repos_all()?.len(),
        "enabled_repo_count": db.github_repos()?.len(),
        "last_sync": db.get_setting("github_last_sync")?,
        "login": db.get_setting("github_login")?,
        "scopes": scopes,
        "has_repo_scope": scopes.iter().any(|x| x == "repo"),
        "syncing": syncing,
        "rate": gh_rate(db)?,
        "backfill": { "value": bf_value.parse::<i64>().unwrap_or(90), "unit": bf_unit },
        "autosync": { "enabled": auto_enabled, "interval_min": auto_interval },
        "pr_scope": gh_pr_scope(db)?,
    });
    Ok(Json(json!({
        "github": github,
        "google": {
            "configured": db.get_setting("google_refresh_token")?.is_some(),
            "last_sync": db.get_setting("google_last_sync")?,
        },
    })))
}

/// Validate the token (GET /user) before storing it; surface login + scopes + budget.
async fn set_github_token(State(s): State<AppState>, Json(b): Json<TokenBody>) -> ApiResult {
    let token = b.token.trim();
    if token.is_empty() {
        return Err(anyhow::anyhow!("empty token").into());
    }
    let info = crate::github::validate_token(token).await?;
    s.db.set_setting("github_token", &harness_core::secrets::encrypt(token)?)?;
    if let Some(login) = &info.login {
        s.db.set_setting("github_login", login)?;
    }
    s.db.set_setting("github_scopes", &serde_json::to_string(&info.scopes)?)?;
    if let Some(rem) = info.rate.remaining {
        s.db.set_setting("github_rate_remaining", &rem.to_string())?;
    }
    if let Some(lim) = info.rate.limit {
        s.db.set_setting("github_rate_limit", &lim.to_string())?;
    }
    if let Some(reset) = &info.rate.reset_utc {
        s.db.set_setting("github_rate_reset_utc", reset)?;
    }
    Ok(Json(json!({
        "ok": true,
        "login": info.login,
        "scopes": info.scopes,
        "has_repo_scope": info.has_repo_scope,
        "rate": info.rate,
    })))
}

async fn disconnect_github(State(s): State<AppState>) -> ApiResult {
    // Clear credentials + budget + login; keep repo selection + sync_state so a
    // reconnect resumes cheaply.
    for k in [
        "github_token",
        "github_login",
        "github_scopes",
        "github_last_sync",
        "github_rate_remaining",
        "github_rate_limit",
        "github_rate_reset_utc",
    ] {
        s.db.delete_setting(k)?;
    }
    Ok(Json(json!({ "ok": true })))
}

/// Kick off a sync in the background and return immediately (so the HTTP call never
/// blocks on the whole sync). Progress streams over SSE + the `/status` endpoint.
async fn sync_github_now(State(s): State<AppState>) -> ApiResult {
    let Some(enc) = s.db.get_setting("github_token")? else {
        return Err(anyhow::anyhow!("GitHub not configured").into());
    };
    let token = harness_core::secrets::decrypt(&enc)?;
    if s.github_syncing.swap(true, Ordering::SeqCst) {
        return Ok(Json(
            json!({ "started": false, "reason": "already-running" }),
        ));
    }
    let db = s.db.clone();
    let tx = s.tx.clone();
    let progress = s.github_progress.clone();
    let syncing = s.github_syncing.clone();
    tokio::spawn(async move {
        match crate::github::sync_github(db.clone(), tx, progress, token).await {
            Ok(_) => {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                let _ = db.set_setting("github_last_sync", &now);
            }
            Err(e) => tracing::warn!("github sync error: {e}"),
        }
        syncing.store(false, Ordering::SeqCst);
    });
    Ok(Json(json!({ "started": true })))
}

/// Trigger a background GitHub sync if auto-sync is enabled, a token is configured,
/// none is running, and the interval has elapsed. Called from the periodic loop.
pub async fn maybe_autosync_github(s: &AppState) {
    let enabled = matches!(
        s.db.get_setting("github_autosync_enabled")
            .ok()
            .flatten()
            .as_deref(),
        Some("1")
    );
    if !enabled {
        return;
    }
    let Some(enc) = s.db.get_setting("github_token").ok().flatten() else {
        return;
    };
    let interval =
        s.db.get_setting("github_autosync_interval_min")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(60)
            .clamp(15, 1440);
    let last = s.db.get_setting("github_last_sync").ok().flatten();
    if !harness_core::github::autosync_due(last.as_deref(), interval, chrono::Utc::now()) {
        return;
    }
    let Ok(token) = harness_core::secrets::decrypt(&enc) else {
        return;
    };
    if s.github_syncing.swap(true, Ordering::SeqCst) {
        return;
    }
    let db = s.db.clone();
    let tx = s.tx.clone();
    let progress = s.github_progress.clone();
    let syncing = s.github_syncing.clone();
    tokio::spawn(async move {
        match crate::github::sync_github(db.clone(), tx, progress, token).await {
            Ok(_) => {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                let _ = db.set_setting("github_last_sync", &now);
            }
            Err(e) => tracing::warn!("github autosync error: {e}"),
        }
        syncing.store(false, Ordering::SeqCst);
    });
}

/// Locally-discovered GitHub repos grouped by owner/org, with enabled flags.
async fn github_repos_list(State(s): State<AppState>) -> ApiResult {
    read_json(&s, |db, _| {
        let repos = db.github_repos_all()?;
        let total_repos = repos.len();
        let enabled_repos = repos.iter().filter(|r| r.enabled).count();
        let mut orgs: Vec<Value> = Vec::new();
        // Repos are returned sorted by (owner, repo), so group runs are contiguous.
        let mut i = 0;
        while i < repos.len() {
            let owner = repos[i].owner.clone();
            let group: Vec<_> = repos[i..].iter().take_while(|r| r.owner == owner).collect();
            let enabled_count = group.iter().filter(|r| r.enabled).count();
            orgs.push(json!({
                "owner": owner,
                "enabled_count": enabled_count,
                "total": group.len(),
                "repos": group.iter().map(|r| json!({
                    "repo_key": r.repo_key, "owner": r.owner, "repo": r.repo,
                    "primary_slug": r.primary_slug, "enabled": r.enabled,
                    "last_synced_at": r.last_synced_at,
                })).collect::<Vec<_>>(),
            }));
            i += group.len();
        }
        Ok(json!({ "orgs": orgs, "total_repos": total_repos, "enabled_repos": enabled_repos }))
    })
    .await
}

#[derive(Deserialize)]
struct RepoToggleBody {
    repo_key: Option<String>,
    owner: Option<String>,
    enabled: bool,
}

async fn toggle_github_repo(State(s): State<AppState>, Json(b): Json<RepoToggleBody>) -> ApiResult {
    if let Some(repo_key) = &b.repo_key {
        s.db.set_repo_sync_enabled(repo_key, b.enabled)?;
    } else if let Some(owner) = &b.owner {
        s.db.set_org_sync_enabled(owner, b.enabled)?;
    } else {
        return Err(anyhow::anyhow!("repo_key or owner required").into());
    }
    Ok(Json(json!({ "ok": true })))
}

async fn get_github_settings(State(s): State<AppState>) -> ApiResult {
    let db = &s.db;
    let (value, unit) = gh_backfill(db)?;
    let (enabled, interval) = gh_autosync(db)?;
    Ok(Json(json!({
        "backfill": { "value": value.parse::<i64>().unwrap_or(90), "unit": unit },
        "autosync": { "enabled": enabled, "interval_min": interval },
        "pr_scope": gh_pr_scope(db)?,
        "backfill_done": db.get_setting("github_backfill_window_sig")?.is_some(),
    })))
}

#[derive(Deserialize)]
struct BackfillBody {
    value: i64,
    unit: String,
}
#[derive(Deserialize)]
struct AutosyncBody {
    enabled: bool,
    interval_min: i64,
}
#[derive(Deserialize)]
struct SyncSettingsBody {
    backfill: Option<BackfillBody>,
    autosync: Option<AutosyncBody>,
    pr_scope: Option<String>,
}

async fn set_github_settings(
    State(s): State<AppState>,
    Json(b): Json<SyncSettingsBody>,
) -> ApiResult {
    if let Some(bf) = b.backfill {
        let unit = if ALLOWED_UNITS.contains(&bf.unit.as_str()) {
            bf.unit
        } else {
            "days".into()
        };
        s.db.set_setting("github_backfill_value", &bf.value.max(1).to_string())?;
        s.db.set_setting("github_backfill_unit", &unit)?;
    }
    if let Some(a) = b.autosync {
        s.db.set_setting("github_autosync_enabled", if a.enabled { "1" } else { "0" })?;
        s.db.set_setting(
            "github_autosync_interval_min",
            &a.interval_min.clamp(15, 1440).to_string(),
        )?;
    }
    if let Some(scope) = b.pr_scope {
        let scope = if ALLOWED_PR_SCOPES.contains(&scope.as_str()) {
            scope
        } else {
            "all".into()
        };
        s.db.set_setting("github_pr_scope", &scope)?;
    }
    get_github_settings(State(s)).await
}

/// Live progress snapshot (SSE fallback poll).
async fn github_status(State(s): State<AppState>) -> ApiResult {
    let progress = s.github_progress.lock().unwrap().clone();
    Ok(Json(json!({ "progress": progress })))
}

/// Lightweight ingest status for the whole UI: whether any local data has been
/// seeded yet, whether a scan or GitHub backfill is in flight, and the live GitHub
/// progress. Powers the data-screen "needs seed / indexing" gate and the shared
/// status pill. Live updates ride the SSE stream; this is the initial/fallback read.
async fn ingest_status(State(s): State<AppState>) -> ApiResult {
    let scanning = s.scanning.load(Ordering::SeqCst);
    let github_syncing = s.github_syncing.load(Ordering::SeqCst);
    let progress = s.github_progress.lock().unwrap().clone();
    let db = &s.db;
    let messages = db.message_count()?;
    let onboarding_done = db.get_setting("onboarding_done")?.as_deref() == Some("true");
    Ok(Json(json!({
        "seeded": messages > 0,
        "onboarding_done": onboarding_done,
        "scanning": scanning,
        "messages": messages,
        "github": {
            "configured": db.get_setting("github_token")?.is_some(),
            "syncing": github_syncing,
            "progress": progress,
        },
    })))
}

async fn pull_requests(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let limit = q.limit(100);
    read_json(&s, move |db, _| {
        db.pull_requests(limit, since.as_deref(), until.as_deref())
    })
    .await
}

async fn deployments(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let limit = q.limit(100);
    read_json(&s, move |db, _| {
        db.deployments(limit, since.as_deref(), until.as_deref())
    })
    .await
}

// ---------- integrations (Phase 3: Google Calendar) ----------

fn google_creds() -> anyhow::Result<(String, String)> {
    let id = std::env::var("GOOGLE_CLIENT_ID")
        .map_err(|_| anyhow::anyhow!("GOOGLE_CLIENT_ID not set"))?;
    let secret = std::env::var("GOOGLE_CLIENT_SECRET")
        .map_err(|_| anyhow::anyhow!("GOOGLE_CLIENT_SECRET not set"))?;
    Ok((id, secret))
}

fn google_redirect_uri(s: &AppState) -> String {
    format!(
        "http://127.0.0.1:{}/api/integrations/google/callback",
        s.port
    )
}

fn store_google_expiry(s: &AppState, expires_in: Option<i64>) -> anyhow::Result<()> {
    let secs = expires_in.unwrap_or(3600).max(120) - 60; // refresh a minute early
    let exp = (chrono::Utc::now() + chrono::Duration::seconds(secs))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    s.db.set_setting("google_token_expiry", &exp)?;
    Ok(())
}

fn store_google_tokens(s: &AppState, tok: &crate::calendar::TokenResponse) -> anyhow::Result<()> {
    s.db.set_setting(
        "google_access_token",
        &harness_core::secrets::encrypt(&tok.access_token)?,
    )?;
    if let Some(rt) = &tok.refresh_token {
        s.db.set_setting("google_refresh_token", &harness_core::secrets::encrypt(rt)?)?;
    }
    store_google_expiry(s, tok.expires_in)?;
    Ok(())
}

/// A valid access token, refreshing via the stored refresh token if expired.
async fn google_access_token(s: &AppState) -> anyhow::Result<String> {
    let enc =
        s.db.get_setting("google_access_token")?
            .ok_or_else(|| anyhow::anyhow!("Google not connected"))?;
    let valid =
        s.db.get_setting("google_token_expiry")?
            .and_then(|e| chrono::DateTime::parse_from_rfc3339(&e).ok())
            .map(|d| d.with_timezone(&chrono::Utc) > chrono::Utc::now())
            .unwrap_or(false);
    if valid {
        return Ok(harness_core::secrets::decrypt(&enc)?);
    }
    let enc_refresh =
        s.db.get_setting("google_refresh_token")?
            .ok_or_else(|| anyhow::anyhow!("no refresh token; reconnect Google"))?;
    let refresh = harness_core::secrets::decrypt(&enc_refresh)?;
    let (id, secret) = google_creds()?;
    let tok = crate::calendar::refresh_access(&id, &secret, &refresh).await?;
    s.db.set_setting(
        "google_access_token",
        &harness_core::secrets::encrypt(&tok.access_token)?,
    )?;
    store_google_expiry(s, tok.expires_in)?;
    Ok(tok.access_token)
}

async fn google_start(State(s): State<AppState>) -> ApiResult {
    let (client_id, _secret) = google_creds()?;
    let (verifier, challenge) = crate::calendar::pkce_pair();
    s.db.set_setting("google_pkce_verifier", &verifier)?;
    let url = crate::calendar::build_auth_url(&client_id, &google_redirect_uri(&s), &challenge);
    Ok(Json(json!({ "auth_url": url })))
}

#[derive(Deserialize)]
struct GoogleCallback {
    code: Option<String>,
    error: Option<String>,
}

async fn google_callback(
    State(s): State<AppState>,
    Query(q): Query<GoogleCallback>,
) -> Html<String> {
    let body = match google_callback_inner(&s, q).await {
        Ok(()) => "<h1>Google Calendar connected ✓</h1><p>You can close this tab and return to the dashboard.</p>".to_string(),
        Err(e) => format!("<h1>Connection failed</h1><p>{e}</p><p>You can close this tab.</p>"),
    };
    Html(format!(
        "<!doctype html><meta charset=utf-8><body style=\"font-family:system-ui;padding:3rem;color:#222\">{body}</body>"
    ))
}

async fn google_callback_inner(s: &AppState, q: GoogleCallback) -> anyhow::Result<()> {
    if let Some(err) = q.error {
        anyhow::bail!("authorization denied: {err}");
    }
    let code = q
        .code
        .ok_or_else(|| anyhow::anyhow!("missing authorization code"))?;
    let verifier =
        s.db.get_setting("google_pkce_verifier")?
            .ok_or_else(|| anyhow::anyhow!("no pending sign-in"))?;
    let (id, secret) = google_creds()?;
    let redirect = google_redirect_uri(s);
    let tok = crate::calendar::exchange_code(&id, &secret, &redirect, &code, &verifier).await?;
    store_google_tokens(s, &tok)?;
    s.db.delete_setting("google_pkce_verifier")?;
    Ok(())
}

async fn google_sync(State(s): State<AppState>) -> ApiResult {
    let token = google_access_token(&s).await?;
    let events = crate::calendar::fetch_events(&token).await?;
    let n = s.db.insert_calendar_events(&events)?;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    s.db.set_setting("google_last_sync", &now)?;
    let _ = s.tx.send(ScanEvent {
        kind: "google-sync".into(),
        n: None,
        reason: None,
        message: None,
        progress: None,
    });
    Ok(Json(json!({ "events": n, "last_sync": now })))
}

async fn disconnect_google(State(s): State<AppState>) -> ApiResult {
    for k in [
        "google_access_token",
        "google_refresh_token",
        "google_token_expiry",
        "google_last_sync",
        "google_pkce_verifier",
    ] {
        s.db.delete_setting(k)?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn meeting_impact(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.meeting_impact(since.as_deref(), until.as_deref())
    })
    .await
}

async fn meetings_daily(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.meetings_daily(since.as_deref(), until.as_deref())
    })
    .await
}

async fn dora(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| db.dora(since.as_deref(), until.as_deref())).await
}

async fn dora_bundle(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let grain = Grain::parse(q.grain.as_deref());
    read_json(&s, move |db, _| {
        db.dora_bundle(grain, since.as_deref(), until.as_deref())
    })
    .await
}

async fn ai_lines(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.ai_lines(since.as_deref(), until.as_deref())
    })
    .await
}

async fn ai_adoption(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!({
            "active_days": 0, "span_days": 0, "sessions": 0, "messages": 0, "agent_tasks": 0,
            "pct_active_days": null, "avg_sessions_per_active_day": null, "daily": [],
        })));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, _| {
        db.ai_adoption(since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn ai_roi(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(empty_ai_roi()));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, pr| {
        db.ai_roi(pr, since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn ai_correlation(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!({
            "series": [],
            "coeffs": { "usage_vs_commits": null, "usage_vs_merged_prs": null, "tokens_vs_lead_hours": null },
            "previous_period": null,
        })));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    let prev = prev_window(since.as_deref(), until.as_deref());
    read_json(&s, move |db, _| {
        let mut bundle = db.ai_correlation(since.as_deref(), until.as_deref(), &providers)?;
        if let Some((ps, pu)) = &prev {
            bundle.previous_period =
                Some(db.ai_correlation(Some(ps), Some(pu), &providers)?.coeffs);
        }
        Ok(bundle)
    })
    .await
}

async fn ai_impact_bundle(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(empty_ai_impact()));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    let prev = prev_window(since.as_deref(), until.as_deref());
    read_json(&s, move |db, pr| {
        let mut bundle = db.ai_impact_bundle(pr, since.as_deref(), until.as_deref(), &providers)?;
        if let Some((ps, pu)) = &prev {
            bundle.correlation.previous_period =
                Some(db.ai_correlation(Some(ps), Some(pu), &providers)?.coeffs);
        }
        Ok(bundle)
    })
    .await
}

async fn allocation(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let grain = Grain::parse(q.grain.as_deref());
    read_json(&s, move |db, _| {
        db.allocation(grain, since.as_deref(), until.as_deref())
    })
    .await
}

async fn incidents(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let limit = q.limit(100);
    read_json(&s, move |db, _| {
        db.incidents(limit, since.as_deref(), until.as_deref())
    })
    .await
}

async fn authors(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.authors(since.as_deref(), until.as_deref())
    })
    .await
}

async fn authors_dora(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.authors_dora(since.as_deref(), until.as_deref())
    })
    .await
}

async fn survey_get(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.survey_correlation(since.as_deref(), until.as_deref())
    })
    .await
}

#[derive(Debug, Deserialize)]
struct SurveyBody {
    flow: Option<i64>,
    productivity: Option<i64>,
    ai_helpful: Option<i64>,
    satisfaction: Option<i64>,
    note: Option<String>,
}

async fn survey_post(State(s): State<AppState>, Json(b): Json<SurveyBody>) -> ApiResult {
    let db = s.db.clone();
    let clamp = |v: Option<i64>| v.map(|x| x.clamp(1, 5));
    let (flow, prod, ai_help, sat) = (
        clamp(b.flow),
        clamp(b.productivity),
        clamp(b.ai_helpful),
        clamp(b.satisfaction),
    );
    let note = b.note;
    let id = tokio::task::spawn_blocking(move || -> anyhow::Result<i64> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        Ok(db.insert_survey_response(&now, flow, prod, ai_help, sat, note.as_deref())?)
    })
    .await??;
    Ok(Json(json!({ "ok": true, "id": id })))
}

async fn commits(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let limit = q.limit(100);
    read_json(&s, move |db, _| {
        db.commits(limit, since.as_deref(), until.as_deref())
    })
    .await
}

async fn commits_daily(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    read_json(&s, move |db, _| {
        db.commits_daily(since.as_deref(), until.as_deref())
    })
    .await
}

async fn productivity(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let tz = q.tz_offset_min();
    read_json(&s, move |db, _| {
        let hours = db.productive_hours(tz, since.as_deref(), until.as_deref())?;
        let by_day = db.ai_split(
            harness_core::db::AiSplitGroup::Day,
            since.as_deref(),
            until.as_deref(),
        )?;
        let by_project = db.ai_split(
            harness_core::db::AiSplitGroup::Project,
            since.as_deref(),
            until.as_deref(),
        )?;
        Ok(json!({
            "hours": hours,
            "aiByDay": by_day,
            "aiByProject": by_project,
        }))
    })
    .await
}

async fn productivity_insights(
    State(s): State<AppState>,
    Query(q): Query<RangeParams>,
) -> ApiResult {
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let tz = q.tz_offset_min();
    let grain = Grain::parse(q.grain.as_deref());
    read_json(&s, move |db, _| {
        db.productivity_insights(grain, tz, since.as_deref(), until.as_deref())
    })
    .await
}

async fn empty_array() -> Json<Value> {
    Json(json!([]))
}

async fn skills(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!([])));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, _| {
        db.skill_breakdown_for_providers(since.as_deref(), until.as_deref(), &providers)
    })
    .await
}

async fn subagents(State(s): State<AppState>, Query(q): Query<RangeParams>) -> ApiResult {
    if q.providers_none() {
        return Ok(Json(json!({
            "by_kind": [],
            "by_entrypoint": [],
            "breakdown": [],
            "top_sessions": [],
            "sdk_runs": [],
            "dispatch_tree": [],
        })));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, pr| {
        let by_kind =
            db.subagents_by_kind_for_providers(pr, since.as_deref(), until.as_deref(), &providers)?;
        let by_entrypoint = db.subagents_by_entrypoint_for_providers(
            pr,
            since.as_deref(),
            until.as_deref(),
            &providers,
        )?;
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
    if q.providers_none() {
        return Ok(Json(json!([])));
    }
    let since = q.since().map(str::to_owned);
    let until = q.until().map(str::to_owned);
    let providers = q.providers();
    read_json(&s, move |db, _| {
        db.workspaces_for_providers(since.as_deref(), until.as_deref(), &providers)
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

#[derive(Clone)]
struct ProviderSourceConfig {
    key: &'static str,
    label: &'static str,
    default_path: Option<PathBuf>,
    env_var: Option<&'static str>,
    setup_hint: Option<&'static str>,
    usage: &'static str,
    costs: &'static str,
    tools: bool,
    prompts: bool,
}

fn provider_default_path(provider: ProviderId, claude_root: &std::path::Path) -> PathBuf {
    match provider {
        ProviderId::Claude => claude_root.to_path_buf(),
        ProviderId::Codex => harness_core::paths::codex_sessions_dir(),
        ProviderId::Gemini => harness_core::paths::gemini_chats_dir(),
        ProviderId::Cursor => harness_core::paths::cursor_state_db(),
        ProviderId::Antigravity => harness_core::paths::antigravity_transcripts_dir(),
        ProviderId::Copilot => harness_core::paths::copilot_home_dir(),
        ProviderId::Opencode => harness_core::paths::opencode_data_dir(),
    }
}

fn provider_sources(
    provider: ProviderId,
    claude_root: &std::path::Path,
) -> Vec<ProviderSourceConfig> {
    match provider {
        ProviderId::Claude => vec![ProviderSourceConfig {
            key: "claude-projects",
            label: "Claude projects JSONL",
            default_path: Some(provider_default_path(provider, claude_root)),
            env_var: Some("CLAUDE_PROJECTS_DIR"),
            setup_hint: None,
            usage: "exact",
            costs: "estimated",
            tools: true,
            prompts: true,
        }],
        ProviderId::Codex => vec![ProviderSourceConfig {
            key: "codex-sessions",
            label: "Codex sessions JSONL",
            default_path: Some(provider_default_path(provider, claude_root)),
            env_var: Some("CODEX_SESSIONS_DIR"),
            setup_hint: None,
            usage: "exact",
            costs: "estimated",
            tools: true,
            prompts: true,
        }],
        ProviderId::Gemini => vec![ProviderSourceConfig {
            key: "gemini-chats",
            label: "Gemini chats JSONL",
            default_path: Some(provider_default_path(provider, claude_root)),
            env_var: Some("GEMINI_CHATS_DIR"),
            setup_hint: None,
            usage: "exact",
            costs: "estimated",
            tools: true,
            prompts: true,
        }],
        ProviderId::Cursor => vec![ProviderSourceConfig {
            key: "cursor-state",
            label: "Cursor state database",
            default_path: Some(provider_default_path(provider, claude_root)),
            env_var: Some("CURSOR_STATE_DB"),
            setup_hint: None,
            usage: "reported",
            costs: "reported",
            tools: true,
            prompts: true,
        }],
        ProviderId::Antigravity => vec![ProviderSourceConfig {
            key: "antigravity-transcripts",
            label: "Antigravity transcripts",
            default_path: Some(provider_default_path(provider, claude_root)),
            env_var: Some("ANTIGRAVITY_TRANSCRIPTS_DIR"),
            setup_hint: None,
            usage: "missing",
            costs: "missing",
            tools: true,
            prompts: false,
        }],
        ProviderId::Copilot => vec![
            ProviderSourceConfig {
                key: "copilot-chat-otel",
                label: "Copilot Chat OTel database",
                default_path: harness_core::paths::copilot_otel_db().or_else(|| {
                    harness_core::paths::copilot_otel_candidates()
                        .into_iter()
                        .next()
                }),
                env_var: Some("COPILOT_OTEL_DB"),
                setup_hint: Some(
                    "Enable github.copilot.chat.otel.dbSpanExporter.enabled in VS Code/Cursor.",
                ),
                usage: "reported",
                costs: "missing",
                tools: true,
                prompts: true,
            },
            ProviderSourceConfig {
                key: "copilot-cli",
                label: "Copilot CLI session state",
                default_path: Some(harness_core::paths::copilot_home_dir()),
                env_var: Some("COPILOT_HOME"),
                setup_hint: Some(
                    "Install/use GitHub Copilot CLI so local session-state files exist.",
                ),
                usage: "reported",
                costs: "missing",
                tools: true,
                prompts: true,
            },
        ],
        ProviderId::Opencode => vec![
            ProviderSourceConfig {
                key: "opencode-storage",
                label: "opencode storage",
                default_path: Some(harness_core::paths::opencode_data_dir()),
                env_var: Some("OPENCODE_DATA_DIR"),
                setup_hint: Some("Run opencode locally so project/global storage exists."),
                usage: "reported",
                costs: "reported",
                tools: true,
                prompts: true,
            },
            ProviderSourceConfig {
                key: "opencode-run-logs",
                label: "opencode JSONL run logs",
                default_path: harness_core::paths::opencode_run_logs_dir(),
                env_var: Some("OPENCODE_RUN_LOGS_DIR"),
                setup_hint: Some(
                    "Set OPENCODE_RUN_LOGS_DIR to a directory containing JSONL run logs.",
                ),
                usage: "reported",
                costs: "reported",
                tools: true,
                prompts: true,
            },
        ],
    }
}

fn observed_usage_label(stats: Option<&harness_core::db::ProviderObservedStats>) -> &'static str {
    match stats {
        Some(s) if s.usage_exact => "exact",
        Some(s) if s.usage_reported => "reported",
        _ => "missing",
    }
}

fn observed_cost_label(stats: Option<&harness_core::db::ProviderObservedStats>) -> &'static str {
    match stats {
        Some(s) if s.cost_reported => "reported",
        Some(s) if s.cost_estimated => "estimated",
        _ => "missing",
    }
}

fn supported_usage_label(sources: &[ProviderSourceConfig]) -> &'static str {
    if sources.iter().any(|s| s.usage == "exact") {
        "exact"
    } else if sources.iter().any(|s| s.usage == "reported") {
        "reported"
    } else {
        "missing"
    }
}

fn supported_cost_label(sources: &[ProviderSourceConfig]) -> &'static str {
    if sources.iter().any(|s| s.costs == "estimated") {
        "estimated"
    } else if sources.iter().any(|s| s.costs == "reported") {
        "reported"
    } else {
        "missing"
    }
}

async fn get_settings(State(s): State<AppState>) -> ApiResult {
    let claude = harness_core::paths::claude_dir().display().to_string();
    let projects = s.projects_dir.display().to_string();
    let overridden = std::env::var("CLAUDE_PROJECTS_DIR").is_ok();
    let claude_root = (*s.projects_dir).clone();
    read_json(&s, move |db, _| {
        let mut providers = Vec::new();
        let observed = db.provider_observed_stats()?;
        for provider in ProviderId::ALL {
            let default_path = provider_default_path(provider, &claude_root);
            let legacy_path_key = format!("provider.{}.path", provider.as_str());
            let configured_path = db.get_setting(&legacy_path_key)?;
            let active_path =
                harness_core::provider_adapters::provider_path(db, provider, &claude_root)?;
            let stats = observed.get(provider.as_str());
            let source_defs = provider_sources(provider, &claude_root);
            let supported = json!({
                "usage": supported_usage_label(&source_defs),
                "tokens": source_defs.iter().any(|s| s.usage != "missing"),
                "cost": supported_cost_label(&source_defs),
                "costs": source_defs.iter().any(|s| s.costs != "missing"),
                "tools": source_defs.iter().any(|s| s.tools),
                "prompts": source_defs.iter().any(|s| s.prompts),
            });
            let observed_caps = json!({
                "usage": observed_usage_label(stats),
                "tokens": stats.is_some_and(|s| s.usage_exact || s.usage_reported),
                "cost": observed_cost_label(stats),
                "costs": stats.is_some_and(|s| s.cost_estimated || s.cost_reported),
                "tools": stats.is_some_and(|s| s.tools > 0),
                "prompts": stats.is_some_and(|s| s.prompts > 0),
            });
            let single_source = source_defs.len() == 1;
            let mut source_values = Vec::new();
            let mut any_source_discovered = false;
            for source in &source_defs {
                let source_path_key =
                    format!("provider.{}.source.{}.path", provider.as_str(), source.key);
                let source_enabled = harness_core::provider_adapters::provider_source_enabled(
                    db, provider, source.key,
                )?;
                let source_configured_path = db.get_setting(&source_path_key)?;
                let active_source_path = if single_source && source_configured_path.is_none() {
                    Some(active_path.clone())
                } else {
                    harness_core::provider_adapters::provider_source_path(
                        db,
                        provider,
                        source.key,
                        source.default_path.clone(),
                    )?
                };
                let discovered = active_source_path.as_ref().is_some_and(|p| p.exists());
                any_source_discovered |= discovered;
                source_values.push(json!({
                    "key": source.key,
                    "label": source.label,
                    "enabled": source_enabled,
                    "env_var": source.env_var,
                    "default_path": source.default_path.as_ref().map(|p| p.display().to_string()),
                    "configured_path": source_configured_path.or_else(|| {
                        if single_source {
                            configured_path.clone()
                        } else {
                            None
                        }
                    }),
                    "active_path": active_source_path.as_ref().map(|p| p.display().to_string()),
                    "discovered": discovered,
                    "setup_hint": source.setup_hint,
                    "capabilities": {
                        "usage": source.usage,
                        "tokens": source.usage != "missing",
                        "cost": source.costs,
                        "costs": source.costs != "missing",
                        "tools": source.tools,
                        "prompts": source.prompts,
                    },
                    "supported": {
                        "usage": source.usage,
                        "tokens": source.usage != "missing",
                        "cost": source.costs,
                        "costs": source.costs != "missing",
                        "tools": source.tools,
                        "prompts": source.prompts,
                    },
                    "observed": observed_caps.clone(),
                }));
            }
            let has_observed = stats.is_some_and(|s| s.messages > 0 || s.tools > 0);
            providers.push(json!({
                "id": provider.as_str(),
                "label": provider.label(),
                "enabled": harness_core::provider_adapters::provider_enabled(db, provider)?,
                "default_path": default_path.display().to_string(),
                "configured_path": configured_path,
                "active_path": active_path.display().to_string(),
                "discovered": any_source_discovered || has_observed,
                "capabilities": observed_caps.clone(),
                "supported": supported,
                "observed": observed_caps,
                "last_scan_counts": {
                    "sessions": stats.map(|s| s.sessions).unwrap_or(0),
                    "messages": stats.map(|s| s.messages).unwrap_or(0),
                    "tools": stats.map(|s| s.tools).unwrap_or(0),
                    "prompts": stats.map(|s| s.prompts).unwrap_or(0),
                },
                "sources": source_values,
            }));
        }
        Ok(json!({
            "claude_dir": claude.clone(),
            "projects_dir": projects,
            "projects_overridden": overridden,
            "claude_dirs": [claude],
            "plan": db.get_plan()?,
            "providers": providers,
            "onboarding_done": db.get_setting("onboarding_done")?.as_deref() == Some("true"),
            "onboarding_step": db
                .get_setting("onboarding_step")?
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0),
        }))
    })
    .await
}

#[derive(Deserialize)]
struct SettingsBody {
    plan: Option<String>,
    providers: Option<Vec<ProviderSettingsBody>>,
    onboarding_done: Option<bool>,
    onboarding_step: Option<i64>,
}

#[derive(Deserialize)]
struct ProviderSettingsBody {
    id: String,
    enabled: Option<bool>,
    path: Option<String>,
    sources: Option<Vec<ProviderSourceSettingsBody>>,
}

#[derive(Deserialize)]
struct ProviderSourceSettingsBody {
    key: String,
    enabled: Option<bool>,
    path: Option<String>,
}
async fn post_settings(State(s): State<AppState>, Json(b): Json<SettingsBody>) -> ApiResult {
    if let Some(plan) = b.plan {
        s.db.set_plan(&plan)?;
    }
    if let Some(providers) = b.providers {
        for provider in providers {
            let Ok(id) = provider.id.parse::<ProviderId>() else {
                continue;
            };
            if let Some(enabled) = provider.enabled {
                s.db.set_setting(
                    &format!("provider.{}.enabled", id.as_str()),
                    if enabled { "true" } else { "false" },
                )?;
            }
            if let Some(path) = provider.path {
                let key = format!("provider.{}.path", id.as_str());
                if path.trim().is_empty() {
                    s.db.delete_setting(&key)?;
                } else {
                    s.db.set_setting(&key, path.trim())?;
                }
            }
            if let Some(sources) = provider.sources {
                for source in sources {
                    if let Some(enabled) = source.enabled {
                        s.db.set_setting(
                            &format!("provider.{}.source.{}.enabled", id.as_str(), source.key),
                            if enabled { "true" } else { "false" },
                        )?;
                    }
                    if let Some(path) = source.path {
                        let key = format!("provider.{}.source.{}.path", id.as_str(), source.key);
                        if path.trim().is_empty() {
                            s.db.delete_setting(&key)?;
                        } else {
                            s.db.set_setting(&key, path.trim())?;
                        }
                    }
                }
            }
        }
    }
    if let Some(done) = b.onboarding_done {
        s.db.set_setting("onboarding_done", if done { "true" } else { "false" })?;
    }
    if let Some(step) = b.onboarding_step {
        s.db.set_setting("onboarding_step", &step.max(0).to_string())?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn scan_blocking(State(s): State<AppState>) -> ApiResult {
    let n = scan_now(&s).await;
    Ok(Json(json!({
        "files": n.files,
        "messages": n.messages,
        "tools": n.tools,
        "repos": n.repos,
        "commits": n.commits,
    })))
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
