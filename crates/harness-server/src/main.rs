//! `harness-dashboard` — local-first AI coding analytics dashboard server.
//!
//! axum HTTP server over `harness-core`: the `/api/*` JSON surface, an SSE scan
//! stream, a periodic background scan, and (in release) the embedded frontend.

mod api;
mod auth;
mod calendar;
mod github;
#[cfg(feature = "release-embed")]
mod static_assets;

use clap::{Parser, Subcommand};
use harness_core::db::Db;
use harness_core::paths;
use harness_core::pricing::Pricing;
use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

/// Shared, cheaply-cloneable application state.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    /// Path to the SQLite file — lets handlers open extra read-only connections
    /// for concurrent queries (the overview bundle fans out across them).
    pub db_path: Arc<PathBuf>,
    pub pricing: Arc<Pricing>,
    pub projects_dir: Arc<PathBuf>,
    pub tx: broadcast::Sender<api::ScanEvent>,
    pub scanning: Arc<AtomicBool>,
    pub dev: bool,
    /// Bound port — used to build the Google OAuth loopback redirect URI.
    pub port: u16,
    /// Guards against overlapping GitHub syncs (on-demand + periodic).
    pub github_syncing: Arc<AtomicBool>,
    /// Latest GitHub-sync progress snapshot (for the `/status` poll).
    pub github_progress: Arc<Mutex<Option<github::GithubProgress>>>,
    /// Completed local PR AI insight runs, keyed by generated job id.
    pub pr_ai_jobs: Arc<Mutex<HashMap<String, api::PrAiInsightJob>>>,
    /// Local API-key auth used by the browser and CLI callers.
    pub api_auth: Arc<auth::ApiAuth>,
}

#[derive(Parser, Debug)]
#[command(
    name = "harness-dashboard",
    version,
    about = "Local-first AI coding analytics dashboard"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<CliCommand>,
    /// Port to bind (env PORT, default 8080).
    #[arg(long)]
    port: Option<u16>,
    /// Host/address to bind (env HOST, default 127.0.0.1).
    #[arg(long)]
    host: Option<String>,
    /// SQLite database path (env HARNESS_DB / TOKEN_DASHBOARD_DB).
    #[arg(long)]
    db: Option<PathBuf>,
    /// Transcript root to scan (env CLAUDE_PROJECTS_DIR).
    #[arg(long = "projects-dir")]
    projects_dir: Option<PathBuf>,
    /// Dev mode: enable permissive CORS for the Next.js dev server; don't open a browser.
    #[arg(long)]
    dev: bool,
    /// Don't open a browser on start.
    #[arg(long = "no-open")]
    no_open: bool,
    /// Skip the initial scan on start.
    #[arg(long = "no-scan")]
    no_scan: bool,
}

#[derive(Subcommand, Debug)]
enum CliCommand {
    /// Capture a Claude Code Status Line payload into the local dashboard database.
    StatuslineSnapshot,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = Cli::parse();

    if matches!(cli.command, Some(CliCommand::StatuslineSnapshot)) {
        return statusline_snapshot(cli.db.unwrap_or_else(paths::db_path));
    }

    let host = cli
        .host
        .or_else(|| std::env::var("HOST").ok())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    validate_bind_host(&host)?;
    let port = cli
        .port
        .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
        .unwrap_or(8080);
    let db_path = cli.db.unwrap_or_else(paths::db_path);
    let projects_dir = cli.projects_dir.unwrap_or_else(paths::projects_dir);

    let db = Arc::new(Db::open(&db_path)?);
    let api_auth = Arc::new(auth::load_or_create(&db)?);
    let pricing = Arc::new(Pricing::load_default());
    let (tx, _rx) = broadcast::channel(64);

    let state = AppState {
        db,
        db_path: Arc::new(db_path.clone()),
        pricing,
        projects_dir: Arc::new(projects_dir.clone()),
        tx,
        scanning: Arc::new(AtomicBool::new(false)),
        dev: cli.dev,
        port,
        github_syncing: Arc::new(AtomicBool::new(false)),
        github_progress: Arc::new(Mutex::new(None)),
        pr_ai_jobs: Arc::new(Mutex::new(HashMap::new())),
        api_auth,
    };

    tracing::info!("database: {}", db_path.display());
    tracing::info!("projects: {}", projects_dir.display());

