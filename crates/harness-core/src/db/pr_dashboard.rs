//! Pull request dashboard aggregation and deterministic insight rules.
//!
//! The rule language is intentionally small: it covers numeric aggregate and
//! per-PR thresholds without embedding a scripting engine in the local app.

use super::Db;
use crate::error::{CoreError, Result};
use chrono::{DateTime, Datelike, Duration, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const RULES_SETTING: &str = "pull_request_custom_insight_rules";
const SESSION_CORRELATION_SETTING: &str = "pull_request_session_correlation_config";
const ALL_AUTHORS: &str = "__all";

#[derive(Debug, Clone, Serialize)]
pub struct PrDashboardBundle {
    pub grain: String,
    pub active_author: String,
    pub default_author: Option<String>,
    pub authors: Vec<PrAuthorOption>,
    pub pagination: PrPagination,
    pub filter_options: PrFilterOptions,
    pub summary: PrSummary,
    pub rows: Vec<PrDashboardRow>,
    pub periods: Vec<PrPeriodRow>,
    pub tiles: Vec<PrAnalyticsTile>,
    pub deterministic_insights: Vec<PrInsight>,
    pub rules: Vec<PrInsightRule>,
    pub session_correlation_config: PrSessionCorrelationConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrPagination {
    pub page: i64,
    pub page_size: i64,
    pub total_rows: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrFilterOptions {
    pub authors: Vec<String>,
    pub repos: Vec<String>,
    pub orgs: Vec<String>,
    pub statuses: Vec<String>,
    pub insight_categories: Vec<String>,
    pub insight_severities: Vec<String>,
    pub insight_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrDeterministicInsightsPage {
    pub rows: Vec<PrInsight>,
    pub pagination: PrPagination,
    pub filter_options: PrFilterOptions,
}

#[derive(Debug, Clone)]
pub struct PrDashboardQuery<'a> {
    pub grain: PrGrain,
    pub author: Option<&'a str>,
    pub since: Option<&'a str>,
    pub until: Option<&'a str>,
    pub page: i64,
    pub page_size: i64,
    pub query: Option<&'a str>,
    pub status: Option<&'a str>,
    pub repo: Option<&'a str>,
    pub org: Option<&'a str>,
    pub sort: Option<&'a str>,
    pub direction: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrAuthorOption {
    pub login: String,
    pub pull_requests: i64,
    pub is_default: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrSummary {
    pub total: i64,
    pub ai_assisted: i64,
    pub open: i64,
    pub awaiting_review: i64,
    pub awaiting_merge: i64,
    pub high_review_time: i64,
    pub merged: i64,
    pub closed: i64,
    pub no_ai_signal: i64,
    pub avg_cycle_hours: Option<f64>,
    pub avg_review_wait_hours: Option<f64>,
    pub avg_churn: Option<f64>,
    pub merge_frequency_per_week: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrDashboardRow {
    pub repo_key: String,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub repo_full_name: String,
    pub number: i64,
    pub title: Option<String>,
    pub state: String,
    pub status_bucket: String,
    pub author: Option<String>,
    pub created_at_utc: Option<String>,
    pub merged_at_utc: Option<String>,
    pub closed_at_utc: Option<String>,
    pub first_review_at_utc: Option<String>,
    pub head_branch: Option<String>,
    pub base_branch: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub size: i64,
    pub changed_files: i64,
    pub review_count: i64,
    pub merge_commit_sha: Option<String>,
    pub head_sha: Option<String>,
    pub html_url: Option<String>,
    pub ai_session_overlap: bool,
    pub churn: i64,
    pub age_hours: Option<f64>,
    pub cycle_hours: Option<f64>,
    pub review_wait_hours: Option<f64>,
    pub timeline: Vec<PrTimelineEvent>,
    pub files: Vec<PrFileRef>,
    pub session_correlations: Vec<PrSessionCorrelation>,
    pub related_commits: Vec<PrRelatedCommit>,
    pub related_deployments: Vec<PrDeploymentRef>,
    pub related_incidents: Vec<PrIncidentRef>,
    pub business_value_index: Option<PrAiIndex>,
    pub ai_maturity_index: Option<PrAiIndex>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrRelatedCommit {
    pub sha: String,
    pub authored_at_utc: Option<String>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub subject: Option<String>,
    pub branch: Option<String>,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub ai_assisted: bool,
    pub match_reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrDeploymentRef {
    pub kind: String,
    pub ext_id: String,
    pub name: Option<String>,
    pub created_at_utc: Option<String>,
    pub status: Option<String>,
    pub sha: Option<String>,
    pub html_url: Option<String>,
    pub lead_time_hours: Option<f64>,
    pub match_reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrIncidentRef {
    pub source: String,
    pub ext_id: String,
    pub title: Option<String>,
    pub severity: Option<String>,
    pub opened_at_utc: Option<String>,
    pub resolved_at_utc: Option<String>,
    pub state: Option<String>,
    pub html_url: Option<String>,
    pub deploy_ext_id: Option<String>,
    pub mttr_hours: Option<f64>,
    pub hours_after_merge: Option<f64>,
    pub match_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrSessionCorrelationConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_window_before_minutes")]
    pub time_window_before_minutes: i64,
    #[serde(default = "default_window_after_minutes")]
    pub time_window_after_minutes: i64,
    #[serde(default = "default_min_confidence")]
    pub min_confidence: f64,
    #[serde(default = "default_max_sessions_per_pr")]
    pub max_sessions_per_pr: usize,
    #[serde(default = "default_true")]
    pub use_branch: bool,
    #[serde(default = "default_true")]
    pub use_file_touches: bool,
    #[serde(default = "default_true")]
    pub use_title_keywords: bool,
    #[serde(default)]
    pub weights: PrSessionCorrelationWeights,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrSessionCorrelationWeights {
    #[serde(default = "default_weight_time_overlap")]
    pub time_overlap: f64,
    #[serde(default = "default_weight_temporal_proximity")]
    pub temporal_proximity: f64,
    #[serde(default = "default_weight_branch")]
    pub branch: f64,
    #[serde(default = "default_weight_file_touch")]
    pub file_touch: f64,
    #[serde(default = "default_weight_title_keyword")]
    pub title_keyword: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrSessionCorrelation {
    pub repo_key: String,
    pub pr_number: i64,
    pub provider: String,
    pub session_id: String,
    pub mode: String,
    pub score: f64,
    pub confidence: f64,
    pub summary: Option<String>,
    #[serde(default)]
    pub reasons: Vec<String>,
    #[serde(default)]
    pub signals: BTreeMap<String, f64>,
    pub session_started_at_utc: Option<String>,
    pub session_ended_at_utc: Option<String>,
    pub project_slug: Option<String>,
    pub sample_cwd: Option<String>,
    #[serde(default)]
    pub turns: i64,
    #[serde(default)]
    pub tokens: i64,
    pub engine: Option<String>,
    pub input_hash: Option<String>,
    pub generated_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrSessionCandidateGroup {
    pub repo_key: String,
    pub pr_number: i64,
    pub repo_full_name: String,
    pub title: Option<String>,
    pub candidates: Vec<PrSessionCorrelation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrTimelineEvent {
    pub event_type: String,
    pub title: Option<String>,
    pub actor: Option<String>,
    pub body: Option<String>,
    pub state: Option<String>,
    pub conclusion: Option<String>,
    pub created_at_utc: Option<String>,
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrFileRef {
    pub path: String,
    pub status: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub changes: i64,
    pub previous_path: Option<String>,
    pub blob_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrAiIndex {
    pub repo_key: String,
    pub pr_number: i64,
    pub index_type: String,
    pub score: i64,
    pub grade: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub category_scores: BTreeMap<String, f64>,
    pub summary: Option<String>,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub recommendations: Vec<String>,
    pub confidence: Option<f64>,
    pub engine: Option<String>,
    pub input_hash: Option<String>,
    pub generated_at_utc: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrPeriodRow {
    pub period: String,
    pub opened: i64,
    pub merged: i64,
    pub ai_assisted: i64,
    pub avg_cycle_hours: Option<f64>,
    pub avg_review_wait_hours: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrAnalyticsTile {
    pub key: String,
    pub label: String,
    pub value: String,
    pub unit: Option<String>,
    pub detail: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrInsight {
    pub id: String,
    pub rule_id: String,
    pub title: String,
    pub severity: String,
    pub category: String,
    pub scope: String,
    pub metric: String,
    pub value: f64,
    pub threshold: f64,
    pub recommendation: String,
    pub affected_prs: Vec<PrRef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrRef {
    pub repo_key: String,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub repo_full_name: String,
    pub number: i64,
    pub title: Option<String>,
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrInsightRule {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub severity: String,
    #[serde(default = "default_category")]
    pub category: String,
    pub scope: String,
    pub metric: String,
    pub operator: String,
    pub threshold: f64,
    pub recommendation: String,
    #[serde(default)]
    pub custom: bool,
}

fn default_category() -> String {
    "flow".into()
}

fn default_true() -> bool {
    true
}

fn default_window_before_minutes() -> i64 {
    240
}

fn default_window_after_minutes() -> i64 {
    240
}

fn default_min_confidence() -> f64 {
    0.40
}

fn default_max_sessions_per_pr() -> usize {
    5
}

fn default_weight_time_overlap() -> f64 {
    0.40
}

fn default_weight_temporal_proximity() -> f64 {
    0.15
}

fn default_weight_branch() -> f64 {
    0.25
}

fn default_weight_file_touch() -> f64 {
    0.25
}

fn default_weight_title_keyword() -> f64 {
    0.10
}

impl Default for PrSessionCorrelationWeights {
    fn default() -> Self {
        Self {
            time_overlap: default_weight_time_overlap(),
            temporal_proximity: default_weight_temporal_proximity(),
            branch: default_weight_branch(),
            file_touch: default_weight_file_touch(),
            title_keyword: default_weight_title_keyword(),
        }
    }
}

impl Default for PrSessionCorrelationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            time_window_before_minutes: default_window_before_minutes(),
            time_window_after_minutes: default_window_after_minutes(),
            min_confidence: default_min_confidence(),
            max_sessions_per_pr: default_max_sessions_per_pr(),
            use_branch: true,
            use_file_touches: true,
            use_title_keywords: true,
            weights: PrSessionCorrelationWeights::default(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum PrGrain {
    Day,
    Week,
    Month,
}

impl PrGrain {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("week").to_ascii_lowercase().as_str() {
            "day" => Self::Day,
            "month" => Self::Month,
            _ => Self::Week,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }
}

#[derive(Default)]
struct PeriodAcc {
    opened: i64,
    merged: i64,
    ai_assisted: i64,
    cycle_sum: f64,
    cycle_count: i64,
    review_sum: f64,
    review_count: i64,
}

fn parse_ts(value: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

fn hours_between(start: DateTime<Utc>, end: DateTime<Utc>) -> f64 {
    (end - start).num_minutes().max(0) as f64 / 60.0
}

fn avg(sum: f64, count: i64) -> Option<f64> {
    (count > 0).then_some(sum / count as f64)
}

fn pct(num: i64, den: i64) -> f64 {
    if den > 0 {
        (num as f64 / den as f64) * 100.0
    } else {
        0.0
    }
}

fn period_key(ts: DateTime<Utc>, grain: PrGrain) -> String {
    match grain {
        PrGrain::Day => ts.format("%Y-%m-%d").to_string(),
        PrGrain::Month => ts.format("%Y-%m").to_string(),
        PrGrain::Week => {
            let week = ts.iso_week();
            format!("{}-W{:02}", week.year(), week.week())
        }
    }
}

fn status_bucket(
    state: &str,
    merged: Option<DateTime<Utc>>,
    first_review: Option<DateTime<Utc>>,
    review_count: i64,
) -> String {
    if state == "merged" || merged.is_some() {
        return "merged".to_string();
    }
    if state == "closed" {
        return "closed".to_string();
    }
    if first_review.is_some() || review_count > 0 {
        "awaiting_merge".to_string()
    } else {
        "awaiting_review".to_string()
    }
}

fn compare(value: f64, operator: &str, threshold: f64) -> bool {
    match operator {
        "gt" => value > threshold,
        "gte" => value >= threshold,
        "lt" => value < threshold,
        "lte" => value <= threshold,
        "eq" => (value - threshold).abs() < f64::EPSILON,
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn rule(
    id: &str,
    title: &str,
    category: &str,
    severity: &str,
    scope: &str,
    metric: &str,
    operator: &str,
    threshold: f64,
    recommendation: &str,
) -> PrInsightRule {
    PrInsightRule {
        id: id.into(),
        title: title.into(),
        description: None,
        enabled: true,
        severity: severity.into(),
        category: category.into(),
        scope: scope.into(),
        metric: metric.into(),
        operator: operator.into(),
        threshold,
        recommendation: recommendation.into(),
        custom: false,
    }
}

fn builtin_rules() -> Vec<PrInsightRule> {
    vec![
        rule("stale-open-pr", "PR waiting too long", "flow", "warning", "pr", "open_age_hours", "gte", 24.0, "Decide whether this PR needs review, rebasing, splitting, or closure."),
        rule("large-pr", "Large PR size", "size", "warning", "pr", "churn", "gte", 500.0, "Split future changes into smaller reviewable PRs when possible."),
        rule("mega-pr", "Very large PR", "size", "critical", "pr", "churn", "gte", 2000.0, "Treat this as high-risk; split, stage, or add an explicit review plan before merge."),
        rule("too-many-files", "Too many files changed", "size", "warning", "pr", "changed_files", "gte", 25.0, "Reduce the review surface or explain the cross-cutting change in the PR."),
        rule("wide-review-surface", "Wide review surface", "solid", "warning", "pr", "changed_files", "gte", 15.0, "Check whether the PR mixes responsibilities that should be reviewed separately."),
        rule("high-churn-per-file", "High churn per file", "kiss", "warning", "pr", "churn_per_file", "gte", 250.0, "Prefer smaller transformations per file or isolate mechanical rewrites."),
        rule("single-file-hotspot", "Single-file hotspot", "solid", "warning", "pr", "single_file_churn", "gte", 700.0, "A large single-file edit may indicate an object doing too much; consider extracting focused units."),
        rule("long-cycle-time", "Long PR cycle time", "flow", "warning", "pr", "cycle_hours", "gte", 72.0, "Look for blockers, unclear ownership, or scope that should be reduced next time."),
        rule("very-long-cycle-time", "Very long PR cycle time", "flow", "critical", "pr", "cycle_hours", "gte", 168.0, "Review the delivery path; this PR spent a week or more from open to merge."),
        rule("slow-first-review", "Slow first review", "review", "critical", "pr", "review_wait_hours", "gte", 24.0, "Route this PR to an available reviewer or reduce reviewer load."),
        rule("large-pr-slow-review", "Large PR waiting for review", "review", "critical", "pr", "review_wait_large_churn", "gte", 12.0, "Large PRs decay quickly; assign a reviewer or split before the context goes stale."),
        rule("stale-awaiting-review", "Awaiting review too long", "review", "warning", "pr", "open_no_review_age_hours", "gte", 12.0, "Assign a reviewer or make the next action explicit."),
        rule("stale-awaiting-merge", "Reviewed PR waiting to merge", "flow", "warning", "pr", "awaiting_merge_age_hours", "gte", 48.0, "Merge, rebase, or close reviewed PRs before they accumulate conflict risk."),
        rule("merged-without-review", "Merged without review signal", "review", "critical", "pr", "merge_without_review", "gte", 1.0, "Confirm whether the review happened outside GitHub; otherwise tighten review policy."),
        rule("low-review-density", "Low review density on large PR", "review", "warning", "pr", "reviews_per_kloc", "lt", 1.0, "Large PRs should usually have enough review interaction to reduce merge risk."),
        rule("critical-size-low-reviews", "Critical-size PR with too few reviews", "review", "critical", "pr", "large_pr_low_reviews", "gte", 1.0, "Add reviewers before merging very large changes."),
        rule("yagni-surface-area", "Potential YAGNI surface area", "yagni", "warning", "pr", "changed_files", "gte", 20.0, "Check whether speculative or unrelated changes can be deferred."),
        rule("kiss-complex-change", "KISS risk: dense change", "kiss", "warning", "pr", "churn_per_file", "gte", 180.0, "Prefer simpler, reviewable increments over dense rewrites."),
        rule("dry-copy-paste-risk", "DRY risk: high additions per file", "dry", "warning", "pr", "additions_per_file", "gte", 220.0, "Inspect for duplicated logic or generated code that should be isolated."),
        rule("rewrite-heavy", "Rewrite-heavy PR", "risk", "warning", "pr", "deletion_ratio_pct", "gte", 75.0, "Major rewrites need focused regression coverage and reviewer context."),
        rule("accumulation-without-cleanup", "Additions without cleanup", "yagni", "info", "pr", "additions_without_cleanup", "gte", 500.0, "Large additive changes should justify why existing code did not need simplification."),
        rule("title-too-short", "PR title too short", "naming", "info", "pr", "title_too_short", "gte", 1.0, "Use a title that states the behavior or intent, not just a vague action."),
        rule("title-too-long", "PR title too long", "naming", "info", "pr", "title_length", "gte", 120.0, "Move detail into the PR description and keep the title scannable."),
        rule("missing-conventional-prefix", "Missing conventional prefix", "naming", "info", "pr", "missing_conventional_prefix", "gte", 1.0, "Use prefixes like feat, fix, refactor, test, docs, chore, or an issue key."),
        rule("missing-ticket-link", "No ticket or issue key in title/branch", "traceability", "info", "pr", "missing_ticket", "gte", 1.0, "Link work back to a ticket, issue, or decision record when the change is not self-evident."),
        rule("branch-name-too-long", "Branch name too long", "naming", "info", "pr", "branch_length", "gte", 80.0, "Shorter branch names are easier to scan in CI, deploy tools, and review views."),
        rule("generic-branch-name", "Generic branch name", "naming", "info", "pr", "generic_branch_name", "gte", 1.0, "Use a branch name that identifies the change, ticket, or bounded task."),
        rule("branch-missing-ticket", "Branch missing ticket signal", "traceability", "info", "pr", "branch_missing_ticket", "gte", 1.0, "Include a ticket or meaningful slug in the branch when possible."),
        rule("non-standard-base-branch", "Non-standard base branch", "flow", "info", "pr", "non_standard_base", "gte", 1.0, "Confirm this PR intentionally targets a non-mainline branch."),
        rule("head-equals-base", "Head branch equals base branch", "risk", "critical", "pr", "head_equals_base", "gte", 1.0, "Validate branch metadata; a PR from and into the same branch is suspicious."),
        rule("large-pr-without-ai-signal", "Large PR without local AI signal", "ai", "info", "pr", "no_ai_large_churn", "gte", 700.0, "Use this as a baseline signal; inspect whether manual work patterns differ from AI-assisted PRs."),
        rule("review-queue", "Review queue is building up", "review", "warning", "aggregate", "awaiting_review_count", "gte", 3.0, "Schedule a review pass before starting more work."),
        rule("merge-queue", "Merge queue is building up", "flow", "warning", "aggregate", "awaiting_merge_count", "gte", 3.0, "Clear reviewed PRs before context and CI freshness decay."),
        rule("open-pr-pressure", "Too many open PRs", "flow", "warning", "aggregate", "open_count", "gte", 8.0, "Reduce work in progress and finish the current review queue."),
        rule("many-stale-open-prs", "Many stale open PRs", "flow", "critical", "aggregate", "high_review_time_count", "gte", 5.0, "Triage stale PRs before new implementation work."),
        rule("high-average-churn", "High average PR size", "size", "warning", "aggregate", "avg_churn", "gte", 600.0, "Set smaller PR size expectations for the team or author."),
        rule("high-average-review-wait", "High average review wait", "review", "critical", "aggregate", "avg_review_wait_hours", "gte", 24.0, "Review capacity is below demand; rebalance reviewers or reduce PR WIP."),
        rule("high-average-cycle", "High average PR cycle", "flow", "warning", "aggregate", "avg_cycle_hours", "gte", 72.0, "Inspect handoffs, CI delays, and PR size for this range."),
        rule("low-ai-overlap", "Low AI-assisted PR overlap", "ai", "info", "aggregate", "ai_share_pct", "lt", 25.0, "Use this as a baseline; do not treat it as a quality problem by itself."),
    ]
}

fn rule_metric(row: &PrDashboardRow, metric: &str) -> Option<f64> {
    let title = row.title.as_deref().unwrap_or("");
    let head = row.head_branch.as_deref().unwrap_or("");
    let base = row.base_branch.as_deref().unwrap_or("");
    let title_lower = title.to_ascii_lowercase();
    let head_lower = head.to_ascii_lowercase();
    let has_ticket = |s: &str| s.chars().any(|c| c.is_ascii_digit());
    let conventional = [
        "feat", "fix", "refactor", "chore", "docs", "test", "tests", "perf", "build", "ci",
        "style", "revert",
    ]
    .iter()
    .any(|prefix| {
        title_lower.starts_with(&format!("{prefix}:"))
            || title_lower.starts_with(&format!("{prefix}("))
            || title_lower.starts_with(&format!("{prefix}/"))
    }) || title.starts_with('[');
    let churn = row.churn.max(0) as f64;
    let changed_files = row.changed_files.max(0) as f64;
    match metric {
        "open_age_hours" => (row.status_bucket != "merged" && row.status_bucket != "closed")
            .then_some(row.age_hours?),
        "open_no_review_age_hours" => (row.status_bucket == "awaiting_review")
            .then_some(row.age_hours?)
            .filter(|_| row.review_count == 0),
        "awaiting_merge_age_hours" => {
            (row.status_bucket == "awaiting_merge").then_some(row.age_hours?)
        }
        "churn" => Some(row.churn as f64),
        "additions" => Some(row.additions as f64),
        "deletions" => Some(row.deletions as f64),
        "changed_files" => Some(row.changed_files as f64),
        "churn_per_file" => (row.changed_files > 0).then_some(churn / changed_files),
        "additions_per_file" => {
            (row.changed_files > 0).then_some(row.additions as f64 / changed_files)
        }
        "single_file_churn" => (row.changed_files <= 2).then_some(churn),
        "deletion_ratio_pct" => (row.churn > 0).then_some(row.deletions as f64 / churn * 100.0),
        "additions_without_cleanup" => {
            (row.deletions <= row.additions / 20).then_some(row.additions as f64)
        }
        "reviews_per_kloc" => {
            (row.churn >= 500).then_some(row.review_count as f64 / (churn / 1000.0).max(1.0))
        }
        "large_pr_low_reviews" => (row.churn >= 1000 && row.review_count < 2).then_some(1.0),
        "merge_without_review" => {
            (row.status_bucket == "merged" && row.review_count == 0).then_some(1.0)
        }
        "review_wait_large_churn" => (row.churn >= 500).then_some(row.review_wait_hours?),
        "review_wait_hours" => row.review_wait_hours,
        "cycle_hours" => row.cycle_hours,
        "title_length" => Some(title.chars().count() as f64),
        "title_too_short" => {
            (!title.trim().is_empty() && title.chars().count() <= 8).then_some(1.0)
        }
        "missing_conventional_prefix" => (!title.trim().is_empty() && !conventional).then_some(1.0),
        "missing_ticket" => (!has_ticket(title) && !has_ticket(head)).then_some(1.0),
        "branch_length" => (!head.is_empty()).then_some(head.chars().count() as f64),
        "branch_missing_ticket" => (!head.is_empty() && !has_ticket(head)).then_some(1.0),
        "generic_branch_name" => matches!(
            head_lower.as_str(),
            "fix" | "feature" | "feat" | "changes" | "update" | "test" | "work" | "main" | "master"
        )
        .then_some(1.0),
        "non_standard_base" => (!base.is_empty()
            && !matches!(base, "main" | "master" | "trunk" | "develop" | "dev"))
        .then_some(1.0),
        "head_equals_base" => (!head.is_empty() && head == base).then_some(1.0),
        "no_ai_large_churn" => (!row.ai_session_overlap && row.churn >= 700).then_some(churn),
        _ => None,
    }
}

fn aggregate_metric(summary: &PrSummary, metric: &str) -> Option<f64> {
    match metric {
        "awaiting_review_count" => Some(summary.awaiting_review as f64),
        "awaiting_merge_count" => Some(summary.awaiting_merge as f64),
        "open_count" => Some(summary.open as f64),
        "high_review_time_count" => Some(summary.high_review_time as f64),
        "ai_share_pct" => Some(pct(summary.ai_assisted, summary.total)),
        "avg_cycle_hours" => summary.avg_cycle_hours,
        "avg_review_wait_hours" => summary.avg_review_wait_hours,
        "avg_churn" => summary.avg_churn,
        _ => None,
    }
}

fn validate_rule(rule: &PrInsightRule) -> Result<()> {
    let id_ok = !rule.id.trim().is_empty()
        && rule
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        return Err(CoreError::Other(
            "rule id must use lowercase letters, digits, and hyphens".into(),
        ));
    }
    if rule.title.trim().is_empty() {
        return Err(CoreError::Other("rule title is required".into()));
    }
    if !matches!(rule.severity.as_str(), "info" | "warning" | "critical") {
        return Err(CoreError::Other(
            "rule severity must be info, warning, or critical".into(),
        ));
    }
    if !rule
        .category
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(CoreError::Other(
            "rule category must use lowercase letters, digits, hyphens, or underscores".into(),
        ));
    }
    if !matches!(rule.scope.as_str(), "pr" | "aggregate") {
        return Err(CoreError::Other(
            "rule scope must be pr or aggregate".into(),
        ));
    }
    if !matches!(rule.operator.as_str(), "gt" | "gte" | "lt" | "lte" | "eq") {
        return Err(CoreError::Other(
            "rule operator must be gt, gte, lt, lte, or eq".into(),
        ));
    }
    if !rule.threshold.is_finite() {
        return Err(CoreError::Other("rule threshold must be finite".into()));
    }
    Ok(())
}

fn validate_session_correlation_config(config: &PrSessionCorrelationConfig) -> Result<()> {
    if !(0.0..=1.0).contains(&config.min_confidence) || !config.min_confidence.is_finite() {
        return Err(CoreError::Other(
            "session correlation min confidence must be between 0 and 1".into(),
        ));
    }
    if config.time_window_before_minutes < 0
        || config.time_window_after_minutes < 0
        || config.time_window_before_minutes > 7 * 24 * 60
        || config.time_window_after_minutes > 7 * 24 * 60
    {
        return Err(CoreError::Other(
            "session correlation windows must be between 0 minutes and 7 days".into(),
        ));
    }
    if !(1..=25).contains(&config.max_sessions_per_pr) {
        return Err(CoreError::Other(
            "session correlation max sessions per PR must be between 1 and 25".into(),
        ));
    }
    for weight in [
        config.weights.time_overlap,
        config.weights.temporal_proximity,
        config.weights.branch,
        config.weights.file_touch,
        config.weights.title_keyword,
    ] {
        if !weight.is_finite() || !(0.0..=1.0).contains(&weight) {
            return Err(CoreError::Other(
                "session correlation weights must be between 0 and 1".into(),
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct SessionCandidate {
    provider: String,
    session_id: String,
    started: Option<String>,
    ended: Option<String>,
    project_slug: Option<String>,
    sample_cwd: Option<String>,
    branches: Vec<String>,
    turns: i64,
    tokens: i64,
    prompt_text: String,
}

#[derive(Default)]
struct RepoSessionScope {
    root_like: Option<String>,
    slugs: Vec<String>,
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn normalized_text(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect()
}

fn normalized_file_path(value: &str) -> String {
    value.replace('\\', "/").to_ascii_lowercase()
}

fn keyword_tokens(row: &PrDashboardRow) -> Vec<String> {
    let mut tokens = Vec::new();
    let text = format!(
        "{} {}",
        row.title.as_deref().unwrap_or(""),
        row.head_branch.as_deref().unwrap_or("")
    );
    for token in normalized_text(&text).split_whitespace() {
        if token.len() < 4 {
            continue;
        }
        if matches!(
            token,
            "feat" | "fix" | "main" | "master" | "test" | "tests" | "with" | "from"
        ) {
            continue;
        }
        if !tokens.iter().any(|existing| existing == token) {
            tokens.push(token.to_string());
        }
    }
    tokens
}

fn branch_matches(candidate: &SessionCandidate, head_branch: Option<&str>) -> bool {
    let Some(head) = head_branch.map(str::trim).filter(|b| !b.is_empty()) else {
        return false;
    };
    candidate
        .branches
        .iter()
        .any(|branch| branch.eq_ignore_ascii_case(head))
}

fn candidate_time_signal(
    row: &PrDashboardRow,
    candidate: &SessionCandidate,
    config: &PrSessionCorrelationConfig,
) -> Option<(f64, &'static str)> {
    let created = parse_ts(row.created_at_utc.as_deref())?;
    let active_end = parse_ts(row.merged_at_utc.as_deref())
        .or_else(|| parse_ts(row.closed_at_utc.as_deref()))
        .unwrap_or_else(Utc::now);
    let started = parse_ts(candidate.started.as_deref())?;
    let ended = parse_ts(candidate.ended.as_deref()).unwrap_or(started);
    let overlaps_active_window = ended >= created && started <= active_end;
    if overlaps_active_window {
        return Some((
            config.weights.time_overlap,
            "Session overlaps the PR active window.",
        ));
    }
    let lower = created - Duration::minutes(config.time_window_before_minutes);
    let upper = active_end + Duration::minutes(config.time_window_after_minutes);
    if ended >= lower && started <= upper {
        return Some((
            config.weights.temporal_proximity,
            "Session is near the PR active window.",
        ));
    }
    None
}

fn title_keyword_score(row: &PrDashboardRow, candidate: &SessionCandidate) -> (f64, Vec<String>) {
    let prompt = normalized_text(&candidate.prompt_text);
    if prompt.trim().is_empty() {
        return (0.0, Vec::new());
    }
    let hits: Vec<String> = keyword_tokens(row)
        .into_iter()
        .filter(|token| prompt.contains(token))
        .collect();
    let score = (hits.len() as f64 / 3.0).min(1.0);
    (score, hits)
}

fn pr_opened(row: &PrDashboardRow) -> Option<DateTime<Utc>> {
    parse_ts(row.created_at_utc.as_deref())
}

fn pr_active_end(row: &PrDashboardRow) -> Option<DateTime<Utc>> {
    parse_ts(row.merged_at_utc.as_deref())
        .or_else(|| parse_ts(row.closed_at_utc.as_deref()))
        .or_else(|| Some(Utc::now()))
}

fn utc_string(ts: DateTime<Utc>) -> String {
    ts.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn evaluate_rules(
    rows: &[PrDashboardRow],
    summary: &PrSummary,
    rules: &[PrInsightRule],
) -> Vec<PrInsight> {
    let mut out = Vec::new();
    for rule in rules.iter().filter(|r| r.enabled) {
        if rule.scope == "pr" {
            for row in rows {
                let Some(value) = rule_metric(row, &rule.metric) else {
                    continue;
                };
                if compare(value, &rule.operator, rule.threshold) {
                    out.push(PrInsight {
                        id: format!("{}:{}#{}", rule.id, row.repo_key, row.number),
                        rule_id: rule.id.clone(),
                        title: rule.title.clone(),
                        severity: rule.severity.clone(),
                        category: rule.category.clone(),
                        scope: rule.scope.clone(),
                        metric: rule.metric.clone(),
                        value,
                        threshold: rule.threshold,
                        recommendation: rule.recommendation.clone(),
                        affected_prs: vec![PrRef {
                            repo_key: row.repo_key.clone(),
                            repo_owner: row.repo_owner.clone(),
                            repo_name: row.repo_name.clone(),
                            repo_full_name: row.repo_full_name.clone(),
                            number: row.number,
                            title: row.title.clone(),
                            html_url: row.html_url.clone(),
                        }],
                    });
                }
            }
        } else if let Some(value) = aggregate_metric(summary, &rule.metric) {
            if compare(value, &rule.operator, rule.threshold) {
                let affected_prs = rows
                    .iter()
                    .filter(|row| {
                        row.status_bucket == "awaiting_review"
                            || row.status_bucket == "awaiting_merge"
                    })
                    .take(5)
                    .map(|row| PrRef {
                        repo_key: row.repo_key.clone(),
                        repo_owner: row.repo_owner.clone(),
                        repo_name: row.repo_name.clone(),
                        repo_full_name: row.repo_full_name.clone(),
                        number: row.number,
                        title: row.title.clone(),
                        html_url: row.html_url.clone(),
                    })
                    .collect();
                out.push(PrInsight {
                    id: rule.id.clone(),
                    rule_id: rule.id.clone(),
                    title: rule.title.clone(),
                    severity: rule.severity.clone(),
                    category: rule.category.clone(),
                    scope: rule.scope.clone(),
                    metric: rule.metric.clone(),
                    value,
                    threshold: rule.threshold,
                    recommendation: rule.recommendation.clone(),
                    affected_prs,
                });
            }
        }
    }
    out.sort_by(|a, b| {
        let rank = |s: &str| match s {
            "critical" => 0,
            "warning" => 1,
            _ => 2,
        };
        rank(&a.severity)
            .cmp(&rank(&b.severity))
            .then(a.title.cmp(&b.title))
    });
    out
}

fn repo_identity(
    repo_key: &str,
    owner: Option<String>,
    repo: Option<String>,
    html_url: Option<&str>,
) -> (Option<String>, Option<String>, String) {
    if let (Some(owner), Some(repo)) = (
        owner.filter(|s| !s.is_empty()),
        repo.filter(|s| !s.is_empty()),
    ) {
        let full = format!("{owner}/{repo}");
        return (Some(owner), Some(repo), full);
    }
    if let Some(url) = html_url {
        let parts: Vec<&str> = url.split('/').collect();
        if let Some(pos) = parts.iter().position(|p| *p == "github.com") {
            if let (Some(owner), Some(repo)) = (parts.get(pos + 1), parts.get(pos + 2)) {
                let repo = repo.trim_end_matches(".git");
                return (
                    Some((*owner).to_string()),
                    Some(repo.to_string()),
                    format!("{owner}/{repo}"),
                );
            }
        }
    }
    let fallback = repo_key
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(repo_key)
        .to_string();
    (None, Some(fallback.clone()), fallback)
}

fn lifecycle_event(
    event_type: &str,
    title: &str,
    at: &Option<String>,
    actor: &Option<String>,
) -> Option<PrTimelineEvent> {
    let created_at_utc = at.clone()?;
    Some(PrTimelineEvent {
        event_type: event_type.into(),
        title: Some(title.into()),
        actor: actor.clone(),
        body: None,
        state: None,
        conclusion: None,
        created_at_utc: Some(created_at_utc),
        html_url: None,
    })
}

impl Db {
    pub fn pr_session_correlation_config(&self) -> Result<PrSessionCorrelationConfig> {
        let config = if let Some(raw) = self.get_setting(SESSION_CORRELATION_SETTING)? {
            serde_json::from_str::<PrSessionCorrelationConfig>(&raw)?
        } else {
            PrSessionCorrelationConfig::default()
        };
        validate_session_correlation_config(&config)?;
        Ok(config)
    }

    pub fn set_pr_session_correlation_config(
        &self,
        config: &PrSessionCorrelationConfig,
    ) -> Result<PrSessionCorrelationConfig> {
        validate_session_correlation_config(config)?;
        self.set_setting(SESSION_CORRELATION_SETTING, &serde_json::to_string(config)?)?;
        self.pr_session_correlation_config()
    }

    pub fn pr_insight_rules(&self) -> Result<Vec<PrInsightRule>> {
        let mut rules = builtin_rules();
        if let Some(raw) = self.get_setting(RULES_SETTING)? {
            let custom: Vec<PrInsightRule> = serde_json::from_str(&raw)?;
            for rule in custom {
                validate_rule(&rule)?;
                rules.retain(|existing| existing.id != rule.id);
                rules.push(PrInsightRule {
                    custom: true,
                    ..rule
                });
            }
        }
        Ok(rules)
    }

    pub fn set_custom_pr_insight_rules(
        &self,
        rules: &[PrInsightRule],
    ) -> Result<Vec<PrInsightRule>> {
        let custom: Vec<PrInsightRule> = rules
            .iter()
            .cloned()
            .map(|r| PrInsightRule { custom: true, ..r })
            .collect();
        for rule in &custom {
            validate_rule(rule)?;
        }
        self.set_setting(RULES_SETTING, &serde_json::to_string(&custom)?)?;
        self.pr_insight_rules()
    }

    pub fn pr_dashboard_bundle(
        &self,
        grain: PrGrain,
        author: Option<&str>,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<PrDashboardBundle> {
        let query = PrDashboardQuery {
            grain,
            author,
            since,
            until,
            page: 0,
            page_size: 10_000,
            query: None,
            status: None,
            repo: None,
            org: None,
            sort: Some("created"),
            direction: Some("desc"),
        };
        self.pr_dashboard_bundle_query(&query, true)
    }

    pub fn pr_dashboard_bundle_query(
        &self,
        query: &PrDashboardQuery<'_>,
        include_details: bool,
    ) -> Result<PrDashboardBundle> {
        let session_correlation_config = self.pr_session_correlation_config()?;
        let default_author = self.get_setting("github_login")?;
        let mut authors = self.pr_authors(default_author.as_deref(), query.since, query.until)?;
        let requested = query.author.unwrap_or("").trim();
        let default_configured = default_author
            .as_ref()
            .is_some_and(|login| !login.trim().is_empty());
        let active_author = if requested.is_empty() {
            if default_configured {
                default_author.clone().unwrap_or_else(|| ALL_AUTHORS.into())
            } else {
                ALL_AUTHORS.into()
            }
        } else {
            requested.to_string()
        };
        if !authors.iter().any(|a| a.login == ALL_AUTHORS) {
            let total = authors.iter().map(|a| a.pull_requests).sum();
            authors.insert(
                0,
                PrAuthorOption {
                    login: ALL_AUTHORS.into(),
                    pull_requests: total,
                    is_default: !default_configured,
                },
            );
        }
        let default_author_login = default_author
            .as_ref()
            .map(|login| login.trim())
            .filter(|login| !login.is_empty());
        if let Some(default) = default_author_login {
            if !authors
                .iter()
                .any(|a| a.login.eq_ignore_ascii_case(default))
            {
                authors.insert(
                    1.min(authors.len()),
                    PrAuthorOption {
                        login: default.to_string(),
                        pull_requests: 0,
                        is_default: true,
                    },
                );
            }
        }

        let mut rows = self.pr_dashboard_rows(&active_author, query.since, query.until)?;
        apply_pr_dashboard_filters(&mut rows, query);
        self.attach_pr_ai_indexes(&mut rows)?;
        self.attach_pr_session_correlations(&mut rows, &session_correlation_config)?;
        sort_pr_dashboard_rows(&mut rows, query.sort, query.direction);
        if include_details {
            self.attach_pr_details(&mut rows, &session_correlation_config)?;
        }
        let total_rows = rows.len() as i64;
        let page = query.page.max(0);
        let page_size = query.page_size.clamp(1, 200);
        let pagination = PrPagination {
            page,
            page_size,
            total_rows,
        };
        let (summary, periods) = summarize_rows(&rows, query.grain, query.since, query.until);
        let tiles = analytics_tiles(&summary, &rows);
        let rules = self.pr_insight_rules()?;
        let deterministic_insights = evaluate_rules(&rows, &summary, &rules);
        let filter_options = pr_filter_options(&authors, &rows, &deterministic_insights);
        let offset = (page * page_size).max(0) as usize;
        let rows = rows
            .into_iter()
            .skip(offset)
            .take(page_size as usize)
            .collect::<Vec<_>>();
        Ok(PrDashboardBundle {
            grain: query.grain.as_str().into(),
            active_author,
            default_author,
            authors,
            pagination,
            filter_options,
            summary,
            rows,
            periods,
            tiles,
            deterministic_insights,
            rules,
            session_correlation_config,
        })
    }

    pub fn pr_dashboard_detail(
        &self,
        repo_key: &str,
        number: i64,
    ) -> Result<Option<PrDashboardRow>> {
        let session_correlation_config = self.pr_session_correlation_config()?;
        let Some(mut row) = self.pr_dashboard_row(repo_key, number)? else {
            return Ok(None);
        };
        let mut rows = vec![row];
        self.attach_pr_ai_indexes(&mut rows)?;
        self.attach_pr_details(&mut rows, &session_correlation_config)?;
        row = rows.remove(0);
        Ok(Some(row))
    }

    pub fn pr_deterministic_insights_page(
        &self,
        query: &PrDashboardQuery<'_>,
        category: Option<&str>,
        severity: Option<&str>,
        scope: Option<&str>,
    ) -> Result<PrDeterministicInsightsPage> {
        let mut bundle = self.pr_dashboard_bundle_query(
            &PrDashboardQuery {
                page: 0,
                page_size: 200,
                ..(*query).clone()
            },
            false,
        )?;
        filter_pr_insights(
            &mut bundle.deterministic_insights,
            category,
            severity,
            scope,
        );
        let total_rows = bundle.deterministic_insights.len() as i64;
        let page = query.page.max(0);
        let page_size = query.page_size.clamp(1, 100);
        let offset = (page * page_size).max(0) as usize;
        let rows = bundle
            .deterministic_insights
            .into_iter()
            .skip(offset)
            .take(page_size as usize)
            .collect();
        Ok(PrDeterministicInsightsPage {
            rows,
            pagination: PrPagination {
                page,
                page_size,
                total_rows,
            },
            filter_options: bundle.filter_options,
        })
    }

    fn attach_pr_details(
        &self,
        rows: &mut [PrDashboardRow],
        session_correlation_config: &PrSessionCorrelationConfig,
    ) -> Result<()> {
        self.attach_pr_timelines(rows)?;
        self.attach_pr_files(rows)?;
        self.attach_pr_session_correlations(rows, session_correlation_config)?;
        self.attach_pr_related_commits(rows)?;
        self.attach_pr_related_deployments(rows)?;
        self.attach_pr_related_incidents(rows)?;
        Ok(())
    }

    fn pr_authors(
        &self,
        default_author: Option<&str>,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<PrAuthorOption>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT author, COUNT(*) FROM pull_requests \
             WHERE created_at_utc >= COALESCE(?1, '') \
               AND created_at_utc < COALESCE(?2, '9999-12-31T99:99:99Z') \
               AND author IS NOT NULL AND author <> '' \
             GROUP BY author ORDER BY COUNT(*) DESC, lower(author)",
        )?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                let login: String = r.get(0)?;
                Ok(PrAuthorOption {
                    is_default: default_author.is_some_and(|d| d.eq_ignore_ascii_case(&login)),
                    login,
                    pull_requests: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn pr_dashboard_rows(
        &self,
        author: &str,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<PrDashboardRow>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now();
        let mut stmt = conn.prepare(
            "SELECT pr.repo_key, pr.number, pr.title, COALESCE(pr.state,'open'), pr.author, pr.created_at_utc, \
                    pr.merged_at_utc, pr.closed_at_utc, pr.first_review_at_utc, pr.head_branch, pr.base_branch, \
                    pr.additions, pr.deletions, pr.changed_files, pr.review_count, pr.merge_commit_sha, pr.html_url, \
                    pr.ai_session_overlap, gr.gh_owner, gr.gh_repo, pr.head_sha \
             FROM pull_requests pr \
             LEFT JOIN git_repos gr ON gr.repo_key = pr.repo_key \
             WHERE pr.created_at_utc >= COALESCE(?1, '') \
               AND pr.created_at_utc < COALESCE(?2, '9999-12-31T99:99:99Z') \
               AND (?3 = '__all' OR lower(COALESCE(pr.author,'')) = lower(?3)) \
             ORDER BY pr.created_at_utc DESC, pr.repo_key, pr.number DESC",
        )?;
        let rows = stmt
            .query_map(params![since, until, author], |r| {
                read_pr_dashboard_row(r, now)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn pr_dashboard_row(&self, repo_key: &str, number: i64) -> Result<Option<PrDashboardRow>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now();
        let mut stmt = conn.prepare(
            "SELECT pr.repo_key, pr.number, pr.title, COALESCE(pr.state,'open'), pr.author, pr.created_at_utc, \
                    pr.merged_at_utc, pr.closed_at_utc, pr.first_review_at_utc, pr.head_branch, pr.base_branch, \
                    pr.additions, pr.deletions, pr.changed_files, pr.review_count, pr.merge_commit_sha, pr.html_url, \
                    pr.ai_session_overlap, gr.gh_owner, gr.gh_repo, pr.head_sha \
             FROM pull_requests pr \
             LEFT JOIN git_repos gr ON gr.repo_key = pr.repo_key \
             WHERE pr.repo_key = ?1 AND pr.number = ?2",
        )?;
        let row = stmt
            .query_row(params![repo_key, number], |r| read_pr_dashboard_row(r, now))
            .optional()?;
        Ok(row)
    }

    fn attach_pr_timelines(&self, rows: &mut [PrDashboardRow]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT event_type, title, actor, body, state, conclusion, created_at_utc, html_url \
             FROM pull_request_events WHERE repo_key=?1 AND pr_number=?2 \
             ORDER BY created_at_utc ASC, event_type ASC",
        )?;
        for row in rows {
            let mut events = stmt
                .query_map(params![&row.repo_key, row.number], |r| {
                    Ok(PrTimelineEvent {
                        event_type: r.get(0)?,
                        title: r.get(1)?,
                        actor: r.get(2)?,
                        body: r.get(3)?,
                        state: r.get(4)?,
                        conclusion: r.get(5)?,
                        created_at_utc: r.get(6)?,
                        html_url: r.get(7)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            if events.is_empty() {
                for event in [
                    lifecycle_event("created", "Opened", &row.created_at_utc, &row.author),
                    lifecycle_event("review", "First review", &row.first_review_at_utc, &None),
                    lifecycle_event("merged", "Merged", &row.merged_at_utc, &row.author),
                    lifecycle_event("closed", "Closed", &row.closed_at_utc, &row.author),
                ]
                .into_iter()
                .flatten()
                {
                    events.push(event);
                }
            }
            row.timeline = events;
        }
        Ok(())
    }

    fn attach_pr_files(&self, rows: &mut [PrDashboardRow]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT path, status, additions, deletions, changes, previous_path, blob_url \
             FROM pull_request_files WHERE repo_key=?1 AND pr_number=?2 \
             ORDER BY path ASC",
        )?;
        for row in rows {
            row.files = stmt
                .query_map(params![&row.repo_key, row.number], |r| {
                    Ok(PrFileRef {
                        path: r.get(0)?,
                        status: r.get(1)?,
                        additions: r.get(2)?,
                        deletions: r.get(3)?,
                        changes: r.get(4)?,
                        previous_path: r.get(5)?,
                        blob_url: r.get(6)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
        }
        Ok(())
    }

    fn attach_pr_ai_indexes(&self, rows: &mut [PrDashboardRow]) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let keys = rows
            .iter()
            .map(|row| (row.repo_key.clone(), row.number))
            .collect::<BTreeSet<_>>();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT repo_key, pr_number, index_type, score, grade, category, category_scores_json, \
                    summary, evidence_json, recommendations_json, confidence, engine, input_hash, generated_at_utc \
             FROM pull_request_ai_indexes",
        )?;
        let indexes = stmt
            .query_map([], read_pr_ai_index)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut by_pr: BTreeMap<(String, i64), Vec<PrAiIndex>> = BTreeMap::new();
        for index in indexes {
            let key = (index.repo_key.clone(), index.pr_number);
            if keys.contains(&key) {
                by_pr.entry(key).or_default().push(index);
            }
        }
        for row in rows {
            if let Some(indexes) = by_pr.remove(&(row.repo_key.clone(), row.number)) {
                for index in indexes {
                    match index.index_type.as_str() {
                        "business_value" => row.business_value_index = Some(index),
                        "ai_maturity" => row.ai_maturity_index = Some(index),
                        _ => {}
                    }
                }
            }
        }
        Ok(())
    }

    fn attach_pr_session_correlations(
        &self,
        rows: &mut [PrDashboardRow],
        config: &PrSessionCorrelationConfig,
    ) -> Result<()> {
        for row in rows {
            let mut correlations = if config.enabled {
                self.deterministic_pr_session_correlations(row, config)?
            } else {
                Vec::new()
            };
            correlations.extend(self.persisted_pr_session_correlations(row)?);
            correlations.sort_by(|a, b| {
                b.confidence
                    .partial_cmp(&a.confidence)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut seen = BTreeSet::new();
            correlations.retain(|correlation| {
                seen.insert(format!(
                    "{}:{}:{}",
                    correlation.mode, correlation.provider, correlation.session_id
                ))
            });
            row.session_correlations = correlations;
            if !row.session_correlations.is_empty() {
                row.ai_session_overlap = true;
            }
        }
        Ok(())
    }

    pub fn pr_session_correlation_candidates(
        &self,
        rows: &[PrDashboardRow],
        config: &PrSessionCorrelationConfig,
    ) -> Result<Vec<PrSessionCandidateGroup>> {
        validate_session_correlation_config(config)?;
        let mut groups = Vec::with_capacity(rows.len());
        for row in rows {
            groups.push(PrSessionCandidateGroup {
                repo_key: row.repo_key.clone(),
                pr_number: row.number,
                repo_full_name: row.repo_full_name.clone(),
                title: row.title.clone(),
                candidates: self.deterministic_pr_session_correlations(row, config)?,
            });
        }
        Ok(groups)
    }

    fn deterministic_pr_session_correlations(
        &self,
        row: &PrDashboardRow,
        config: &PrSessionCorrelationConfig,
    ) -> Result<Vec<PrSessionCorrelation>> {
        let candidates = self.query_session_candidates(row, config)?;
        let mut correlations = Vec::new();
        for candidate in candidates {
            let Some((time_weight, time_reason)) = candidate_time_signal(row, &candidate, config)
            else {
                continue;
            };
            let mut score = time_weight;
            let mut reasons = vec![time_reason.to_string()];
            let mut signals = BTreeMap::from([("time".to_string(), time_weight)]);

            if config.use_branch && branch_matches(&candidate, row.head_branch.as_deref()) {
                score += config.weights.branch;
                signals.insert("branch".into(), config.weights.branch);
                if let Some(branch) = row.head_branch.as_deref() {
                    reasons.push(format!("Session branch matched PR head branch `{branch}`."));
                }
            }

            if config.use_file_touches && !row.files.is_empty() {
                let hits =
                    self.file_touch_count(&candidate.provider, &candidate.session_id, row)?;
                if hits > 0 {
                    let weighted = config.weights.file_touch * (hits as f64 / 3.0).min(1.0);
                    score += weighted;
                    signals.insert("file_touch".into(), weighted);
                    reasons.push(format!(
                        "Session tool calls touched {hits} changed file{}.",
                        if hits == 1 { "" } else { "s" }
                    ));
                }
            }

            if config.use_title_keywords {
                let (title_score, hits) = title_keyword_score(row, &candidate);
                if title_score > 0.0 {
                    let weighted = config.weights.title_keyword * title_score;
                    score += weighted;
                    signals.insert("title_keyword".into(), weighted);
                    reasons.push(format!(
                        "Prompt text matched PR keyword{}: {}.",
                        if hits.len() == 1 { "" } else { "s" },
                        hits.join(", ")
                    ));
                }
            }

            let confidence = clamp01(score);
            if confidence < config.min_confidence {
                continue;
            }
            correlations.push(PrSessionCorrelation {
                repo_key: row.repo_key.clone(),
                pr_number: row.number,
                provider: candidate.provider,
                session_id: candidate.session_id,
                mode: "deterministic".into(),
                score: (confidence * 100.0).round(),
                confidence,
                summary: Some(reasons.join(" ")),
                reasons,
                signals,
                session_started_at_utc: candidate.started,
                session_ended_at_utc: candidate.ended,
                project_slug: candidate.project_slug,
                sample_cwd: candidate.sample_cwd,
                turns: candidate.turns,
                tokens: candidate.tokens,
                engine: None,
                input_hash: None,
                generated_at_utc: None,
            });
        }
        correlations.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        correlations.truncate(config.max_sessions_per_pr);
        Ok(correlations)
    }

    fn repo_session_scope(&self, repo_key: &str) -> Result<RepoSessionScope> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT repo_root, primary_slug, slugs_json FROM git_repos WHERE repo_key=?1",
                params![repo_key],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let mut scope = RepoSessionScope::default();
        if let Some((repo_root, primary_slug, slugs_json)) = row {
            if let Some(root) = repo_root.filter(|r| !r.trim().is_empty()) {
                scope.root_like = Some(format!("{}%", root.trim_end_matches(&['\\', '/'][..])));
            }
            if let Some(raw) = slugs_json {
                if let Ok(slugs) = serde_json::from_str::<Vec<String>>(&raw) {
                    scope
                        .slugs
                        .extend(slugs.into_iter().filter(|slug| !slug.trim().is_empty()));
                }
            }
            if scope.slugs.is_empty() {
                if let Some(slug) = primary_slug.filter(|s| !s.trim().is_empty()) {
                    scope.slugs.push(slug);
                }
            }
        }
        if scope.slugs.is_empty() {
            scope.slugs.push(repo_key.to_string());
        }
        scope.slugs.sort();
        scope.slugs.dedup();
        Ok(scope)
    }

    fn query_session_candidates(
        &self,
        row: &PrDashboardRow,
        config: &PrSessionCorrelationConfig,
    ) -> Result<Vec<SessionCandidate>> {
        let Some(created) = row.created_at_utc.as_deref() else {
            return Ok(Vec::new());
        };
        let active_end = row
            .merged_at_utc
            .as_deref()
            .or(row.closed_at_utc.as_deref())
            .unwrap_or(created);
        let scope = self.repo_session_scope(&row.repo_key)?;
        let ph = vec!["?"; scope.slugs.len()].join(",");
        let sql = format!(
            "SELECT m.provider, m.session_id, MIN(m.timestamp), MAX(m.timestamp), \
                    MAX(m.project_slug), MAX(m.cwd), GROUP_CONCAT(DISTINCT COALESCE(m.git_branch,'')), \
                    COALESCE(SUM(CASE WHEN m.type='user' THEN 1 ELSE 0 END),0), \
                    COALESCE(SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + \
                                 m.cache_create_5m_tokens + m.cache_create_1h_tokens),0), \
                    COALESCE(GROUP_CONCAT(CASE WHEN m.type='user' THEN substr(COALESCE(m.prompt_text,''),1,240) END, ' '),'') \
             FROM messages m \
             WHERE (m.project_slug IN ({ph}) OR (? <> '' AND m.cwd LIKE ?)) \
             GROUP BY m.provider, m.session_id \
             HAVING datetime(MAX(m.timestamp)) >= datetime(?, ?) \
                AND datetime(MIN(m.timestamp)) <= datetime(?, ?) \
             ORDER BY MAX(m.timestamp) DESC LIMIT 200"
        );
        let root_like = scope.root_like.unwrap_or_default();
        let before = format!("-{} minutes", config.time_window_before_minutes);
        let after = format!("+{} minutes", config.time_window_after_minutes);
        let mut values = scope.slugs;
        values.push(root_like.clone());
        values.push(root_like);
        values.push(created.to_string());
        values.push(before);
        values.push(active_end.to_string());
        values.push(after);

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(values.iter()), |r| {
                let branches: Option<String> = r.get(6)?;
                Ok(SessionCandidate {
                    provider: r.get(0)?,
                    session_id: r.get(1)?,
                    started: r.get(2)?,
                    ended: r.get(3)?,
                    project_slug: r.get(4)?,
                    sample_cwd: r.get(5)?,
                    branches: branches
                        .unwrap_or_default()
                        .split(',')
                        .map(str::trim)
                        .filter(|branch| !branch.is_empty())
                        .map(str::to_string)
                        .collect(),
                    turns: r.get(7)?,
                    tokens: r.get(8)?,
                    prompt_text: r.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn file_touch_count(
        &self,
        provider: &str,
        session_id: &str,
        row: &PrDashboardRow,
    ) -> Result<usize> {
        let files: Vec<String> = row
            .files
            .iter()
            .map(|file| normalized_file_path(&file.path))
            .filter(|path| !path.is_empty())
            .collect();
        if files.is_empty() {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT target FROM tool_calls \
             WHERE provider=?1 AND session_id=?2 AND target IS NOT NULL LIMIT 500",
        )?;
        let targets = stmt
            .query_map(params![provider, session_id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut hits = BTreeSet::new();
        for target in targets {
            let normalized = normalized_file_path(&target);
            for file in &files {
                if normalized.ends_with(file) || normalized.contains(file) {
                    hits.insert(file.clone());
                }
            }
        }
        Ok(hits.len())
    }

    fn persisted_pr_session_correlations(
        &self,
        row: &PrDashboardRow,
    ) -> Result<Vec<PrSessionCorrelation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT repo_key, pr_number, provider, session_id, mode, score, confidence, summary, \
                    reasons_json, signals_json, session_started_at_utc, session_ended_at_utc, \
                    project_slug, sample_cwd, turns, tokens, engine, input_hash, generated_at_utc \
             FROM pull_request_session_correlations WHERE repo_key=?1 AND pr_number=?2 \
             ORDER BY confidence DESC",
        )?;
        let rows = stmt
            .query_map(
                params![&row.repo_key, row.number],
                read_pr_session_correlation,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn attach_pr_related_commits(&self, rows: &mut [PrDashboardRow]) -> Result<()> {
        for row in rows {
            row.related_commits = self.pr_related_commits(row)?;
        }
        Ok(())
    }

    fn pr_related_commits(&self, row: &PrDashboardRow) -> Result<Vec<PrRelatedCommit>> {
        let Some(opened) = pr_opened(row) else {
            return Ok(Vec::new());
        };
        let end = pr_active_end(row).unwrap_or(opened) + Duration::hours(24);
        let start = opened - Duration::hours(24);
        let start_s = utc_string(start);
        let end_s = utc_string(end);
        let merge_sha = row.merge_commit_sha.as_deref().unwrap_or("");
        let head_sha = row.head_sha.as_deref().unwrap_or("");
        let head_branch = row.head_branch.as_deref().unwrap_or("");
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT sha, authored_at_utc, author_name, author_email, subject, branch, \
                    files_changed, insertions, deletions, ai_session_overlap, ai_coauthor_trailer, \
                    CASE \
                      WHEN ?4 <> '' AND sha = ?4 THEN 'merge_sha' \
                      WHEN ?5 <> '' AND sha = ?5 THEN 'head_sha' \
                      WHEN ?6 <> '' AND lower(COALESCE(branch,'')) = lower(?6) THEN 'branch_window' \
                      ELSE 'time_window' END \
             FROM commits \
             WHERE repo_key=?1 AND ( \
                (?4 <> '' AND sha=?4) OR (?5 <> '' AND sha=?5) OR \
                (authored_at_utc >= ?2 AND authored_at_utc <= ?3) \
             ) \
             ORDER BY authored_at_utc ASC LIMIT 50",
        )?;
        let rows = stmt
            .query_map(
                params![
                    &row.repo_key,
                    start_s,
                    end_s,
                    merge_sha,
                    head_sha,
                    head_branch
                ],
                |r| {
                    let overlap = r.get::<_, i64>(9)? != 0;
                    let trailer = r.get::<_, i64>(10)? != 0;
                    Ok(PrRelatedCommit {
                        sha: r.get(0)?,
                        authored_at_utc: r.get(1)?,
                        author_name: r.get(2)?,
                        author_email: r.get(3)?,
                        subject: r.get(4)?,
                        branch: r.get(5)?,
                        files_changed: r.get(6)?,
                        insertions: r.get(7)?,
                        deletions: r.get(8)?,
                        ai_assisted: overlap || trailer,
                        match_reason: r.get(11)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn attach_pr_related_deployments(&self, rows: &mut [PrDashboardRow]) -> Result<()> {
        for row in rows {
            row.related_deployments = self.pr_related_deployments(row)?;
        }
        Ok(())
    }

    fn pr_related_deployments(&self, row: &PrDashboardRow) -> Result<Vec<PrDeploymentRef>> {
        let Some(merged) = parse_ts(row.merged_at_utc.as_deref()) else {
            return Ok(Vec::new());
        };
        let end = merged + Duration::days(14);
        let merged_s = utc_string(merged);
        let end_s = utc_string(end);
        let merge_sha = row.merge_commit_sha.as_deref().unwrap_or("");
        let head_sha = row.head_sha.as_deref().unwrap_or("");
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT kind, ext_id, name, created_at_utc, status, sha, html_url, \
                    CASE WHEN created_at_utc IS NOT NULL \
                         THEN (julianday(created_at_utc)-julianday(?2))*24.0 ELSE NULL END, \
                    CASE \
                      WHEN ?4 <> '' AND COALESCE(sha,'') = ?4 THEN 'merge_sha' \
                      WHEN ?5 <> '' AND COALESCE(sha,'') = ?5 THEN 'head_sha' \
                      ELSE 'post_merge_window' END \
             FROM deployments \
             WHERE repo_key=?1 AND ( \
                (?4 <> '' AND COALESCE(sha,'')=?4) OR (?5 <> '' AND COALESCE(sha,'')=?5) OR \
                (created_at_utc >= ?2 AND created_at_utc <= ?3) \
             ) \
             ORDER BY created_at_utc ASC LIMIT 20",
        )?;
        let rows = stmt
            .query_map(
                params![&row.repo_key, merged_s, end_s, merge_sha, head_sha],
                |r| {
                    Ok(PrDeploymentRef {
                        kind: r.get(0)?,
                        ext_id: r.get(1)?,
                        name: r.get(2)?,
                        created_at_utc: r.get(3)?,
                        status: r.get(4)?,
                        sha: r.get(5)?,
                        html_url: r.get(6)?,
                        lead_time_hours: r.get(7)?,
                        match_reason: r.get(8)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn attach_pr_related_incidents(&self, rows: &mut [PrDashboardRow]) -> Result<()> {
        for row in rows {
            row.related_incidents = self.pr_related_incidents(row)?;
        }
        Ok(())
    }

    fn pr_related_incidents(&self, row: &PrDashboardRow) -> Result<Vec<PrIncidentRef>> {
        let Some(merged) = parse_ts(row.merged_at_utc.as_deref()) else {
            return Ok(Vec::new());
        };
        let end = merged + Duration::days(14);
        let merged_s = utc_string(merged);
        let end_s = utc_string(end);
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT source, ext_id, title, severity, opened_at_utc, resolved_at_utc, state, html_url, \
                    deploy_ext_id, \
                    CASE WHEN resolved_at_utc IS NOT NULL AND opened_at_utc IS NOT NULL \
                         THEN (julianday(resolved_at_utc)-julianday(opened_at_utc))*24.0 ELSE NULL END, \
                    CASE WHEN opened_at_utc IS NOT NULL \
                         THEN (julianday(opened_at_utc)-julianday(?2))*24.0 ELSE NULL END, \
                    CASE WHEN deploy_ext_id IS NOT NULL THEN 'linked_deployment' ELSE 'post_merge_window' END \
             FROM incidents \
             WHERE repo_key=?1 AND opened_at_utc >= ?2 AND opened_at_utc <= ?3 \
             ORDER BY opened_at_utc ASC LIMIT 20",
        )?;
        let rows = stmt
            .query_map(params![&row.repo_key, merged_s, end_s], |r| {
                Ok(PrIncidentRef {
                    source: r.get(0)?,
                    ext_id: r.get(1)?,
                    title: r.get(2)?,
                    severity: r.get(3)?,
                    opened_at_utc: r.get(4)?,
                    resolved_at_utc: r.get(5)?,
                    state: r.get(6)?,
                    html_url: r.get(7)?,
                    deploy_ext_id: r.get(8)?,
                    mttr_hours: r.get(9)?,
                    hours_after_merge: r.get(10)?,
                    match_reason: r.get(11)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn replace_pr_session_correlations(
        &self,
        mode: &str,
        targets: &[(String, i64)],
        correlations: &[PrSessionCorrelation],
    ) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for (repo_key, pr_number) in targets {
            tx.execute(
                "DELETE FROM pull_request_session_correlations \
                 WHERE repo_key=?1 AND pr_number=?2 AND mode=?3",
                params![repo_key, pr_number, mode],
            )?;
        }
        let mut n = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO pull_request_session_correlations \
                 (repo_key, pr_number, provider, session_id, mode, score, confidence, summary, \
                  reasons_json, signals_json, session_started_at_utc, session_ended_at_utc, \
                  project_slug, sample_cwd, turns, tokens, engine, input_hash, generated_at_utc) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            )?;
            for correlation in correlations {
                let reasons = serde_json::to_string(&correlation.reasons)?;
                let signals = serde_json::to_string(&correlation.signals)?;
                n += stmt.execute(params![
                    correlation.repo_key,
                    correlation.pr_number,
                    correlation.provider,
                    correlation.session_id,
                    correlation.mode,
                    correlation.score,
                    clamp01(correlation.confidence),
                    correlation.summary,
                    reasons,
                    signals,
                    correlation.session_started_at_utc,
                    correlation.session_ended_at_utc,
                    correlation.project_slug,
                    correlation.sample_cwd,
                    correlation.turns,
                    correlation.tokens,
                    correlation.engine,
                    correlation.input_hash,
                    correlation.generated_at_utc,
                ])?;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn upsert_pr_ai_indexes(&self, indexes: &[PrAiIndex]) -> Result<usize> {
        if indexes.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut n = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO pull_request_ai_indexes \
                 (repo_key, pr_number, index_type, score, grade, category, category_scores_json, summary, \
                  evidence_json, recommendations_json, confidence, engine, input_hash, generated_at_utc) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            )?;
            for index in indexes {
                let category_scores = serde_json::to_string(&index.category_scores)?;
                let evidence = serde_json::to_string(&index.evidence)?;
                let recommendations = serde_json::to_string(&index.recommendations)?;
                n += stmt.execute(params![
                    index.repo_key,
                    index.pr_number,
                    index.index_type,
                    index.score.clamp(0, 100),
                    index.grade,
                    index.category,
                    category_scores,
                    index.summary,
                    evidence,
                    recommendations,
                    index.confidence,
                    index.engine,
                    index.input_hash,
                    index.generated_at_utc,
                ])?;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn pr_repo_roots(&self, repo_keys: &[String]) -> Result<BTreeMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT repo_root FROM git_repos WHERE repo_key=?1")?;
        let mut roots = BTreeMap::new();
        for repo_key in repo_keys {
            if roots.contains_key(repo_key) {
                continue;
            }
            let root = stmt
                .query_row(params![repo_key], |r| r.get::<_, String>(0))
                .optional()?;
            if let Some(root) = root {
                roots.insert(repo_key.clone(), root);
            }
        }
        Ok(roots)
    }
}

fn read_pr_dashboard_row(r: &Row<'_>, now: DateTime<Utc>) -> rusqlite::Result<PrDashboardRow> {
    let repo_key: String = r.get(0)?;
    let created_at_utc: Option<String> = r.get(5)?;
    let merged_at_utc: Option<String> = r.get(6)?;
    let closed_at_utc: Option<String> = r.get(7)?;
    let first_review_at_utc: Option<String> = r.get(8)?;
    let created = parse_ts(created_at_utc.as_deref());
    let merged = parse_ts(merged_at_utc.as_deref());
    let first_review = parse_ts(first_review_at_utc.as_deref());
    let state: String = r.get(3)?;
    let review_count: i64 = r.get(14)?;
    let additions: i64 = r.get(11)?;
    let deletions: i64 = r.get(12)?;
    let html_url: Option<String> = r.get(16)?;
    let repo_owner: Option<String> = r.get(18)?;
    let repo_name: Option<String> = r.get(19)?;
    let head_sha: Option<String> = r.get(20)?;
    let (repo_owner, repo_name, repo_full_name) =
        repo_identity(&repo_key, repo_owner, repo_name, html_url.as_deref());
    let bucket = status_bucket(&state, merged, first_review, review_count);
    Ok(PrDashboardRow {
        repo_key,
        repo_owner,
        repo_name,
        repo_full_name,
        number: r.get(1)?,
        title: r.get(2)?,
        state,
        status_bucket: bucket,
        author: r.get(4)?,
        created_at_utc,
        merged_at_utc,
        closed_at_utc,
        first_review_at_utc,
        head_branch: r.get(9)?,
        base_branch: r.get(10)?,
        additions,
        deletions,
        size: additions + deletions,
        changed_files: r.get(13)?,
        review_count,
        merge_commit_sha: r.get(15)?,
        head_sha,
        html_url,
        ai_session_overlap: r.get::<_, i64>(17)? != 0,
        churn: additions + deletions,
        age_hours: created.map(|c| hours_between(c, now)),
        cycle_hours: created.and_then(|c| merged.map(|m| hours_between(c, m))),
        review_wait_hours: created.and_then(|c| first_review.map(|fr| hours_between(c, fr))),
        timeline: Vec::new(),
        files: Vec::new(),
        session_correlations: Vec::new(),
        related_commits: Vec::new(),
        related_deployments: Vec::new(),
        related_incidents: Vec::new(),
        business_value_index: None,
        ai_maturity_index: None,
    })
}

fn apply_pr_dashboard_filters(rows: &mut Vec<PrDashboardRow>, query: &PrDashboardQuery<'_>) {
    let text = query.query.map(str::trim).filter(|v| !v.is_empty());
    let status = query
        .status
        .map(str::trim)
        .filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("all") && *v != ALL_AUTHORS);
    let repo = query
        .repo
        .map(str::trim)
        .filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("all") && *v != ALL_AUTHORS);
    let org = query
        .org
        .map(str::trim)
        .filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("all") && *v != ALL_AUTHORS);
    rows.retain(|row| {
        status.is_none_or(|value| row.status_bucket.eq_ignore_ascii_case(value))
            && repo.is_none_or(|value| {
                row.repo_key.eq_ignore_ascii_case(value)
                    || row.repo_full_name.eq_ignore_ascii_case(value)
            })
            && org.is_none_or(|value| {
                row.repo_owner
                    .as_deref()
                    .is_some_and(|owner| owner.eq_ignore_ascii_case(value))
            })
            && text.is_none_or(|value| pr_row_matches_text(row, value))
    });
}

fn pr_row_matches_text(row: &PrDashboardRow, query: &str) -> bool {
    let q = query.to_ascii_lowercase();
    [
        row.repo_key.as_str(),
        row.repo_full_name.as_str(),
        row.title.as_deref().unwrap_or(""),
        row.author.as_deref().unwrap_or(""),
        row.head_branch.as_deref().unwrap_or(""),
        row.base_branch.as_deref().unwrap_or(""),
    ]
    .join(" ")
    .to_ascii_lowercase()
    .contains(&q)
        || row.number.to_string().contains(&q)
}

fn sort_pr_dashboard_rows(
    rows: &mut [PrDashboardRow],
    sort: Option<&str>,
    direction: Option<&str>,
) {
    let sort = match sort.unwrap_or("created").to_ascii_lowercase().as_str() {
        "number" | "title" | "repo" | "author" | "status" | "size" | "changed_files"
        | "review_wait" | "cycle" | "business_value" | "ai_maturity" | "created" => {
            sort.unwrap_or("created").to_ascii_lowercase()
        }
        _ => "created".into(),
    };
    rows.sort_by(|a, b| match sort.as_str() {
        "number" => a.number.cmp(&b.number),
        "title" => cmp_lower(a.title.as_deref(), b.title.as_deref()),
        "repo" => cmp_lower(Some(&a.repo_full_name), Some(&b.repo_full_name)),
        "author" => cmp_lower(a.author.as_deref(), b.author.as_deref()),
        "status" => a.status_bucket.cmp(&b.status_bucket),
        "size" => a.size.cmp(&b.size),
        "changed_files" => a.changed_files.cmp(&b.changed_files),
        "review_wait" => cmp_opt_f64(a.review_wait_hours, b.review_wait_hours),
        "cycle" => cmp_opt_f64(a.cycle_hours, b.cycle_hours),
        "business_value" => cmp_opt_i64(
            a.business_value_index.as_ref().map(|index| index.score),
            b.business_value_index.as_ref().map(|index| index.score),
        ),
        "ai_maturity" => cmp_opt_i64(
            a.ai_maturity_index.as_ref().map(|index| index.score),
            b.ai_maturity_index.as_ref().map(|index| index.score),
        ),
        _ => cmp_lower(a.created_at_utc.as_deref(), b.created_at_utc.as_deref()),
    });
    if !direction
        .unwrap_or("desc")
        .trim()
        .eq_ignore_ascii_case("asc")
    {
        rows.reverse();
    }
}

fn cmp_lower(a: Option<&str>, b: Option<&str>) -> std::cmp::Ordering {
    a.unwrap_or("")
        .to_ascii_lowercase()
        .cmp(&b.unwrap_or("").to_ascii_lowercase())
}

fn cmp_opt_f64(a: Option<f64>, b: Option<f64>) -> std::cmp::Ordering {
    a.unwrap_or(f64::NEG_INFINITY)
        .partial_cmp(&b.unwrap_or(f64::NEG_INFINITY))
        .unwrap_or(std::cmp::Ordering::Equal)
}

fn cmp_opt_i64(a: Option<i64>, b: Option<i64>) -> std::cmp::Ordering {
    a.unwrap_or(i64::MIN).cmp(&b.unwrap_or(i64::MIN))
}

fn pr_filter_options(
    authors: &[PrAuthorOption],
    rows: &[PrDashboardRow],
    insights: &[PrInsight],
) -> PrFilterOptions {
    let mut repos = BTreeSet::new();
    let mut orgs = BTreeSet::new();
    let mut statuses = BTreeSet::new();
    for row in rows {
        if !row.repo_full_name.is_empty() {
            repos.insert(row.repo_full_name.clone());
        }
        if let Some(owner) = row.repo_owner.as_ref().filter(|owner| !owner.is_empty()) {
            orgs.insert(owner.clone());
        }
        statuses.insert(row.status_bucket.clone());
    }
    let mut categories = BTreeSet::new();
    let mut severities = BTreeSet::new();
    let mut scopes = BTreeSet::new();
    for insight in insights {
        categories.insert(insight.category.clone());
        severities.insert(insight.severity.clone());
        scopes.insert(insight.scope.clone());
        for pr in &insight.affected_prs {
            if !pr.repo_full_name.is_empty() {
                repos.insert(pr.repo_full_name.clone());
            }
            if let Some(owner) = pr.repo_owner.as_ref().filter(|owner| !owner.is_empty()) {
                orgs.insert(owner.clone());
            }
        }
    }
    PrFilterOptions {
        authors: authors.iter().map(|author| author.login.clone()).collect(),
        repos: repos.into_iter().collect(),
        orgs: orgs.into_iter().collect(),
        statuses: statuses.into_iter().collect(),
        insight_categories: categories.into_iter().collect(),
        insight_severities: severities.into_iter().collect(),
        insight_scopes: scopes.into_iter().collect(),
    }
}

fn filter_pr_insights(
    insights: &mut Vec<PrInsight>,
    category: Option<&str>,
    severity: Option<&str>,
    scope: Option<&str>,
) {
    let category = category
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"));
    let severity = severity
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"));
    let scope = scope
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"));
    insights.retain(|insight| {
        category.is_none_or(|value| insight.category.eq_ignore_ascii_case(value))
            && severity.is_none_or(|value| insight.severity.eq_ignore_ascii_case(value))
            && scope.is_none_or(|value| insight.scope.eq_ignore_ascii_case(value))
    });
}

fn read_pr_ai_index(r: &rusqlite::Row<'_>) -> rusqlite::Result<PrAiIndex> {
    let category_scores_json: String = r.get(6)?;
    let evidence_json: String = r.get(8)?;
    let recommendations_json: String = r.get(9)?;
    Ok(PrAiIndex {
        repo_key: r.get(0)?,
        pr_number: r.get(1)?,
        index_type: r.get(2)?,
        score: r.get(3)?,
        grade: r.get(4)?,
        category: r.get(5)?,
        category_scores: serde_json::from_str(&category_scores_json).unwrap_or_default(),
        summary: r.get(7)?,
        evidence: serde_json::from_str(&evidence_json).unwrap_or_default(),
        recommendations: serde_json::from_str(&recommendations_json).unwrap_or_default(),
        confidence: r.get(10)?,
        engine: r.get(11)?,
        input_hash: r.get(12)?,
        generated_at_utc: r.get(13)?,
    })
}

fn read_pr_session_correlation(r: &rusqlite::Row<'_>) -> rusqlite::Result<PrSessionCorrelation> {
    let reasons_json: String = r.get(8)?;
    let signals_json: String = r.get(9)?;
    Ok(PrSessionCorrelation {
        repo_key: r.get(0)?,
        pr_number: r.get(1)?,
        provider: r.get(2)?,
        session_id: r.get(3)?,
        mode: r.get(4)?,
        score: r.get(5)?,
        confidence: r.get(6)?,
        summary: r.get(7)?,
        reasons: serde_json::from_str(&reasons_json).unwrap_or_default(),
        signals: serde_json::from_str(&signals_json).unwrap_or_default(),
        session_started_at_utc: r.get(10)?,
        session_ended_at_utc: r.get(11)?,
        project_slug: r.get(12)?,
        sample_cwd: r.get(13)?,
        turns: r.get(14)?,
        tokens: r.get(15)?,
        engine: r.get(16)?,
        input_hash: r.get(17)?,
        generated_at_utc: r.get(18)?,
    })
}

fn summarize_rows(
    rows: &[PrDashboardRow],
    grain: PrGrain,
    since: Option<&str>,
    until: Option<&str>,
) -> (PrSummary, Vec<PrPeriodRow>) {
    let mut summary = PrSummary {
        total: rows.len() as i64,
        ..PrSummary::default()
    };
    let mut cycle_sum = 0.0;
    let mut cycle_count = 0;
    let mut review_sum = 0.0;
    let mut review_count = 0;
    let mut churn_sum = 0.0;
    let mut periods: BTreeMap<String, PeriodAcc> = BTreeMap::new();
    for row in rows {
        if row.ai_session_overlap {
            summary.ai_assisted += 1;
        } else {
            summary.no_ai_signal += 1;
        }
        match row.status_bucket.as_str() {
            "merged" => summary.merged += 1,
            "closed" => summary.closed += 1,
            "awaiting_merge" => {
                summary.open += 1;
                summary.awaiting_merge += 1;
            }
            _ => {
                summary.open += 1;
                summary.awaiting_review += 1;
            }
        }
        if row.age_hours.is_some_and(|h| h >= 24.0)
            && row.status_bucket != "merged"
            && row.status_bucket != "closed"
        {
            summary.high_review_time += 1;
        }
        if let Some(c) = row.cycle_hours {
            cycle_sum += c;
            cycle_count += 1;
        }
        if let Some(r) = row.review_wait_hours {
            review_sum += r;
            review_count += 1;
        }
        churn_sum += row.churn as f64;

        if let Some(created) = parse_ts(row.created_at_utc.as_deref()) {
            let key = period_key(created, grain);
            let p = periods.entry(key).or_default();
            p.opened += 1;
            if row.ai_session_overlap {
                p.ai_assisted += 1;
            }
            if let Some(wait) = row.review_wait_hours {
                p.review_sum += wait;
                p.review_count += 1;
            }
        }
        if let Some(merged) = parse_ts(row.merged_at_utc.as_deref()) {
            let key = period_key(merged, grain);
            let p = periods.entry(key).or_default();
            p.merged += 1;
            if let Some(cycle) = row.cycle_hours {
                p.cycle_sum += cycle;
                p.cycle_count += 1;
            }
        }
    }

    summary.avg_cycle_hours = avg(cycle_sum, cycle_count);
    summary.avg_review_wait_hours = avg(review_sum, review_count);
    summary.avg_churn = avg(churn_sum, summary.total);
    summary.merge_frequency_per_week = Some(merge_frequency(summary.merged, since, until));

    let period_rows = periods
        .into_iter()
        .map(|(period, p)| PrPeriodRow {
            period,
            opened: p.opened,
            merged: p.merged,
            ai_assisted: p.ai_assisted,
            avg_cycle_hours: avg(p.cycle_sum, p.cycle_count),
            avg_review_wait_hours: avg(p.review_sum, p.review_count),
        })
        .collect();

    (summary, period_rows)
}

fn merge_frequency(merged: i64, since: Option<&str>, until: Option<&str>) -> f64 {
    let span_days = parse_ts(until)
        .zip(parse_ts(since))
        .map(|(u, s)| (u - s).num_hours().max(24) as f64 / 24.0)
        .unwrap_or(7.0)
        .max(1.0);
    merged as f64 / (span_days / 7.0)
}

fn analytics_tiles(summary: &PrSummary, rows: &[PrDashboardRow]) -> Vec<PrAnalyticsTile> {
    let hours = |v: Option<f64>| v.map(|h| format!("{:.1}", h)).unwrap_or_else(|| "-".into());
    let num = |v: Option<f64>| v.map(|n| format!("{:.1}", n)).unwrap_or_else(|| "-".into());
    let (business_avg, business_count) = avg_index_score(
        rows.iter()
            .filter_map(|row| row.business_value_index.as_ref()),
    );
    let (maturity_avg, maturity_count) =
        avg_index_score(rows.iter().filter_map(|row| row.ai_maturity_index.as_ref()));
    let expected_indexes = (rows.len() * 2) as i64;
    let generated_indexes = business_count + maturity_count;
    let index_coverage = pct(generated_indexes, expected_indexes);
    let correlated_prs = rows
        .iter()
        .filter(|row| !row.session_correlations.is_empty())
        .count() as i64;
    let ai_session_matches = rows
        .iter()
        .flat_map(|row| row.session_correlations.iter())
        .filter(|correlation| correlation.mode == "ai")
        .count() as i64;
    let merged_rows = rows
        .iter()
        .filter(|row| row.status_bucket == "merged")
        .count() as i64;
    let deployed_prs = rows
        .iter()
        .filter(|row| !row.related_deployments.is_empty())
        .count() as i64;
    let post_merge_incidents = rows
        .iter()
        .flat_map(|row| row.related_incidents.iter())
        .count() as i64;

    let mut tiles = vec![
        PrAnalyticsTile {
            key: "cycle_time".into(),
            label: "PR cycle time".into(),
            value: hours(summary.avg_cycle_hours),
            unit: Some("hours".into()),
            detail: "Created to merged for merged PRs.".into(),
            severity: if summary.avg_cycle_hours.unwrap_or(0.0) >= 48.0 {
                "warning"
            } else {
                "info"
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "review_wait".into(),
            label: "Review wait".into(),
            value: hours(summary.avg_review_wait_hours),
            unit: Some("hours".into()),
            detail: "Created to first review when available.".into(),
            severity: if summary.avg_review_wait_hours.unwrap_or(0.0) >= 24.0 {
                "critical"
            } else {
                "info"
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "merge_frequency".into(),
            label: "Merge frequency".into(),
            value: num(summary.merge_frequency_per_week),
            unit: Some("PRs/week".into()),
            detail: "Merged PRs normalized by selected range.".into(),
            severity: "info".into(),
        },
        PrAnalyticsTile {
            key: "pr_size".into(),
            label: "PR size".into(),
            value: num(summary.avg_churn),
            unit: Some("lines".into()),
            detail: "Average additions plus deletions.".into(),
            severity: if summary.avg_churn.unwrap_or(0.0) >= 500.0 {
                "warning"
            } else {
                "info"
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "ai_share".into(),
            label: "AI-assisted share".into(),
            value: format!("{:.0}", pct(summary.ai_assisted, summary.total)),
            unit: Some("%".into()),
            detail: "PRs with legacy overlap or configured session correlation.".into(),
            severity: "info".into(),
        },
        PrAnalyticsTile {
            key: "stale_open".into(),
            label: "Stale open queue".into(),
            value: summary.high_review_time.to_string(),
            unit: Some("PRs".into()),
            detail: "Open PRs older than 24 hours.".into(),
            severity: if summary.high_review_time > 0 {
                "warning"
            } else {
                "info"
            }
            .into(),
        },
    ];
    tiles.extend([
        PrAnalyticsTile {
            key: "session_correlation".into(),
            label: "PR-session correlation".into(),
            value: format!("{:.0}", pct(correlated_prs, summary.total)),
            unit: Some("%".into()),
            detail: format!(
                "{} of {} PRs have deterministic or AI session matches.",
                correlated_prs, summary.total
            ),
            severity: if correlated_prs == 0 && summary.total > 0 {
                "warning"
            } else {
                "info"
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "ai_session_matches".into(),
            label: "AI session matches".into(),
            value: ai_session_matches.to_string(),
            unit: Some("matches".into()),
            detail: "Persisted PR-session matches generated by a local AI CLI.".into(),
            severity: "info".into(),
        },
        PrAnalyticsTile {
            key: "deployment_coverage".into(),
            label: "Deployment coverage".into(),
            value: format!("{:.0}", pct(deployed_prs, merged_rows)),
            unit: Some("%".into()),
            detail: format!(
                "{} of {} merged PRs have a matching deploy signal.",
                deployed_prs, merged_rows
            ),
            severity: if merged_rows > 0 && deployed_prs == 0 {
                "warning"
            } else {
                "info"
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "post_merge_incidents".into(),
            label: "Post-merge incidents".into(),
            value: post_merge_incidents.to_string(),
            unit: Some("incidents".into()),
            detail: "Incidents opened within 14 days after merge on the same repo.".into(),
            severity: if post_merge_incidents > 0 {
                "critical"
            } else {
                "info"
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "business_value_avg".into(),
            label: "Business Value Index".into(),
            value: business_avg
                .map(|v| format!("{v:.0}"))
                .unwrap_or_else(|| "-".into()),
            unit: Some("avg".into()),
            detail: format!("{} of {} PRs scored.", business_count, rows.len()),
            severity: match business_avg {
                Some(v) if v < 40.0 => "warning",
                Some(_) => "info",
                None => "warning",
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "ai_maturity_avg".into(),
            label: "AI Maturity".into(),
            value: maturity_avg
                .map(|v| format!("{v:.0}"))
                .unwrap_or_else(|| "-".into()),
            unit: Some("avg".into()),
            detail: format!("{} of {} PRs scored.", maturity_count, rows.len()),
            severity: match maturity_avg {
                Some(v) if v < 40.0 => "warning",
                Some(_) => "info",
                None => "warning",
            }
            .into(),
        },
        PrAnalyticsTile {
            key: "ai_index_coverage".into(),
            label: "AI index coverage".into(),
            value: format!("{index_coverage:.0}"),
            unit: Some("%".into()),
            detail: format!(
                "{} of {} possible PR index values generated.",
                generated_indexes, expected_indexes
            ),
            severity: if index_coverage < 50.0 {
                "warning"
            } else {
                "info"
            }
            .into(),
        },
    ]);
    tiles
}

fn avg_index_score<'a>(indexes: impl Iterator<Item = &'a PrAiIndex>) -> (Option<f64>, i64) {
    let mut sum = 0.0;
    let mut count = 0;
    for index in indexes {
        sum += index.score.clamp(0, 100) as f64;
        count += 1;
    }
    (avg(sum, count), count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CommitRow, DeploymentRow, IncidentRow, PullRequestFileRow, PullRequestRow};
    use rusqlite::params;

    fn pr(
        n: i64,
        author: &str,
        created: &str,
        merged: Option<&str>,
        review: Option<&str>,
        additions: i64,
        deletions: i64,
    ) -> PullRequestRow {
        PullRequestRow {
            number: n,
            title: Some(format!("PR {n}")),
            state: Some(if merged.is_some() { "merged" } else { "open" }.into()),
            author: Some(author.into()),
            created_at_utc: Some(created.into()),
            merged_at_utc: merged.map(str::to_string),
            closed_at_utc: None,
            head_branch: Some("feature".into()),
            base_branch: Some("main".into()),
            additions,
            deletions,
            changed_files: 3,
            review_count: i64::from(review.is_some()),
            first_review_at_utc: review.map(str::to_string),
            merge_commit_sha: None,
            head_sha: None,
            html_url: None,
        }
    }

    #[test]
    fn bundle_filters_default_author_and_evaluates_rules() {
        let db = Db::open_in_memory().unwrap();
        db.set_setting("github_login", "alice").unwrap();
        db.insert_pull_requests(
            "repo",
            &[
                pr(
                    1,
                    "alice",
                    "2026-01-01T00:00:00Z",
                    Some("2026-01-03T00:00:00Z"),
                    Some("2026-01-02T02:00:00Z"),
                    900,
                    100,
                ),
                pr(2, "bob", "2026-01-01T00:00:00Z", None, None, 5, 1),
            ],
        )
        .unwrap();
        let bundle = db
            .pr_dashboard_bundle(
                PrGrain::Week,
                None,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-10T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(bundle.active_author, "alice");
        assert_eq!(bundle.rows.len(), 1);
        assert_eq!(bundle.rows[0].repo_full_name, "repo");
        assert_eq!(bundle.rows[0].size, 1000);
        assert_eq!(bundle.summary.merged, 1);
        assert!(bundle
            .deterministic_insights
            .iter()
            .any(|i| i.rule_id == "large-pr"));
        assert!(bundle
            .deterministic_insights
            .iter()
            .any(|i| i.rule_id == "slow-first-review"));
    }

    #[test]
    fn custom_rules_replace_builtins_by_id() {
        let db = Db::open_in_memory().unwrap();
        let rules = db
            .set_custom_pr_insight_rules(&[PrInsightRule {
                id: "large-pr".into(),
                title: "Custom large PR".into(),
                description: None,
                enabled: true,
                severity: "critical".into(),
                category: "size".into(),
                scope: "pr".into(),
                metric: "churn".into(),
                operator: "gte".into(),
                threshold: 42.0,
                recommendation: "Custom recommendation".into(),
                custom: true,
            }])
            .unwrap();
        let large = rules.iter().find(|r| r.id == "large-pr").unwrap();
        assert!(large.custom);
        assert_eq!(large.threshold, 42.0);
        assert_eq!(rules.iter().filter(|r| r.id == "large-pr").count(), 1);
    }

    #[test]
    fn bundle_attaches_files_and_ai_indexes() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[pr(7, "alice", "2026-01-01T00:00:00Z", None, None, 40, 5)],
        )
        .unwrap();
        db.replace_pull_request_files(
            "repo",
            &[PullRequestFileRow {
                pr_number: 7,
                path: "src/checkout.rs".into(),
                status: Some("modified".into()),
                additions: 20,
                deletions: 3,
                changes: 23,
                previous_path: None,
                blob_url: Some("https://github.com/acme/repo/blob/main/src/checkout.rs".into()),
            }],
        )
        .unwrap();
        db.upsert_pr_ai_indexes(&[PrAiIndex {
            repo_key: "repo".into(),
            pr_number: 7,
            index_type: "business_value".into(),
            score: 84,
            grade: Some("A".into()),
            category: Some("mrr".into()),
            category_scores: BTreeMap::from([("mrr".into(), 84.0)]),
            summary: Some("Improves monetization flow.".into()),
            evidence: vec!["Touches checkout.".into()],
            recommendations: vec!["Link revenue metric.".into()],
            confidence: Some(0.8),
            engine: Some("codex_cli".into()),
            input_hash: Some("abc".into()),
            generated_at_utc: Some("2026-01-01T01:00:00Z".into()),
        }])
        .unwrap();

        let bundle = db
            .pr_dashboard_bundle(
                PrGrain::Week,
                Some("alice"),
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-10T00:00:00Z"),
            )
            .unwrap();
        let row = &bundle.rows[0];
        assert_eq!(row.files[0].path, "src/checkout.rs");
        let index = row.business_value_index.as_ref().unwrap();
        assert_eq!(index.score, 84);
        assert_eq!(index.category.as_deref(), Some("mrr"));
        assert!(row.ai_maturity_index.is_none());
    }

    #[test]
    fn bundle_attaches_related_commits_deployments_and_incidents() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[PullRequestRow {
                number: 42,
                title: Some("feat: checkout export".into()),
                state: Some("merged".into()),
                author: Some("alice".into()),
                created_at_utc: Some("2026-01-01T09:00:00Z".into()),
                merged_at_utc: Some("2026-01-01T12:00:00Z".into()),
                closed_at_utc: None,
                head_branch: Some("feat/checkout-export".into()),
                base_branch: Some("main".into()),
                additions: 100,
                deletions: 10,
                changed_files: 3,
                review_count: 1,
                first_review_at_utc: Some("2026-01-01T11:00:00Z".into()),
                merge_commit_sha: Some("merge42".into()),
                head_sha: Some("head42".into()),
                html_url: None,
            }],
        )
        .unwrap();
        db.insert_commits(
            "repo",
            &[CommitRow {
                sha: "head42".into(),
                project_slug: Some("proj".into()),
                author_name: Some("Alice".into()),
                author_email: Some("alice@example.com".into()),
                authored_at_utc: "2026-01-01T10:00:00Z".into(),
                authored_at_local: None,
                authored_tz_offset_min: 0,
                authored_local_hour: 10,
                authored_dow: 4,
                committed_at_utc: Some("2026-01-01T10:05:00Z".into()),
                branch: Some("feat/checkout-export".into()),
                message: Some(
                    "feat: checkout export\n\nCo-authored-by: Claude <noreply@anthropic.com>"
                        .into(),
                ),
                subject: Some("feat: checkout export".into()),
                is_merge: false,
                files_changed: 3,
                insertions: 100,
                deletions: 10,
                ai_coauthor_trailer: true,
                coauthors: vec!["Claude <noreply@anthropic.com>".into()],
            }],
        )
        .unwrap();
        db.insert_deployments(
            "repo",
            &[DeploymentRow {
                kind: "run".into(),
                ext_id: "deploy42".into(),
                name: Some("production".into()),
                created_at_utc: Some("2026-01-01T13:00:00Z".into()),
                status: Some("success".into()),
                sha: Some("merge42".into()),
                html_url: None,
            }],
        )
        .unwrap();
        db.insert_incidents(&[IncidentRow {
            source: "github_issue".into(),
            repo_key: Some("repo".into()),
            ext_id: "incident42".into(),
            title: Some("Checkout export timeout".into()),
            severity: Some("high".into()),
            opened_at_utc: Some("2026-01-02T12:00:00Z".into()),
            resolved_at_utc: Some("2026-01-02T14:00:00Z".into()),
            state: Some("resolved".into()),
            html_url: None,
        }])
        .unwrap();
        db.correlate_incident_deploys().unwrap();

        let bundle = db
            .pr_dashboard_bundle(
                PrGrain::Week,
                Some("alice"),
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-03T00:00:00Z"),
            )
            .unwrap();
        let row = &bundle.rows[0];
        assert_eq!(row.head_sha.as_deref(), Some("head42"));
        assert_eq!(row.related_commits.len(), 1);
        assert!(row.related_commits[0].ai_assisted);
        assert_eq!(row.related_deployments[0].ext_id, "deploy42");
        assert_eq!(row.related_deployments[0].match_reason, "merge_sha");
        assert_eq!(row.related_incidents[0].ext_id, "incident42");
        assert_eq!(
            row.related_incidents[0].deploy_ext_id.as_deref(),
            Some("deploy42")
        );
        assert!(bundle
            .tiles
            .iter()
            .any(|tile| tile.key == "deployment_coverage"));
        assert!(bundle
            .tiles
            .iter()
            .any(|tile| tile.key == "post_merge_incidents" && tile.value == "1"));
    }

    #[test]
    fn bundle_correlates_pull_requests_to_sessions_deterministically() {
        let db = Db::open_in_memory().unwrap();
        db.set_repo_state(
            "repo",
            "C:/work/repo",
            Some("proj"),
            &serde_json::to_string(&vec!["proj"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        db.insert_pull_requests(
            "repo",
            &[PullRequestRow {
                number: 145,
                title: Some("Context-aware routing orchestrator".into()),
                state: Some("open".into()),
                author: Some("alice".into()),
                created_at_utc: Some("2026-01-01T10:30:00Z".into()),
                merged_at_utc: None,
                closed_at_utc: None,
                head_branch: Some("feat/pr-routing".into()),
                base_branch: Some("main".into()),
                additions: 80,
                deletions: 10,
                changed_files: 1,
                review_count: 0,
                first_review_at_utc: None,
                merge_commit_sha: None,
                head_sha: None,
                html_url: None,
            }],
        )
        .unwrap();
        db.replace_pull_request_files(
            "repo",
            &[PullRequestFileRow {
                pr_number: 145,
                path: "apps/web/app/pull-requests/page.tsx".into(),
                status: Some("modified".into()),
                additions: 80,
                deletions: 10,
                changes: 90,
                previous_path: None,
                blob_url: None,
            }],
        )
        .unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO messages \
                 (uuid, provider, session_id, project_slug, cwd, git_branch, type, timestamp, input_tokens, output_tokens, prompt_text) \
                 VALUES (?1,'codex','s-pr','proj','C:/work/repo','feat/pr-routing','user','2026-01-01T10:05:00Z',100,20,?2)",
                params![
                    "m1",
                    "Please implement context aware routing in apps/web/app/pull-requests/page.tsx"
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO messages \
                 (uuid, provider, session_id, project_slug, cwd, git_branch, type, timestamp, input_tokens, output_tokens, prompt_text) \
                 VALUES ('m2','codex','s-pr','proj','C:/work/repo','feat/pr-routing','assistant','2026-01-01T11:00:00Z',10,300,NULL)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tool_calls \
                 (provider, message_uuid, session_id, project_slug, tool_name, target, timestamp) \
                 VALUES ('codex','m2','s-pr','proj','edit','C:/work/repo/apps/web/app/pull-requests/page.tsx','2026-01-01T10:45:00Z')",
                [],
            )
            .unwrap();
        }

        let bundle = db
            .pr_dashboard_bundle(
                PrGrain::Week,
                Some("alice"),
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-02T00:00:00Z"),
            )
            .unwrap();
        let row = &bundle.rows[0];
        assert!(row.ai_session_overlap);
        assert_eq!(row.session_correlations.len(), 1);
        let correlation = &row.session_correlations[0];
        assert_eq!(correlation.mode, "deterministic");
        assert_eq!(correlation.provider, "codex");
        assert_eq!(correlation.session_id, "s-pr");
        assert!(correlation.confidence >= 0.8);
        assert!(correlation.signals.contains_key("file_touch"));
        assert!(bundle
            .tiles
            .iter()
            .any(|tile| tile.key == "session_correlation"));
    }

    #[test]
    fn bundle_attaches_persisted_ai_session_correlations() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[pr(9, "alice", "2026-01-01T10:00:00Z", None, None, 10, 2)],
        )
        .unwrap();
        db.replace_pr_session_correlations(
            "ai",
            &[("repo".into(), 9)],
            &[PrSessionCorrelation {
                repo_key: "repo".into(),
                pr_number: 9,
                provider: "claude".into(),
                session_id: "session-9".into(),
                mode: "ai".into(),
                score: 88.0,
                confidence: 0.88,
                summary: Some("AI matched by branch and timeline.".into()),
                reasons: vec!["Branch and timeline matched.".into()],
                signals: BTreeMap::from([("branch".into(), 0.25)]),
                session_started_at_utc: Some("2026-01-01T09:45:00Z".into()),
                session_ended_at_utc: Some("2026-01-01T10:45:00Z".into()),
                project_slug: Some("proj".into()),
                sample_cwd: Some("C:/work/repo".into()),
                turns: 4,
                tokens: 1200,
                engine: Some("codex_cli".into()),
                input_hash: Some("hash".into()),
                generated_at_utc: Some("2026-01-01T11:00:00Z".into()),
            }],
        )
        .unwrap();

        let bundle = db
            .pr_dashboard_bundle(
                PrGrain::Week,
                Some("alice"),
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-02T00:00:00Z"),
            )
            .unwrap();
        let correlation = &bundle.rows[0].session_correlations[0];
        assert_eq!(correlation.mode, "ai");
        assert_eq!(correlation.session_id, "session-9");
        assert_eq!(correlation.engine.as_deref(), Some("codex_cli"));
    }

    #[test]
    fn dashboard_query_paginates_and_keeps_list_rows_light() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[
                pr(1, "alice", "2026-01-01T10:00:00Z", None, None, 100, 20),
                pr(2, "alice", "2026-01-02T10:00:00Z", None, None, 40, 5),
            ],
        )
        .unwrap();
        db.replace_pull_request_files(
            "repo",
            &[PullRequestFileRow {
                pr_number: 2,
                path: "src/lib.rs".into(),
                status: Some("modified".into()),
                additions: 40,
                deletions: 5,
                changes: 45,
                previous_path: None,
                blob_url: None,
            }],
        )
        .unwrap();
        let bundle = db
            .pr_dashboard_bundle_query(
                &PrDashboardQuery {
                    grain: PrGrain::Week,
                    author: Some("alice"),
                    since: Some("2026-01-01T00:00:00Z"),
                    until: Some("2026-01-03T00:00:00Z"),
                    page: 0,
                    page_size: 1,
                    query: None,
                    status: None,
                    repo: None,
                    org: None,
                    sort: Some("created"),
                    direction: Some("desc"),
                },
                false,
            )
            .unwrap();

        assert_eq!(bundle.pagination.total_rows, 2);
        assert_eq!(bundle.rows.len(), 1);
        assert_eq!(bundle.rows[0].number, 2);
        assert!(bundle.rows[0].files.is_empty());
        assert!(bundle.rows[0].timeline.is_empty());
        assert!(bundle.rows[0].related_commits.is_empty());
        assert_eq!(bundle.summary.total, 2);
    }

    #[test]
    fn dashboard_detail_loads_heavy_pr_data() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[pr(7, "alice", "2026-01-01T10:00:00Z", None, None, 10, 2)],
        )
        .unwrap();
        db.replace_pull_request_files(
            "repo",
            &[PullRequestFileRow {
                pr_number: 7,
                path: "src/detail.rs".into(),
                status: Some("modified".into()),
                additions: 10,
                deletions: 2,
                changes: 12,
                previous_path: None,
                blob_url: None,
            }],
        )
        .unwrap();
        let row = db.pr_dashboard_detail("repo", 7).unwrap().unwrap();
        assert_eq!(row.files.len(), 1);
        assert_eq!(row.files[0].path, "src/detail.rs");
        assert!(!row.timeline.is_empty());
    }

    #[test]
    fn dashboard_query_filters_and_sort_allowlist() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[
                pr(1, "alice", "2026-01-01T10:00:00Z", None, None, 10, 2),
                pr(
                    2,
                    "bob",
                    "2026-01-02T10:00:00Z",
                    Some("2026-01-02T12:00:00Z"),
                    Some("2026-01-02T11:00:00Z"),
                    200,
                    20,
                ),
            ],
        )
        .unwrap();
        let bundle = db
            .pr_dashboard_bundle_query(
                &PrDashboardQuery {
                    grain: PrGrain::Week,
                    author: Some(ALL_AUTHORS),
                    since: Some("2026-01-01T00:00:00Z"),
                    until: Some("2026-01-03T00:00:00Z"),
                    page: 0,
                    page_size: 25,
                    query: Some("PR 2"),
                    status: Some("merged"),
                    repo: Some("repo"),
                    org: None,
                    sort: Some("size; DROP TABLE pull_requests"),
                    direction: Some("desc; DROP"),
                },
                false,
            )
            .unwrap();

        assert_eq!(bundle.rows.len(), 1);
        assert_eq!(bundle.rows[0].number, 2);
        assert_eq!(bundle.rows[0].status_bucket, "merged");
    }

    #[test]
    fn deterministic_insights_are_server_paginated_and_filterable() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo",
            &[pr(
                1,
                "alice",
                "2026-01-01T10:00:00Z",
                Some("2026-01-02T12:00:00Z"),
                Some("2026-01-02T11:00:00Z"),
                900,
                200,
            )],
        )
        .unwrap();
        let page = db
            .pr_deterministic_insights_page(
                &PrDashboardQuery {
                    grain: PrGrain::Week,
                    author: Some("alice"),
                    since: Some("2026-01-01T00:00:00Z"),
                    until: Some("2026-01-03T00:00:00Z"),
                    page: 0,
                    page_size: 1,
                    query: None,
                    status: None,
                    repo: None,
                    org: None,
                    sort: None,
                    direction: None,
                },
                Some("size"),
                None,
                None,
            )
            .unwrap();
        assert_eq!(page.rows.len(), 1);
        assert!(page.pagination.total_rows >= 1);
        assert!(page.rows.iter().all(|insight| insight.category == "size"));
    }
}
