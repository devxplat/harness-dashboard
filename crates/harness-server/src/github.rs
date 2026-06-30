//! Opt-in GitHub enrichment: validate the token, then for every *enabled* locally
//! discovered GitHub repo fetch pull requests, releases, and Actions runs and persist
//! them via `harness-core`.
//!
//! The network + progress live here; all parsing, rate-limit/ETag/pagination
//! decisions, and correlation are pure helpers in `harness_core::github` + the DB
//! layer. The loop is incremental (per-repo ETag + high-water marks) so steady-state
//! syncs cost ~1 request per repo/resource, and it stops gracefully near the rate
//! limit. Backfill depth is user-controlled; first connect defaults to 90 days.

use crate::api::ScanEvent;
use harness_core::db::Db;
use harness_core::github::{self, BackfillWindow, PrScope, RateLimit};
use harness_core::model::{PullRequestEventRow, PullRequestRow};
use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

const API: &str = "https://api.github.com";
/// PR-overlap grace window, matching the commit-side default in core.
const GRACE_MINUTES: i64 = 30;
/// Stop a backfill when remaining requests drop to/below this, leaving budget for
/// other tooling; the next sync resumes from the stored high-water mark.
const RATE_FLOOR: i64 = 50;
/// Safety cap on backfill pages per repo/resource (one page = 100 items).
const MAX_PAGES: usize = 20;

#[derive(Debug, Default, Clone, Copy, Serialize)]
pub struct GithubSyncStats {
    pub repos: usize,
    pub pull_requests: usize,
    pub deployments: usize,
    pub incidents: usize,
}

/// Live progress snapshot, pushed over SSE and pollable via `/status`.
#[derive(Debug, Default, Clone, Serialize)]
pub struct GithubProgress {
    pub running: bool,
    pub repo_index: usize,
    pub repo_total: usize,
    pub current_repo: Option<String>,
    pub pull_requests: usize,
    pub deployments: usize,
    pub incidents: usize,
    pub rate_remaining: Option<i64>,
    pub rate_limit: Option<i64>,
    pub rate_reset_utc: Option<String>,
    pub last_error: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RateView {
    pub remaining: Option<i64>,
    pub limit: Option<i64>,
    pub reset_utc: Option<String>,
}

impl From<&RateLimit> for RateView {
    fn from(r: &RateLimit) -> Self {
        RateView {
            remaining: r.remaining,
            limit: r.limit,
            reset_utc: r.reset_utc.clone(),
        }
    }
}

/// Result of validating a token against `GET /user`.
#[derive(Debug, Clone, Serialize)]
pub struct TokenInfo {
    pub login: Option<String>,
    pub scopes: Vec<String>,
    pub has_repo_scope: bool,
    pub rate: RateView,
}

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn header_pairs(h: &reqwest::header::HeaderMap) -> Vec<(String, String)> {
    h.iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|vs| (k.as_str().to_string(), vs.to_string()))
        })
        .collect()
}

struct Fetched {
    status: u16,
    body: Option<Value>,
    etag: Option<String>,
    link: Option<String>,
    rate: RateLimit,
}

/// A single conditional GET. `304` returns no body (free against the rate budget).
async fn get(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    etag: Option<&str>,
) -> anyhow::Result<Fetched> {
    let mut req = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "harness-dashboard")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(e) = etag {
        req = req.header("If-None-Match", e);
    }
    let resp = req.send().await?;
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    let etag = headers
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let link = headers
        .get("link")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let rate = github::parse_rate_limit(&header_pairs(&headers));
    let body = if (200..300).contains(&status) {
        Some(resp.json().await?)
    } else {
        None
    };
    Ok(Fetched {
        status,
        body,
        etag,
        link,
        rate,
    })
}