    // Onboarding is the sole entry point: until it's completed, nothing scans on its
    // own — the user starts (and configures) the initial seed + backfill from the
    // onboarding wizard. Every loop below re-reads this each tick, so finishing
    // onboarding starts background scanning without a restart.
    if !cli.no_scan {
        let state = state.clone();
        tokio::spawn(async move {
            if !onboarding_done(&state.db) {
                tracing::info!("onboarding not complete — initial scan deferred to the wizard");
                return;
            }
            tracing::info!("initial scan…");
            let n = api::scan_now(&state).await;
            tracing::info!(
                "initial scan complete: {} files, {} messages, {} tools",
                n.files,
                n.messages,
                n.tools
            );
        });
    }

    // Periodic background scan — a fallback in case the watcher misses an event.
    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(60));
            ticker.tick().await; // consume the immediate first tick
            loop {
                ticker.tick().await;
                if onboarding_done(&state.db) {
                    api::scan_now(&state).await;
                }
            }
        });
    }

    // Periodic GitHub auto-sync — opt-in + interval are live-read from settings each
    // tick, so toggling them takes effect without a restart. Cheap thanks to ETag +
    // incremental high-water marks.
    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(60));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                if onboarding_done(&state.db) {
                    api::maybe_autosync_github(&state).await;
                }
            }
        });
    }

    // Real-time: watch the transcript dir and rescan on change (debounced), so new
    // Claude activity shows up in ~1s instead of waiting for the 60s poll. The scan
    // broadcasts an SSE event, which the UI uses to refetch.
    if !cli.no_scan {
        let state = state.clone();
        let watch_dir = projects_dir.clone();
        let handle = tokio::runtime::Handle::current();
        std::thread::spawn(move || {
            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher = match notify::recommended_watcher(move |res| {
                let _ = tx.send(res);
            }) {
                Ok(w) => w,
                Err(e) => {
                    tracing::warn!("file watcher unavailable: {e}");
                    return;
                }
            };
            if let Err(e) = watcher.watch(&watch_dir, RecursiveMode::Recursive) {
                tracing::warn!("watch failed for {}: {e}", watch_dir.display());
                return;
            }
            tracing::info!("watching {} for changes", watch_dir.display());
            // Coalesce bursts: take the first event, then drain ~800ms of quiet
            // before triggering a single scan.
            while rx.recv().is_ok() {
                while rx.recv_timeout(Duration::from_millis(800)).is_ok() {}
                if !onboarding_done(&state.db) {
                    continue; // dormant until onboarding completes
                }
                let state = state.clone();
                handle.spawn(async move {
                    api::scan_now(&state).await;
                });
            }
        });
    }

    let app = api::router(state);
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let url = format!("http://{addr}");
    tracing::info!(
        "harness-dashboard {} listening on {url}",
        harness_core::VERSION
    );

    if !cli.no_open && !cli.dev {
        open_browser(&url);
    }

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

fn statusline_snapshot(db_path: PathBuf) -> anyhow::Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload: serde_json::Value = serde_json::from_str(&input)?;
    let db = Db::open(&db_path)?;
    db.save_claude_statusline_snapshot(&payload)?;

    let ctx = payload
        .pointer("/context_window/used_percentage")
        .and_then(serde_json::Value::as_f64)
        .map(|pct| format!("ctx {:.0}%", pct));
    let five_hour = payload
        .pointer("/rate_limits/five_hour/used_percentage")
        .and_then(serde_json::Value::as_f64)
        .map(|pct| format!("5h {:.0}%", pct));
    let seven_day = payload
        .pointer("/rate_limits/seven_day/used_percentage")
        .and_then(serde_json::Value::as_f64)
        .map(|pct| format!("7d {:.0}%", pct));
    let parts = [ctx, five_hour, seven_day]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    if !parts.is_empty() {
        println!("Harness {}", parts.join(" / "));
    }
    Ok(())
}

fn validate_bind_host(host: &str) -> anyhow::Result<()> {
    if host.is_empty()
        || host.len() > 255
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
    {
        anyhow::bail!("invalid host");
    }
    Ok(())
}

/// Whether the first-run onboarding wizard has been completed. Background scanning
/// stays dormant until then (onboarding is the sole entry point).
fn onboarding_done(db: &Db) -> bool {
    matches!(
        db.get_setting("onboarding_done").ok().flatten().as_deref(),
        Some("true")
    )
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_host_rejects_shell_metacharacters() {
        assert!(validate_bind_host("127.0.0.1").is_ok());
        assert!(validate_bind_host("localhost").is_ok());
        assert!(validate_bind_host("0.0.0.0").is_ok());
        assert!(validate_bind_host("[::1]").is_ok());
        assert!(validate_bind_host("127.0.0.1 & calc").is_err());
        assert!(validate_bind_host("localhost;touch").is_err());
    }
}
