//! `harness-dashboard` — local-first Claude Code usage dashboard server.
//!
//! axum HTTP server over `harness-core`: the `/api/*` JSON surface, an SSE scan
//! stream, a periodic background scan, and (in release) the embedded frontend.

mod api;
#[cfg(feature = "release-embed")]
mod static_assets;

use clap::Parser;
use harness_core::db::Db;
use harness_core::paths;
use harness_core::pricing::Pricing;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

/// Shared, cheaply-cloneable application state.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub pricing: Arc<Pricing>,
    pub projects_dir: Arc<PathBuf>,
    pub tx: broadcast::Sender<api::ScanEvent>,
    pub scanning: Arc<AtomicBool>,
    pub dev: bool,
}

#[derive(Parser, Debug)]
#[command(
    name = "harness-dashboard",
    version,
    about = "Local-first Claude Code usage dashboard"
)]
struct Cli {
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = Cli::parse();

    let host = cli
        .host
        .or_else(|| std::env::var("HOST").ok())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let port = cli
        .port
        .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
        .unwrap_or(8080);
    let db_path = cli.db.unwrap_or_else(paths::db_path);
    let projects_dir = cli.projects_dir.unwrap_or_else(paths::projects_dir);

    let db = Arc::new(Db::open(&db_path)?);
    let pricing = Arc::new(Pricing::load_default());
    let (tx, _rx) = broadcast::channel(64);

    let state = AppState {
        db,
        pricing,
        projects_dir: Arc::new(projects_dir.clone()),
        tx,
        scanning: Arc::new(AtomicBool::new(false)),
        dev: cli.dev,
    };

    tracing::info!("database: {}", db_path.display());
    tracing::info!("projects: {}", projects_dir.display());

    if !cli.no_scan {
        tracing::info!("initial scan…");
        let n = api::scan_now(&state).await;
        tracing::info!(
            "scanned {} files, {} messages, {} tools",
            n.files,
            n.messages,
            n.tools
        );
    }

    // Periodic background scan.
    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(60));
            ticker.tick().await; // consume the immediate first tick
            loop {
                ticker.tick().await;
                api::scan_now(&state).await;
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

    axum::serve(listener, app).await?;
    Ok(())
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