/// Validate a PAT: `GET /user`. 401 → error; otherwise return login + scopes + budget.
pub async fn validate_token(token: &str) -> anyhow::Result<TokenInfo> {
    let client = reqwest::Client::new();
    let f = get(&client, &format!("{API}/user"), token, None).await?;
    if f.status == 401 {
        anyhow::bail!("invalid or expired GitHub token");
    }
    if !(200..300).contains(&f.status) {
        anyhow::bail!("GitHub /user returned {}", f.status);
    }
    // X-OAuth-Scopes is only sent on the /user response (re-fetch headers via a
    // dedicated call would be wasteful); parse from the body's absence — instead we
    // capture it here from a second lightweight header read.
    let login = f
        .body
        .as_ref()
        .and_then(|b| b.get("login"))
        .and_then(Value::as_str)
        .map(str::to_string);
    // Scopes come from the response header; re-issue is avoided by reading via a
    // HEAD-like call is unnecessary — we already have them from `get` if present.
    // (get() doesn't surface arbitrary headers, so do one scope read.)
    let scopes = fetch_scopes(&client, token).await;
    Ok(TokenInfo {
        has_repo_scope: github::has_repo_scope(&scopes),
        login,
        scopes,
        rate: RateView::from(&f.rate),
    })
}

/// Read `X-OAuth-Scopes` from a `GET /user` response (classic PATs only; fine-grained
/// tokens omit it, yielding an empty list).
async fn fetch_scopes(client: &reqwest::Client, token: &str) -> Vec<String> {
    let resp = client
        .get(format!("{API}/user"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "harness-dashboard")
        .send()
        .await;
    match resp {
        Ok(r) => github::parse_oauth_scopes(
            r.headers()
                .get("x-oauth-scopes")
                .and_then(|v| v.to_str().ok()),
        ),
        Err(_) => Vec::new(),
    }
}

/// Max of the listed timestamp fields present on a raw item.
fn item_time(v: &Value, keys: &[&str]) -> Option<String> {
    let mut best: Option<String> = None;
    for k in keys {
        if let Some(s) = v.get(*k).and_then(Value::as_str) {
            if best.as_deref().map(|b| s > b).unwrap_or(true) {
                best = Some(s.to_string());
            }
        }
    }
    best
}

struct ResourceResult {
    items: Vec<Value>,
    etag: Option<String>,
    not_modified: bool,
    rate: RateLimit,
}

/// Fetch one resource (conditionally, paginating only when backfilling and bounded by
/// `since` + the rate floor). `array_path` is `Some("workflow_runs")` for runs.
#[allow(clippy::too_many_arguments)]
async fn fetch_resource(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    prev_etag: Option<&str>,
    backfilling: bool,
    since: Option<&str>,
    time_keys: &[&str],
    array_path: Option<&str>,
) -> anyhow::Result<ResourceResult> {
    let mut items = Vec::new();
    let mut url = base_url.to_string();
    let mut etag_out: Option<String> = None;
    // Overwritten on the first iteration (the loop always runs once); the default is
    // just a placeholder so the value is in scope for the post-loop return.
    #[allow(unused_assignments)]
    let mut rate = RateLimit::default();
    let mut page = 0usize;
    loop {
        let etag_for = if page == 0 { prev_etag } else { None };
        let f = get(client, &url, token, etag_for).await?;
        rate = f.rate.clone();
        if f.status == 304 {
            return Ok(ResourceResult {
                items,
                etag: prev_etag.map(str::to_string),
                not_modified: true,
                rate,
            });
        }
        if (f.status == 403 || f.status == 429) && github::should_stop(&rate, RATE_FLOOR) {
            return Ok(ResourceResult {
                items,
                etag: etag_out,
                not_modified: false,
                rate,
            });
        }
        if !(200..300).contains(&f.status) {
            anyhow::bail!("status {}", f.status);
        }
        if page == 0 {
            etag_out = f.etag.clone();
        }
        let page_items: Vec<Value> = match array_path {
            None => f
                .body
                .as_ref()
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            Some(p) => f
                .body
                .as_ref()
                .and_then(|b| b.get(p))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        };
        let crossed = match since {
            Some(cut) => page_items.iter().any(|it| {
                item_time(it, time_keys)
                    .map(|t| t.as_str() < cut)
                    .unwrap_or(false)
            }),
            None => false,
        };
        let empty = page_items.is_empty();
        items.extend(page_items);
        page += 1;
        if !backfilling
            || empty
            || page >= MAX_PAGES
            || crossed
            || github::should_stop(&rate, RATE_FLOOR)
        {
            break;
        }
        match github::parse_link_next(f.link.as_deref()) {
            Some(next) => url = next,
            None => break,
        }
    }
    Ok(ResourceResult {
        items,
        etag: etag_out,
        not_modified: false,
        rate,
    })
}

fn merge_pr_detail(pr: &mut PullRequestRow, detail: PullRequestRow) {
    pr.title = detail.title.or(pr.title.take());
    pr.state = detail.state.or(pr.state.take());
    pr.author = detail.author.or(pr.author.take());
    pr.created_at_utc = detail.created_at_utc.or(pr.created_at_utc.take());
    pr.merged_at_utc = detail.merged_at_utc.or(pr.merged_at_utc.take());
    pr.closed_at_utc = detail.closed_at_utc.or(pr.closed_at_utc.take());
    pr.head_branch = detail.head_branch.or(pr.head_branch.take());
    pr.base_branch = detail.base_branch.or(pr.base_branch.take());
    pr.additions = detail.additions;
    pr.deletions = detail.deletions;
    pr.changed_files = detail.changed_files;
    pr.merge_commit_sha = detail.merge_commit_sha.or(pr.merge_commit_sha.take());
    pr.head_sha = detail.head_sha.or(pr.head_sha.take());
    pr.html_url = detail.html_url.or(pr.html_url.take());
}

async fn enrich_pull_requests(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    token: &str,
    mut prs: Vec<PullRequestRow>,
) -> (
    Vec<PullRequestRow>,
    Vec<PullRequestEventRow>,
    Vec<harness_core::model::PullRequestFileRow>,
    RateLimit,
) {
    let mut events = Vec::new();
    let mut files = Vec::new();
    let mut last_rate = RateLimit::default();
    for pr in &mut prs {
        if github::should_stop(&last_rate, RATE_FLOOR) {
            break;
        }
        let number = pr.number;
        if let Ok(detail) = get(
            client,
            &format!("{API}/repos/{owner}/{repo}/pulls/{number}"),
            token,
            None,
        )
        .await
        {
            last_rate = detail.rate.clone();
            if let Some(body) = detail.body.as_ref() {
                if let Some(parsed) = github::parse_pull_request(body) {
                    merge_pr_detail(pr, parsed);
                }
            }
        }

        if let Ok(reviews) = fetch_resource(
            client,
            &format!("{API}/repos/{owner}/{repo}/pulls/{number}/reviews?per_page=100"),
            token,
            None,
            false,
            None,
            &["submitted_at"],
            None,
        )
        .await
        {
            last_rate = reviews.rate.clone();
            let mut first_review: Option<String> = pr.first_review_at_utc.clone();
            let mut review_count = 0;
            for item in reviews.items {
                if let Some(event) = github::parse_review_event(&item, number) {
                    if let Some(at) = event.created_at_utc.as_ref() {
                        if first_review
                            .as_deref()
                            .map(|v| at.as_str() < v)
                            .unwrap_or(true)
                        {
                            first_review = Some(at.clone());
                        }
                    }
                    review_count += 1;
                    events.push(event);
                }
            }
            if review_count > 0 {
                pr.review_count = review_count;
                pr.first_review_at_utc = first_review;
            }
        }

        if let Ok(changed_files) = fetch_resource(
            client,
            &format!("{API}/repos/{owner}/{repo}/pulls/{number}/files?per_page=100"),
            token,
            None,
            false,
            None,
            &[],
            None,
        )
        .await
        {
            last_rate = changed_files.rate.clone();
            files.extend(
                changed_files
                    .items
                    .iter()
                    .filter_map(|item| github::parse_pull_request_file(item, number)),
            );
        }

        if let Ok(comments) = fetch_resource(
            client,
            &format!("{API}/repos/{owner}/{repo}/issues/{number}/comments?per_page=100"),
            token,
            None,
            false,
            None,
            &["created_at"],
            None,
        )
        .await
        {
            last_rate = comments.rate.clone();
            events.extend(
                comments
                    .items
                    .iter()
                    .filter_map(|item| github::parse_issue_comment_event(item, number)),
            );
        }

        if let Some(head_sha) = pr.head_sha.as_deref() {
            if let Ok(checks) = fetch_resource(
                client,
                &format!("{API}/repos/{owner}/{repo}/commits/{head_sha}/check-runs?per_page=100"),
                token,
                None,
                false,
                None,
                &["completed_at", "started_at", "created_at"],
                Some("check_runs"),
            )
            .await
            {
                last_rate = checks.rate.clone();
                events.extend(
                    checks
                        .items
                        .iter()
                        .filter_map(|item| github::parse_check_run_event(item, number)),
                );
            }
        }
    }
    (prs, events, files, last_rate)
}

/// The repo's transcript slugs (for PR↔session correlation).
fn slugs_of(repo: &harness_core::db::GithubRepo) -> Vec<String> {
    repo.slugs_json
        .as_deref()
        .and_then(|j| serde_json::from_str::<Vec<String>>(j).ok())
        .or_else(|| repo.primary_slug.clone().map(|s| vec![s]))
        .unwrap_or_default()
}

#[allow(clippy::too_many_arguments)]
async fn sync_one(
    client: &reqwest::Client,
    db: &Db,
    repo: &harness_core::db::GithubRepo,
    token: &str,
    backfill_forced: bool,
    since: Option<&str>,
    pr_scope: PrScope,
    login: Option<&str>,
) -> anyhow::Result<(usize, usize, usize, RateLimit)> {
    let (o, r) = (repo.owner.as_str(), repo.repo.as_str());
    let key = repo.repo_key.as_str();

    // --- pull requests (incremental high-water + ETag) ---
    let st = db.get_sync_state(key, "pulls")?;
    let prev_etag = st.as_ref().and_then(|s| s.etag.clone());
    let prev_hw = st.as_ref().and_then(|s| s.high_water_utc.clone());
    let backfilling = prev_hw.is_none() || backfill_forced;
    let res = fetch_resource(
        client,
        &format!("{API}/repos/{o}/{r}/pulls?state=all&per_page=100&sort=updated&direction=desc"),
        token,
        prev_etag.as_deref(),
        backfilling,
        since.filter(|_| backfilling),
        &["updated_at", "created_at"],
        None,
    )
    .await?;
    let mut last_rate = res.rate.clone();
    let mut pr_n = 0;
    if !res.not_modified {
        let all_prs: Vec<_> = res
            .items
            .iter()
            .filter_map(github::parse_pull_request)
            .collect();
        // Track the high-water from the *full* page set so incremental stays correct
        // even when the user scopes storage to only their own PRs.
        let hw = github::max_updated_at(&all_prs, prev_hw.as_deref());
        let kept: Vec<_> = all_prs
            .into_iter()
            .filter(|pr| github::pr_in_scope(pr, pr_scope, login))
            .collect();
        let (kept, events, files, enriched_rate) =
            enrich_pull_requests(client, o, r, token, kept).await;
        if enriched_rate.remaining.is_some() || enriched_rate.limit.is_some() {
            last_rate = enriched_rate;
        }
        pr_n = db.insert_pull_requests(key, &kept)?;
        let _ = db.replace_pull_request_events(key, &events)?;
        let _ = db.replace_pull_request_files(key, &files)?;
        db.set_sync_state(
            key,
            "pulls",
            res.etag.as_deref(),
            hw.as_deref(),
            "ok",
            &now_utc(),
        )?;
    } else {
        db.set_sync_state(
            key,
            "pulls",
            prev_etag.as_deref(),
            prev_hw.as_deref(),
            "not_modified",
            &now_utc(),
        )?;
    }

    // --- deployments: releases + Actions runs ---
    let mut deps = Vec::new();
    for (resource, path, parse, time_keys, array_path) in [
        (
            "releases",
            format!("{API}/repos/{o}/{r}/releases?per_page=100"),
            github::parse_release as fn(&Value) -> Option<harness_core::model::DeploymentRow>,
            &["published_at", "created_at"][..],
            None,
        ),
        (
            "runs",
            format!("{API}/repos/{o}/{r}/actions/runs?per_page=100"),
            github::parse_workflow_run as fn(&Value) -> Option<harness_core::model::DeploymentRow>,
            &["created_at"][..],
            Some("workflow_runs"),
        ),
    ] {
        let st = db.get_sync_state(key, resource)?;
        let prev_etag = st.as_ref().and_then(|s| s.etag.clone());
        let prev_hw = st.as_ref().and_then(|s| s.high_water_utc.clone());
        let backfilling = prev_hw.is_none() || backfill_forced;
        match fetch_resource(
            client,
            &path,
            token,
            prev_etag.as_deref(),
            backfilling,
            since.filter(|_| backfilling),
            time_keys,
            array_path,
        )
        .await
        {
            Ok(res) => {
                last_rate = res.rate.clone();
                if !res.not_modified {
                    let parsed: Vec<_> = res.items.iter().filter_map(parse).collect();
                    deps.extend(parsed);
                    let hw = res
                        .items
                        .iter()
                        .filter_map(|it| item_time(it, time_keys))
                        .max()
                        .or(prev_hw.clone());
                    db.set_sync_state(
                        key,
                        resource,
                        res.etag.as_deref(),
                        hw.as_deref(),
                        "ok",
                        &now_utc(),
                    )?;
                } else {
                    db.set_sync_state(
                        key,
                        resource,
                        prev_etag.as_deref(),
                        prev_hw.as_deref(),
                        "not_modified",
                        &now_utc(),
                    )?;
                }
            }
            Err(e) => tracing::warn!("github {resource} sync failed for {o}/{r}: {e}"),
        }
    }
    let dep_n = db.insert_deployments(key, &deps)?;

    // --- incidents: GitHub issues labeled `incident` (opt-in) ---
    let mut inc_n = 0;
    let incidents_enabled = db
        .get_setting("github_incidents_enabled")
        .ok()
        .flatten()
        .map(|v| v != "0")
        .unwrap_or(true);
    if incidents_enabled {
        let label = db
            .get_setting("github_incident_label")
            .ok()
            .flatten()
            .filter(|l| !l.trim().is_empty())
            .unwrap_or_else(|| "incident".to_string());
        let st = db.get_sync_state(key, "issues")?;
        let prev_etag = st.as_ref().and_then(|s| s.etag.clone());
        let prev_hw = st.as_ref().and_then(|s| s.high_water_utc.clone());
        let backfilling = prev_hw.is_none() || backfill_forced;
        match fetch_resource(
            client,
            &format!(
                "{API}/repos/{o}/{r}/issues?labels={label}&state=all&per_page=100&sort=updated&direction=desc"
            ),
            token,
            prev_etag.as_deref(),
            backfilling,
            since.filter(|_| backfilling),
            &["updated_at", "created_at"],
            None,
        )
        .await
        {
            Ok(res) => {
                last_rate = res.rate.clone();
                if !res.not_modified {
                    let kept: Vec<_> = res
                        .items
                        .iter()
                        .filter_map(|it| github::parse_incident_issue(it, key))
                        .collect();
                    inc_n = db.insert_incidents(&kept)?;
                    let hw = res
                        .items
                        .iter()
                        .filter_map(|it| item_time(it, &["updated_at", "created_at"]))
                        .max()
                        .or(prev_hw.clone());
                    db.set_sync_state(key, "issues", res.etag.as_deref(), hw.as_deref(), "ok", &now_utc())?;
                } else {
                    db.set_sync_state(
                        key,
                        "issues",
                        prev_etag.as_deref(),
                        prev_hw.as_deref(),
                        "not_modified",
                        &now_utc(),
                    )?;
                }
            }
            Err(e) => tracing::warn!("github issues sync failed for {o}/{r}: {e}"),
        }
    }

    let slugs = slugs_of(repo);
    let slug_refs: Vec<&str> = slugs.iter().map(String::as_str).collect();
    db.correlate_pr_overlap(key, &slug_refs, GRACE_MINUTES)?;
    db.correlate_incident_deploys()?;

    Ok((pr_n, dep_n, inc_n, last_rate))
}

/// Read the user's backfill setting + whether it deepened since the last sync.
fn read_backfill(db: &Db) -> (BackfillWindow, bool, String) {
    let value = db
        .get_setting("github_backfill_value")
        .ok()
        .flatten()
        .unwrap_or_else(|| "90".into());
    let unit = db
        .get_setting("github_backfill_unit")
        .ok()
        .flatten()
        .unwrap_or_else(|| "days".into());
    let window = github::parse_backfill_window(&value, &unit);
    let new_sig = format!("{value}:{unit}");
    let deepened = db
        .get_setting("github_backfill_window_sig")
        .ok()
        .flatten()
        .and_then(|sig| {
            sig.split_once(':')
                .map(|(v, u)| github::parse_backfill_window(v, u))
        })
        .map(|old| github::window_is_deeper(&window, &old))
        .unwrap_or(false);
    (window, deepened, new_sig)
}

fn emit(
    tx: &broadcast::Sender<ScanEvent>,
    progress: &Arc<Mutex<Option<GithubProgress>>>,
    snapshot: GithubProgress,
    terminal: bool,
) {
    *progress.lock().unwrap() = Some(snapshot.clone());
    let _ = tx.send(ScanEvent {
        kind: if terminal {
            "github-sync".into()
        } else {
            "github-progress".into()
        },
        n: None,
        reason: None,
        message: None,
        progress: Some(snapshot),
    });
}

/// Sync every enabled GitHub repo, emitting progress. Per-repo failures are recorded
/// and skipped; a rate-limit stop ends the run gracefully (resumable next time).
pub async fn sync_github(
    db: Arc<Db>,
    tx: broadcast::Sender<ScanEvent>,
    progress: Arc<Mutex<Option<GithubProgress>>>,
    token: String,
) -> anyhow::Result<GithubSyncStats> {
    let client = reqwest::Client::new();
    let repos = db.github_repos()?;
    let (window, deepened, sig) = read_backfill(&db);
    let now = chrono::Utc::now();
    let since = github::since_timestamp(&window, now);
    // PR scope: keep every author's PRs (baselines) by default, or only the connected
    // user's. `mine` needs the login from the validated token.
    let pr_scope = github::parse_pr_scope(
        db.get_setting("github_pr_scope")
            .ok()
            .flatten()
            .as_deref()
            .unwrap_or("all"),
    );
    let login = db.get_setting("github_login").ok().flatten();

    let mut snap = GithubProgress {
        running: true,
        repo_total: repos.len(),
        ..Default::default()
    };
    emit(&tx, &progress, snap.clone(), false);

    let mut stats = GithubSyncStats::default();
    for (i, repo) in repos.iter().enumerate() {
        snap.repo_index = i + 1;
        snap.current_repo = Some(format!("{}/{}", repo.owner, repo.repo));
        emit(&tx, &progress, snap.clone(), false);

        match sync_one(
            &client,
            &db,
            repo,
            &token,
            deepened,
            since.as_deref(),
            pr_scope,
            login.as_deref(),
        )
        .await
        {
            Ok((prs, deps, incs, rate)) => {
                stats.repos += 1;
                stats.pull_requests += prs;
                stats.deployments += deps;
                stats.incidents += incs;
                snap.pull_requests = stats.pull_requests;
                snap.deployments = stats.deployments;
                snap.incidents = stats.incidents;
                snap.rate_remaining = rate.remaining;
                snap.rate_limit = rate.limit;
                snap.rate_reset_utc = rate.reset_utc.clone();
                // Persist the budget snapshot for the status endpoint / restart.
                if let Some(rem) = rate.remaining {
                    let _ = db.set_setting("github_rate_remaining", &rem.to_string());
                }
                if let Some(lim) = rate.limit {
                    let _ = db.set_setting("github_rate_limit", &lim.to_string());
                }
                if let Some(reset) = &rate.reset_utc {
                    let _ = db.set_setting("github_rate_reset_utc", reset);
                }
                emit(&tx, &progress, snap.clone(), false);
                if github::should_stop(&rate, RATE_FLOOR) {
                    snap.last_error =
                        Some("paused near GitHub rate limit — will resume next sync".into());
                    break;
                }
            }
            Err(e) => {
                tracing::warn!("github sync failed for {}/{}: {e}", repo.owner, repo.repo);
                snap.last_error = Some(format!("{}/{}: {e}", repo.owner, repo.repo));
            }
        }
    }

    let _ = db.set_setting("github_backfill_window_sig", &sig);
    snap.running = false;
    snap.current_repo = None;
    snap.finished_at = Some(now_utc());
    emit(&tx, &progress, snap, true);
    Ok(stats)
}
