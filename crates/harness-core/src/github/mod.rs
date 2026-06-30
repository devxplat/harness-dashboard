//! Pure parsers from GitHub REST API JSON into insertable rows.
//!
//! The network fetch lives in `harness-server` (async, opt-in); this module is the
//! offline, deterministic half â€” so the field extraction and edge cases are fully
//! `cargo test`-able from fixture JSON without any HTTP.

use crate::model::{
    DeploymentRow, IncidentRow, PullRequestEventRow, PullRequestFileRow, PullRequestRow,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde_json::Value;

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

fn i(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// Best-effort severity from an issue's labels array (`severity:high`, `sev1`, `p1`â€¦).
fn parse_severity(labels: &Value) -> Option<String> {
    let arr = labels.as_array()?;
    for label in arr {
        let Some(name) = label.get("name").and_then(Value::as_str) else {
            continue;
        };
        let name = name.to_ascii_lowercase();
        let token = name.strip_prefix("severity:").unwrap_or(&name).trim();
        let sev = match token {
            "critical" | "sev1" | "p0" => "critical",
            "high" | "sev2" | "p1" => "high",
            "medium" | "sev3" | "p2" => "medium",
            "low" | "sev4" | "p3" => "low",
            _ => continue,
        };
        return Some(sev.to_string());
    }
    None
}

/// Parse one item from `GET /repos/{o}/{r}/issues?labels=incident&state=all` into an
/// incident. The issues endpoint also returns PRs (they carry a `pull_request` key) â€”
/// those are skipped. A closed issue is treated as a resolved incident.
pub fn parse_incident_issue(v: &Value, repo_key: &str) -> Option<IncidentRow> {
    if v.get("pull_request").is_some() {
        return None;
    }
    let number = v.get("number").and_then(Value::as_i64)?;
    let closed = v.get("state").and_then(Value::as_str) == Some("closed");
    Some(IncidentRow {
        source: "github_issue".to_string(),
        repo_key: Some(repo_key.to_string()),
        ext_id: number.to_string(),
        title: s(v, "title"),
        severity: v.get("labels").and_then(parse_severity),
        opened_at_utc: s(v, "created_at"),
        resolved_at_utc: if closed { s(v, "closed_at") } else { None },
        state: Some(if closed { "resolved" } else { "open" }.to_string()),
        html_url: s(v, "html_url"),
    })
}

/// Parse one item from `GET /repos/{o}/{r}/pulls?state=all`. `review_count` and
/// the size fields are only present on the *detail* endpoint, so they default to
/// 0 / None from the list endpoint and are filled by an optional detail merge.
pub fn parse_pull_request(v: &Value) -> Option<PullRequestRow> {
    let number = v.get("number").and_then(Value::as_i64)?;
    let merged_at = s(v, "merged_at");
    let closed_at = s(v, "closed_at");
    // GitHub's list `state` is open|closed; promote to "merged" when merged_at set.
    let state = if merged_at.is_some() {
        Some("merged".to_string())
    } else {
        s(v, "state")
    };
    Some(PullRequestRow {
        number,
        title: s(v, "title"),
        state,
        author: v
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(Value::as_str)
            .map(str::to_string),
        created_at_utc: s(v, "created_at"),
        merged_at_utc: merged_at,
        closed_at_utc: closed_at,
        head_branch: v
            .get("head")
            .and_then(|h| h.get("ref"))
            .and_then(Value::as_str)
            .map(str::to_string),
        base_branch: v
            .get("base")
            .and_then(|b| b.get("ref"))
            .and_then(Value::as_str)
            .map(str::to_string),
        additions: i(v, "additions"),
        deletions: i(v, "deletions"),
        changed_files: i(v, "changed_files"),
        review_count: 0,
        first_review_at_utc: None,
        merge_commit_sha: s(v, "merge_commit_sha"),
        head_sha: v
            .get("head")
            .and_then(|h| h.get("sha"))
            .and_then(Value::as_str)
            .map(str::to_string),
        html_url: s(v, "html_url"),
    })
}

/// Parse a `GET /repos/{o}/{r}/releases` item into a deployment.
pub fn parse_release(v: &Value) -> Option<DeploymentRow> {
    let id = v.get("id").and_then(Value::as_i64)?;
    Some(DeploymentRow {
        kind: "release".to_string(),
        ext_id: id.to_string(),
        name: s(v, "tag_name").or_else(|| s(v, "name")),
        created_at_utc: s(v, "published_at").or_else(|| s(v, "created_at")),
        status: Some("success".to_string()),
        sha: s(v, "target_commitish"),
        html_url: s(v, "html_url"),
    })
}

pub fn parse_review_event(v: &Value, pr_number: i64) -> Option<PullRequestEventRow> {
    let id = v.get("id").and_then(Value::as_i64)?.to_string();
    Some(PullRequestEventRow {
        pr_number,
        event_type: "review".into(),
        ext_id: id,
        title: Some("Review".into()),
        actor: v
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(Value::as_str)
            .map(str::to_string),
        body: s(v, "body"),
        state: s(v, "state"),
        conclusion: None,
        created_at_utc: s(v, "submitted_at"),
        html_url: s(v, "html_url"),
    })
}

pub fn parse_issue_comment_event(v: &Value, pr_number: i64) -> Option<PullRequestEventRow> {
    let id = v.get("id").and_then(Value::as_i64)?.to_string();
    Some(PullRequestEventRow {
        pr_number,
        event_type: "comment".into(),
        ext_id: id,
        title: Some("Comment".into()),
        actor: v
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(Value::as_str)
            .map(str::to_string),
        body: s(v, "body"),
        state: None,
        conclusion: None,
        created_at_utc: s(v, "created_at"),
        html_url: s(v, "html_url"),
    })
}

pub fn parse_check_run_event(v: &Value, pr_number: i64) -> Option<PullRequestEventRow> {
    let id = v.get("id").and_then(Value::as_i64)?.to_string();
    Some(PullRequestEventRow {
        pr_number,
        event_type: "check".into(),
        ext_id: id,
        title: s(v, "name").or_else(|| Some("Check run".into())),
        actor: v
            .get("app")
            .and_then(|a| a.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        body: s(v, "details_url"),
        state: s(v, "status"),
        conclusion: s(v, "conclusion"),
        created_at_utc: s(v, "completed_at")
            .or_else(|| s(v, "started_at"))
            .or_else(|| s(v, "created_at")),
        html_url: s(v, "html_url").or_else(|| s(v, "details_url")),
    })
}

pub fn parse_pull_request_file(v: &Value, pr_number: i64) -> Option<PullRequestFileRow> {
    Some(PullRequestFileRow {
        pr_number,
        path: s(v, "filename")?,
        status: s(v, "status"),
        additions: i(v, "additions"),
        deletions: i(v, "deletions"),
        changes: i(v, "changes"),
        previous_path: s(v, "previous_filename"),
        blob_url: s(v, "blob_url"),
    })
}

/// Parse one item from `GET /repos/{o}/{r}/actions/runs` (`workflow_runs[]`).
/// Only deploy-ish conclusions are interesting; status maps `success`â†’success,
/// everything terminal-but-not-successâ†’failure, in-progressâ†’None.
pub fn parse_workflow_run(v: &Value) -> Option<DeploymentRow> {
    let id = v.get("id").and_then(Value::as_i64)?;
    let status = match v.get("conclusion").and_then(Value::as_str) {
        Some("success") => Some("success".to_string()),
        Some(_) => Some("failure".to_string()),
        None => None,
    };
    Some(DeploymentRow {
        kind: "run".to_string(),
        ext_id: id.to_string(),
        name: s(v, "name").or_else(|| s(v, "display_title")),
        created_at_utc: s(v, "created_at"),
        status,
        sha: s(v, "head_sha"),
        html_url: s(v, "html_url"),
    })
}

// ---------- Sync-engine helpers (pure; the async loop in harness-server delegates
// every decision here so it's testable without HTTP). ----------

/// User-chosen backfill depth for the first/forced sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackfillWindow {
    Recent,
    Days(i64),
    All,
}

/// Parse the stored backfill setting (`value` + `unit`) into a window. Weeks/months
/// normalize to days; unknown units fall back to 90 days; values clamp to â‰¥ 1.
pub fn parse_backfill_window(value: &str, unit: &str) -> BackfillWindow {
    match unit {
        "all" => BackfillWindow::All,
        "recent" => BackfillWindow::Recent,
        _ => {
            let n = value.trim().parse::<i64>().unwrap_or(90).max(1);
            let days = match unit {
                "weeks" => n * 7,
                "months" => n * 30,
                "days" => n,
                _ => 90,
            };
            BackfillWindow::Days(days.max(1))
        }
    }
}

/// RFC3339 "â€¦Z" lower bound for the window, or `None` for All/Recent. `now` is
/// injected so it is deterministic in tests; the cutoff is always UTC.
pub fn since_timestamp(window: &BackfillWindow, now: DateTime<Utc>) -> Option<String> {
    match window {
        BackfillWindow::Days(n) => {
            Some((now - Duration::days(*n)).to_rfc3339_opts(SecondsFormat::Secs, true))
        }
        _ => None,
    }
}

/// True when `new` reaches further back than `old` (so a deeper backfill is needed).
pub fn window_is_deeper(new: &BackfillWindow, old: &BackfillWindow) -> bool {
    fn rank(w: &BackfillWindow) -> i64 {
        match w {
            BackfillWindow::Recent => 0,
            BackfillWindow::Days(n) => *n,
            BackfillWindow::All => i64::MAX,
        }
    }
    rank(new) > rank(old)
}

/// GitHub rate-limit snapshot parsed from response headers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RateLimit {
    pub remaining: Option<i64>,
    pub limit: Option<i64>,
    pub reset_utc: Option<String>,
    pub retry_after_secs: Option<i64>,
}

/// Parse rate-limit headers (case-insensitive). `x-ratelimit-reset` (unix secs) â†’
/// RFC3339 "â€¦Z"; `retry-after` (secs) preserved.
pub fn parse_rate_limit(headers: &[(String, String)]) -> RateLimit {
    let get = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    };
    let num = |name: &str| get(name).and_then(|v| v.trim().parse::<i64>().ok());
    let reset_utc = num("x-ratelimit-reset")
        .and_then(|secs| DateTime::<Utc>::from_timestamp(secs, 0))
        .map(|d| d.to_rfc3339_opts(SecondsFormat::Secs, true));
    RateLimit {
        remaining: num("x-ratelimit-remaining"),
        limit: num("x-ratelimit-limit"),
        reset_utc,
        retry_after_secs: num("retry-after"),
    }
}

/// Stop syncing gracefully when the budget is near exhaustion or a Retry-After is set.
pub fn should_stop(rate: &RateLimit, floor: i64) -> bool {
    if rate.retry_after_secs.is_some() {
        return true;
    }
    matches!(rate.remaining, Some(r) if r <= floor)
}

/// Extract the `rel="next"` URL from an RFC5988 `Link` header.
pub fn parse_link_next(link_header: Option<&str>) -> Option<String> {
    let header = link_header?;
    for part in header.split(',') {
        let mut segs = part.split(';');
        let Some(url_seg) = segs.next() else { continue };
        let is_next = segs.any(|s| {
            let s = s.trim();
            s == "rel=\"next\"" || s == "rel=next"
        });
        if is_next {
            let url = url_seg
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .trim();
            if !url.is_empty() {
                return Some(url.to_string());
            }
        }
    }
    None
}

/// Split an `X-OAuth-Scopes` header into trimmed, non-empty scopes.
pub fn parse_oauth_scopes(header: Option<&str>) -> Vec<String> {
    header
        .map(|h| {
            h.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// True when the token carries `repo` scope (covers private repos).
pub fn has_repo_scope(scopes: &[String]) -> bool {
    scopes.iter().any(|s| s == "repo")
}

/// Which pull requests to keep per repo: every PR (so we have cross-author baselines
/// for DORA / productivity comparisons) or only the connected user's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrScope {
    All,
    Mine,
}

/// Parse the stored `github_pr_scope` setting; unknown â†’ `All` (the default).
pub fn parse_pr_scope(s: &str) -> PrScope {
    match s {
        "mine" => PrScope::Mine,
        _ => PrScope::All,
    }
}

/// Whether a parsed PR is in scope. `Mine` keeps only PRs authored by `login`
/// (case-insensitive); a PR with no author, or when no login is known, is excluded.
pub fn pr_in_scope(pr: &PullRequestRow, scope: PrScope, login: Option<&str>) -> bool {
    match scope {
        PrScope::All => true,
        PrScope::Mine => match (pr.author.as_deref(), login) {
            (Some(a), Some(l)) => a.eq_ignore_ascii_case(l),
            _ => false,
        },
    }
}

/// New high-water mark: the max of each PR's created/merged time and the previous
/// mark. RFC3339 "â€¦Z" sorts lexicographically, so a plain string max is correct.
pub fn max_updated_at(prs: &[PullRequestRow], prev_high_water: Option<&str>) -> Option<String> {
    let mut best: Option<String> = prev_high_water.map(str::to_string);
    for pr in prs {
        for v in [&pr.created_at_utc, &pr.merged_at_utc]
            .into_iter()
            .flatten()
        {
            if best.as_deref().map(|b| v.as_str() > b).unwrap_or(true) {
                best = Some(v.clone());
            }
        }
    }
    best
}

/// Whether a periodic auto-sync is due. Unset `last_sync` â†’ due; unparseable â†’ not due.
pub fn autosync_due(last_sync: Option<&str>, interval_min: i64, now: DateTime<Utc>) -> bool {
    match last_sync {
        None => true,
        Some(ts) => match DateTime::parse_from_rfc3339(ts) {
            Ok(dt) => now >= dt.with_timezone(&Utc) + Duration::minutes(interval_min.max(1)),
            Err(_) => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_incident_issue_and_skips_prs() {
        let inc = parse_incident_issue(
            &json!({
                "number": 7,
                "title": "API down",
                "state": "closed",
                "created_at": "2026-06-20T09:00:00Z",
                "closed_at": "2026-06-20T13:00:00Z",
                "labels": [{ "name": "incident" }, { "name": "severity:high" }],
                "html_url": "https://github.com/o/r/issues/7"
            }),
            "repo-key",
        )
        .unwrap();
        assert_eq!(inc.ext_id, "7");
        assert_eq!(inc.state.as_deref(), Some("resolved"));
        assert_eq!(inc.resolved_at_utc.as_deref(), Some("2026-06-20T13:00:00Z"));
        assert_eq!(inc.severity.as_deref(), Some("high"));

        // An open issue has no resolved time.
        let open = parse_incident_issue(
            &json!({ "number": 8, "state": "open", "created_at": "2026-06-20T09:00:00Z" }),
            "repo-key",
        )
        .unwrap();
        assert_eq!(open.state.as_deref(), Some("open"));
        assert!(open.resolved_at_utc.is_none());

        // A PR returned by the issues endpoint is skipped.
        assert!(
            parse_incident_issue(&json!({ "number": 9, "pull_request": {} }), "repo-key").is_none()
        );
    }

    #[test]
    fn parses_a_merged_pr() {
        let pr = parse_pull_request(&json!({
            "number": 42,
            "title": "Add a thing",
            "state": "closed",
            "merged_at": "2026-06-20T10:00:00Z",
            "created_at": "2026-06-19T09:00:00Z",
            "user": { "login": "octocat" },
            "head": { "ref": "feature" },
            "base": { "ref": "main" },
            "merge_commit_sha": "abc123",
            "html_url": "https://github.com/o/r/pull/42"
        }))
        .unwrap();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.state.as_deref(), Some("merged")); // promoted from closed
        assert_eq!(pr.author.as_deref(), Some("octocat"));
        assert_eq!(pr.head_branch.as_deref(), Some("feature"));
    }

    #[test]
    fn open_pr_keeps_state() {
        let pr = parse_pull_request(&json!({ "number": 1, "state": "open" })).unwrap();
        assert_eq!(pr.state.as_deref(), Some("open"));
        assert!(pr.merged_at_utc.is_none());
    }

    #[test]
    fn parses_pull_request_file() {
        let file = parse_pull_request_file(
            &json!({
                "filename": "src/checkout.rs",
                "status": "renamed",
                "additions": 12,
                "deletions": 3,
                "changes": 15,
                "previous_filename": "src/payments.rs",
                "blob_url": "https://github.com/o/r/blob/main/src/checkout.rs"
            }),
            42,
        )
        .unwrap();
        assert_eq!(file.pr_number, 42);
        assert_eq!(file.path, "src/checkout.rs");
        assert_eq!(file.previous_path.as_deref(), Some("src/payments.rs"));
        assert_eq!(file.changes, 15);
        assert!(parse_pull_request_file(&json!({ "status": "modified" }), 42).is_none());
    }

    #[test]
    fn parses_release_and_run() {
        let rel = parse_release(&json!({
            "id": 7, "tag_name": "v1.2.0", "published_at": "2026-06-20T12:00:00Z",
            "html_url": "https://github.com/o/r/releases/v1.2.0"
        }))
        .unwrap();
        assert_eq!(rel.kind, "release");
        assert_eq!(rel.ext_id, "7");
        assert_eq!(rel.name.as_deref(), Some("v1.2.0"));

        let run = parse_workflow_run(&json!({
            "id": 99, "name": "deploy", "conclusion": "failure", "created_at": "2026-06-20T13:00:00Z"
        }))
        .unwrap();
        assert_eq!(run.status.as_deref(), Some("failure"));
    }

    #[test]
    fn rejects_items_without_id() {
        assert!(parse_pull_request(&json!({ "title": "no number" })).is_none());
        assert!(parse_release(&json!({ "tag_name": "x" })).is_none());
        assert!(parse_workflow_run(&json!({ "name": "x" })).is_none());
    }

    fn at(rfc: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn backfill_window_parsing_and_since() {
        assert_eq!(parse_backfill_window("0", "all"), BackfillWindow::All);
        assert_eq!(parse_backfill_window("0", "recent"), BackfillWindow::Recent);
        assert_eq!(
            parse_backfill_window("90", "days"),
            BackfillWindow::Days(90)
        );
        assert_eq!(
            parse_backfill_window("2", "weeks"),
            BackfillWindow::Days(14)
        );
        assert_eq!(
            parse_backfill_window("3", "months"),
            BackfillWindow::Days(90)
        );
        assert_eq!(
            parse_backfill_window("junk", "days"),
            BackfillWindow::Days(90)
        );
        assert_eq!(
            parse_backfill_window("5", "fortnights"),
            BackfillWindow::Days(90)
        );

        let now = at("2026-06-20T00:00:00Z");
        assert_eq!(
            since_timestamp(&BackfillWindow::Days(90), now).as_deref(),
            Some("2026-03-22T00:00:00Z")
        );
        assert!(since_timestamp(&BackfillWindow::All, now).is_none());
        assert!(since_timestamp(&BackfillWindow::Recent, now).is_none());
    }

    #[test]
    fn window_depth_ordering() {
        assert!(window_is_deeper(
            &BackfillWindow::All,
            &BackfillWindow::Days(365)
        ));
        assert!(window_is_deeper(
            &BackfillWindow::Days(90),
            &BackfillWindow::Days(30)
        ));
        assert!(window_is_deeper(
            &BackfillWindow::Days(1),
            &BackfillWindow::Recent
        ));
        assert!(!window_is_deeper(
            &BackfillWindow::Days(30),
            &BackfillWindow::Days(90)
        ));
        assert!(!window_is_deeper(
            &BackfillWindow::Recent,
            &BackfillWindow::All
        ));
    }

    #[test]
    fn rate_limit_parsing_and_stop() {
        let h = |pairs: &[(&str, &str)]| -> Vec<(String, String)> {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        };
        let rate = parse_rate_limit(&h(&[
            ("X-RateLimit-Remaining", "4870"),
            ("x-ratelimit-limit", "5000"),
            ("X-RateLimit-Reset", "1782144000"),
        ]));
        assert_eq!(rate.remaining, Some(4870));
        assert_eq!(rate.limit, Some(5000));
        assert!(rate.reset_utc.is_some());
        assert!(!should_stop(&rate, 50));

        assert!(should_stop(
            &RateLimit {
                remaining: Some(10),
                ..Default::default()
            },
            50
        ));
        assert!(should_stop(
            &RateLimit {
                retry_after_secs: Some(30),
                ..Default::default()
            },
            50
        ));
        assert_eq!(parse_rate_limit(&[]), RateLimit::default());
    }

    #[test]
    fn link_next_extraction() {
        let header = "<https://api.github.com/r?page=2>; rel=\"next\", <https://api.github.com/r?page=9>; rel=\"last\"";
        assert_eq!(
            parse_link_next(Some(header)).as_deref(),
            Some("https://api.github.com/r?page=2")
        );
        assert_eq!(parse_link_next(Some("<https://x>; rel=\"last\"")), None);
        assert_eq!(parse_link_next(None), None);
    }

    #[test]
    fn scopes_and_high_water() {
        assert_eq!(
            parse_oauth_scopes(Some("repo, read:org ,")),
            vec!["repo", "read:org"]
        );
        assert!(parse_oauth_scopes(None).is_empty());
        assert!(has_repo_scope(&["repo".to_string()]));
        assert!(!has_repo_scope(&["read:org".to_string()]));

        let pr = |created: &str, merged: Option<&str>| PullRequestRow {
            number: 1,
            title: None,
            state: None,
            author: None,
            created_at_utc: Some(created.to_string()),
            merged_at_utc: merged.map(str::to_string),
            closed_at_utc: None,
            head_branch: None,
            base_branch: None,
            additions: 0,
            deletions: 0,
            changed_files: 0,
            review_count: 0,
            first_review_at_utc: None,
            merge_commit_sha: None,
            head_sha: None,
            html_url: None,
        };
        let prs = [
            pr("2026-06-01T00:00:00Z", Some("2026-06-05T00:00:00Z")),
            pr("2026-06-03T00:00:00Z", None),
        ];
        assert_eq!(
            max_updated_at(&prs, None).as_deref(),
            Some("2026-06-05T00:00:00Z")
        );
        assert_eq!(
            max_updated_at(&[], Some("2026-06-10T00:00:00Z")).as_deref(),
            Some("2026-06-10T00:00:00Z")
        );
    }

    #[test]
    fn pr_scope_filtering() {
        let pr = |author: Option<&str>| PullRequestRow {
            number: 1,
            title: None,
            state: None,
            author: author.map(str::to_string),
            created_at_utc: None,
            merged_at_utc: None,
            closed_at_utc: None,
            head_branch: None,
            base_branch: None,
            additions: 0,
            deletions: 0,
            changed_files: 0,
            review_count: 0,
            first_review_at_utc: None,
            merge_commit_sha: None,
            head_sha: None,
            html_url: None,
        };
        assert_eq!(parse_pr_scope("mine"), PrScope::Mine);
        assert_eq!(parse_pr_scope("all"), PrScope::All);
        assert_eq!(parse_pr_scope("whatever"), PrScope::All);

        // All: everyone's PRs are kept (the baseline case).
        assert!(pr_in_scope(
            &pr(Some("alice")),
            PrScope::All,
            Some("octocat")
        ));
        assert!(pr_in_scope(&pr(None), PrScope::All, Some("octocat")));

        // Mine: only the connected user's, case-insensitively.
        assert!(pr_in_scope(
            &pr(Some("OctoCat")),
            PrScope::Mine,
            Some("octocat")
        ));
        assert!(!pr_in_scope(
            &pr(Some("alice")),
            PrScope::Mine,
            Some("octocat")
        ));
        assert!(!pr_in_scope(&pr(None), PrScope::Mine, Some("octocat")));
        assert!(!pr_in_scope(&pr(Some("alice")), PrScope::Mine, None));
    }

    #[test]
    fn autosync_due_logic() {
        let now = at("2026-06-20T12:00:00Z");
        assert!(autosync_due(None, 60, now));
        assert!(autosync_due(Some("2026-06-20T10:00:00Z"), 60, now)); // 2h ago, due
        assert!(!autosync_due(Some("2026-06-20T11:45:00Z"), 60, now)); // 15m ago, not due
        assert!(!autosync_due(Some("not-a-date"), 60, now));
    }
}
