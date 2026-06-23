//! Higher-level productivity and DORA insight bundles. These are derived from
//! local tables only: commits, messages, pull requests, deployments, and calendar
//! events.

use super::{Db, DoraMetric};
use crate::error::Result;
use crate::git::{classify_allocation, AllocationClass};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc};
use rusqlite::params;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

const COMMIT_BOUND: &str =
    " authored_at_utc >= COALESCE(?, '') AND authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";
const MESSAGE_BOUND: &str =
    " timestamp >= COALESCE(?, '') AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') ";
const PR_CREATED_BOUND: &str =
    " created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";
const DEPLOY_BOUND: &str =
    " created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";
const CAL_OVERLAP_BOUND: &str =
    " end_utc > COALESCE(?, '') AND start_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grain {
    Day,
    Week,
    Month,
}

impl Grain {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("day").to_ascii_lowercase().as_str() {
            "week" => Self::Week,
            "month" => Self::Month,
            _ => Self::Day,
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

#[derive(Debug, Serialize)]
pub struct ProductivitySummary {
    pub commits: i64,
    pub ai_commits: i64,
    pub messages: i64,
    pub meeting_minutes: i64,
    pub focus_minutes: i64,
    pub flow_minutes: i64,
    pub pr_count: i64,
    pub merged_pr_count: i64,
    pub avg_warmup_minutes: Option<f64>,
    pub estimated: bool,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct ProductivityPeriodRow {
    pub period: String,
    pub commits: i64,
    pub ai_commits: i64,
    pub messages: i64,
    pub pr_count: i64,
    pub merged_pr_count: i64,
    pub meeting_minutes: i64,
    pub focus_minutes: i64,
    pub flow_minutes: i64,
    pub avg_warmup_minutes: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FocusBlockRow {
    pub period: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_minutes: i64,
    pub events: i64,
    pub commits: i64,
    pub messages: i64,
    pub flow: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct WarmupBucketRow {
    pub bucket: String,
    pub count: i64,
    pub avg_minutes: Option<f64>,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct PrCorrelationRow {
    pub repo_key: String,
    pub pr_count: i64,
    pub merged_pr_count: i64,
    pub avg_lead_hours: Option<f64>,
    pub avg_review_wait_hours: Option<f64>,
    pub churn: i64,
    pub ai_overlap_prs: i64,
    pub commits: i64,
    pub messages: i64,
}

#[derive(Debug, Serialize)]
pub struct ProductivityInsightsBundle {
    pub grain: String,
    pub summary: ProductivitySummary,
    pub periods: Vec<ProductivityPeriodRow>,
    #[serde(rename = "focusBlocks")]
    pub focus_blocks: Vec<FocusBlockRow>,
    pub warmup: Vec<WarmupBucketRow>,
    #[serde(rename = "prCorrelation")]
    pub pr_correlation: Vec<PrCorrelationRow>,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct DoraTrendRow {
    pub period: String,
    pub commits: i64,
    pub deploys: i64,
    pub avg_lead_hours: Option<f64>,
    pub change_failure_rate: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LeadTimeBucketRow {
    pub bucket: String,
    pub pull_requests: i64,
}

/// PR cycle-time decomposition (averages over merged PRs in range). `coding_hours`
/// is unavailable today (the feature-branch first-commit isn't captured); the merge
/// stage is treated as instantaneous, so only pickup/review carry values.
#[derive(Debug, Serialize, Default, Clone)]
pub struct PrCycleTimeRow {
    pub repo_key: String,
    pub merged_pr_count: i64,
    #[serde(rename = "codingHours")]
    pub coding_hours: Option<f64>,
    #[serde(rename = "pickupHours")]
    pub pickup_hours: Option<f64>,
    #[serde(rename = "reviewHours")]
    pub review_hours: Option<f64>,
    #[serde(rename = "mergeHours")]
    pub merge_hours: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PrSizeBucketRow {
    pub bucket: String,
    pub pull_requests: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct PrChurnSummary {
    #[serde(rename = "medianChurn")]
    pub median_churn: Option<f64>,
    #[serde(rename = "p90Churn")]
    pub p90_churn: Option<f64>,
    #[serde(rename = "avgChangedFiles")]
    pub avg_changed_files: Option<f64>,
    /// Share of PRs whose deletion ratio exceeds 0.5 — a rework proxy (labeled as such).
    #[serde(rename = "reworkProxyPct")]
    pub rework_proxy_pct: Option<f64>,
}

/// Investment-allocation totals for one category (feature/fix/ktlo/chore/other).
#[derive(Debug, Serialize)]
pub struct AllocationRow {
    pub category: String,
    pub commits: i64,
    pub insertions: i64,
    pub deletions: i64,
    #[serde(rename = "aiCommits")]
    pub ai_commits: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct AllocationPeriodRow {
    pub period: String,
    pub feature: i64,
    pub fix: i64,
    pub ktlo: i64,
    pub chore: i64,
    pub other: i64,
}

#[derive(Debug, Serialize)]
pub struct AllocationBundle {
    pub grain: String,
    pub totals: Vec<AllocationRow>,
    pub periods: Vec<AllocationPeriodRow>,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct DeploymentTimelineRow {
    pub period: String,
    pub deployments: i64,
    pub failures: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct DoraRepoRow {
    pub repo_key: String,
    pub commits: i64,
    pub deploys: i64,
    pub pr_count: i64,
    pub merged_pr_count: i64,
    pub avg_lead_hours: Option<f64>,
    pub change_failure_rate: Option<f64>,
    pub ai_overlap_prs: i64,
}

#[derive(Debug, Serialize)]
pub struct DoraBundle {
    pub grain: String,
    pub metrics: Vec<DoraMetric>,
    pub trends: Vec<DoraTrendRow>,
    #[serde(rename = "leadTimeDistribution")]
    pub lead_time_distribution: Vec<LeadTimeBucketRow>,
    #[serde(rename = "deploymentTimeline")]
    pub deployment_timeline: Vec<DeploymentTimelineRow>,
    #[serde(rename = "repoComparison")]
    pub repo_comparison: Vec<DoraRepoRow>,
    #[serde(rename = "prCycleTime")]
    pub pr_cycle_time: Vec<PrCycleTimeRow>,
    #[serde(rename = "prSizeDistribution")]
    pub pr_size_distribution: Vec<PrSizeBucketRow>,
    #[serde(rename = "prChurnSummary")]
    pub pr_churn_summary: PrChurnSummary,
}

#[derive(Debug, Clone)]
struct ProductiveEvent {
    at: DateTime<Utc>,
    kind: EventKind,
    ai: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventKind {
    Commit,
    Message,
}

#[derive(Debug, Clone)]
struct BusyInterval {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

#[derive(Debug, Default)]
struct PeriodAcc {
    commits: i64,
    ai_commits: i64,
    messages: i64,
    pr_count: i64,
    merged_pr_count: i64,
    meeting_minutes: i64,
    focus_minutes: i64,
    flow_minutes: i64,
    warmup_sum: i64,
    warmup_count: i64,
}

#[derive(Debug, Default)]
struct RepoAcc {
    pr_count: i64,
    merged_pr_count: i64,
    lead_sum: f64,
    lead_count: i64,
    review_sum: f64,
    review_count: i64,
    churn: i64,
    ai_overlap_prs: i64,
    commits: i64,
    messages: i64,
}

fn parse_ts(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn period_key(dt: DateTime<Utc>, grain: Grain) -> String {
    match grain {
        Grain::Day => dt.format("%Y-%m-%d").to_string(),
        Grain::Week => {
            let iso = dt.iso_week();
            format!("{}-W{:02}", iso.year(), iso.week())
        }
        Grain::Month => dt.format("%Y-%m").to_string(),
    }
}

fn period_key_local(dt: DateTime<Utc>, grain: Grain, tz_offset_min: i64) -> String {
    period_key(dt + Duration::minutes(tz_offset_min), grain)
}

fn next_period_boundary_utc(dt: DateTime<Utc>, grain: Grain, tz_offset_min: i64) -> DateTime<Utc> {
    let local = dt + Duration::minutes(tz_offset_min);
    let local_date = local.date_naive();
    let midnight = NaiveTime::from_hms_opt(0, 0, 0).expect("valid midnight");
    let next_local = match grain {
        Grain::Day => local_date
            .succ_opt()
            .expect("date range supported")
            .and_time(midnight),
        Grain::Week => {
            let monday =
                local_date - Duration::days(local_date.weekday().num_days_from_monday() as i64);
            (monday + Duration::days(7)).and_time(midnight)
        }
        Grain::Month => {
            let (year, month) = if local_date.month() == 12 {
                (local_date.year() + 1, 1)
            } else {
                (local_date.year(), local_date.month() + 1)
            };
            NaiveDate::from_ymd_opt(year, month, 1)
                .expect("valid month boundary")
                .and_time(midnight)
        }
    };
    DateTime::<Utc>::from_naive_utc_and_offset(next_local - Duration::minutes(tz_offset_min), Utc)
}

fn add_interval_minutes_to_periods(
    periods: &mut BTreeMap<String, PeriodAcc>,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    grain: Grain,
    tz_offset_min: i64,
) {
    let mut cursor = start;
    while cursor < end {
        let next_boundary = next_period_boundary_utc(cursor, grain, tz_offset_min);
        let segment_end = end.min(next_boundary);
        if segment_end <= cursor {
            break;
        }
        let minutes = minutes_between(cursor, segment_end);
        periods
            .entry(period_key_local(cursor, grain, tz_offset_min))
            .or_default()
            .meeting_minutes += minutes;
        cursor = segment_end;
    }
}

fn add_warmup_to_period(
    periods: &mut BTreeMap<String, PeriodAcc>,
    at: DateTime<Utc>,
    minutes: i64,
    grain: Grain,
    tz_offset_min: i64,
) {
    let p = periods
        .entry(period_key_local(at, grain, tz_offset_min))
        .or_default();
    p.warmup_count += 1;
    p.warmup_sum += minutes;
}

fn minutes_between(start: DateTime<Utc>, end: DateTime<Utc>) -> i64 {
    (end - start).num_minutes().max(0)
}

fn hours_between(start: DateTime<Utc>, end: DateTime<Utc>) -> f64 {
    (end - start).num_minutes().max(0) as f64 / 60.0
}

fn is_failure_like(subject: Option<&str>) -> bool {
    let Some(subject) = subject else {
        return false;
    };
    let s = subject.to_ascii_lowercase();
    s.starts_with("revert") || s.contains("hotfix") || s.contains("rollback")
}

fn is_deploy_failure(status: Option<&str>) -> bool {
    let Some(status) = status else {
        return false;
    };
    let s = status.to_ascii_lowercase();
    s == "failure" || s == "failed" || s == "error" || s == "cancelled"
}

fn warmup_bucket(minutes: i64) -> &'static str {
    match minutes {
        0..=15 => "0-15",
        16..=30 => "15-30",
        31..=60 => "30-60",
        61..=120 => "60-120",
        _ => "120+",
    }
}

fn lead_bucket(hours: f64) -> &'static str {
    if hours <= 1.0 {
        "0-1h"
    } else if hours <= 4.0 {
        "1-4h"
    } else if hours <= 24.0 {
        "4-24h"
    } else if hours <= 72.0 {
        "1-3d"
    } else if hours <= 168.0 {
        "3-7d"
    } else {
        "7d+"
    }
}

fn avg(sum: f64, count: i64) -> Option<f64> {
    (count > 0).then_some(sum / count as f64)
}

const SIZE_ORDER: [&str; 6] = ["0-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];

fn size_bucket(lines: i64) -> &'static str {
    match lines {
        ..=10 => "0-10",
        11..=50 => "11-50",
        51..=200 => "51-200",
        201..=500 => "201-500",
        501..=1000 => "501-1000",
        _ => "1000+",
    }
}

/// Nearest-rank percentile over a pre-sorted ascending slice. `None` when empty.
fn percentile(sorted: &[i64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let idx = ((p * (sorted.len() as f64 - 1.0)).round() as usize).min(sorted.len() - 1);
    Some(sorted[idx] as f64)
}

fn avg_i64(sum: i64, count: i64) -> Option<f64> {
    (count > 0).then_some(sum as f64 / count as f64)
}

fn in_range(dt: DateTime<Utc>, since: Option<DateTime<Utc>>, until: Option<DateTime<Utc>>) -> bool {
    if let Some(since) = since {
        if dt < since {
            return false;
        }
    }
    if let Some(until) = until {
        if dt >= until {
            return false;
        }
    }
    true
}

fn merge_intervals(mut intervals: Vec<BusyInterval>) -> Vec<BusyInterval> {
    intervals.sort_by_key(|i| i.start);
    let mut out: Vec<BusyInterval> = Vec::new();
    for interval in intervals {
        if let Some(last) = out.last_mut() {
            if interval.start <= last.end {
                if interval.end > last.end {
                    last.end = interval.end;
                }
                continue;
            }
        }
        out.push(interval);
    }
    out
}

fn slug_repo_map(conn: &rusqlite::Connection) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    let mut stmt = conn.prepare("SELECT repo_key, primary_slug, slugs_json FROM git_repos")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (repo_key, primary_slug, slugs_json) = row?;
        if let Some(slug) = primary_slug {
            out.insert(slug, repo_key.clone());
        }
        if let Some(slugs_json) = slugs_json {
            if let Ok(slugs) = serde_json::from_str::<Vec<String>>(&slugs_json) {
                for slug in slugs {
                    out.insert(slug, repo_key.clone());
                }
            }
        }
    }
    Ok(out)
}

fn build_focus_blocks(
    events: &[ProductiveEvent],
    intervals: &[BusyInterval],
    grain: Grain,
    tz_offset_min: i64,
) -> Vec<FocusBlockRow> {
    let mut out = Vec::new();
    let mut current: Vec<&ProductiveEvent> = Vec::new();
    let mut interval_idx = 0usize;
    for event in events {
        while interval_idx < intervals.len() && intervals[interval_idx].end <= event.at {
            interval_idx += 1;
        }
        let inside_busy = interval_idx < intervals.len()
            && intervals[interval_idx].start <= event.at
            && intervals[interval_idx].end > event.at;
        if inside_busy {
            continue;
        }
        let split = current
            .last()
            .map(|last| event.at - last.at > Duration::minutes(30))
            .unwrap_or(false);
        if split && !current.is_empty() {
            out.push(focus_block_from_events(&current, grain, tz_offset_min));
            current.clear();
        }
        current.push(event);
    }
    if !current.is_empty() {
        out.push(focus_block_from_events(&current, grain, tz_offset_min));
    }
    out
}

fn focus_block_from_events(
    events: &[&ProductiveEvent],
    grain: Grain,
    tz_offset_min: i64,
) -> FocusBlockRow {
    let first = events.first().expect("focus block has events");
    let last = events.last().expect("focus block has events");
    let duration = minutes_between(first.at, last.at);
    let commits = events
        .iter()
        .filter(|event| event.kind == EventKind::Commit)
        .count() as i64;
    let messages = events
        .iter()
        .filter(|event| event.kind == EventKind::Message)
        .count() as i64;
    FocusBlockRow {
        period: period_key_local(first.at, grain, tz_offset_min),
        started_at: first.at.to_rfc3339(),
        ended_at: last.at.to_rfc3339(),
        duration_minutes: duration,
        events: events.len() as i64,
        commits,
        messages,
        flow: duration >= 45,
    }
}

impl Db {
    pub fn productivity_insights(
        &self,
        grain: Grain,
        tz_offset_min: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<ProductivityInsightsBundle> {
        let conn = self.conn.lock().unwrap();
        let slug_to_repo = slug_repo_map(&conn)?;
        let mut events = Vec::new();
        let mut repo_acc: HashMap<String, RepoAcc> = HashMap::new();
        let mut periods: BTreeMap<String, PeriodAcc> = BTreeMap::new();

        {
            let sql = format!(
                "SELECT repo_key, authored_at_utc, ai_session_overlap, ai_coauthor_trailer \
                 FROM commits WHERE {COMMIT_BOUND} ORDER BY authored_at_utc"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? != 0 || r.get::<_, i64>(3)? != 0,
                ))
            })?;
            for row in rows {
                let (repo_key, at, ai) = row?;
                let Some(at) = parse_ts(&at) else {
                    continue;
                };
                let p = periods
                    .entry(period_key_local(at, grain, tz_offset_min))
                    .or_default();
                p.commits += 1;
                if ai {
                    p.ai_commits += 1;
                }
                let repo = repo_acc.entry(repo_key.clone()).or_default();
                repo.commits += 1;
                events.push(ProductiveEvent {
                    at,
                    kind: EventKind::Commit,
                    ai,
                });
            }
        }

        {
            let sql = format!(
                "SELECT timestamp, project_slug FROM messages \
                 WHERE type='assistant' AND {MESSAGE_BOUND} ORDER BY timestamp"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (at, project_slug) = row?;
                let Some(at) = parse_ts(&at) else {
                    continue;
                };
                periods
                    .entry(period_key_local(at, grain, tz_offset_min))
                    .or_default()
                    .messages += 1;
                if let Some(repo_key) = slug_to_repo.get(&project_slug) {
                    repo_acc.entry(repo_key.clone()).or_default().messages += 1;
                }
                events.push(ProductiveEvent {
                    at,
                    kind: EventKind::Message,
                    ai: true,
                });
            }
        }
        events.sort_by_key(|event| event.at);

        let intervals = merge_intervals(self.busy_intervals_locked(&conn, since, until)?);
        for interval in &intervals {
            add_interval_minutes_to_periods(
                &mut periods,
                interval.start,
                interval.end,
                grain,
                tz_offset_min,
            );
        }

        let focus_blocks = build_focus_blocks(&events, &intervals, grain, tz_offset_min);
        for block in &focus_blocks {
            let p = periods.entry(block.period.clone()).or_default();
            p.focus_minutes += block.duration_minutes;
            if block.flow {
                p.flow_minutes += block.duration_minutes;
            }
        }

        let mut warmup_stats: BTreeMap<&'static str, (i64, i64)> = [
            ("0-15", (0, 0)),
            ("15-30", (0, 0)),
            ("30-60", (0, 0)),
            ("60-120", (0, 0)),
            ("120+", (0, 0)),
        ]
        .into_iter()
        .collect();
        let mut event_idx = 0usize;
        for interval in &intervals {
            while event_idx < events.len() && events[event_idx].at < interval.end {
                event_idx += 1;
            }
            if let Some(next) = events.get(event_idx) {
                let minutes = minutes_between(interval.end, next.at);
                let bucket = warmup_bucket(minutes);
                let entry = warmup_stats.entry(bucket).or_default();
                entry.0 += 1;
                entry.1 += minutes;
                add_warmup_to_period(&mut periods, interval.end, minutes, grain, tz_offset_min);
            }
        }

        Self::add_pr_productivity_locked(
            &conn,
            since,
            until,
            grain,
            tz_offset_min,
            &mut periods,
            &mut repo_acc,
        )?;

        let commits = events
            .iter()
            .filter(|event| event.kind == EventKind::Commit)
            .count() as i64;
        let ai_commits = events
            .iter()
            .filter(|event| event.kind == EventKind::Commit && event.ai)
            .count() as i64;
        let messages = events
            .iter()
            .filter(|event| event.kind == EventKind::Message)
            .count() as i64;
        let meeting_minutes: i64 = intervals
            .iter()
            .map(|interval| minutes_between(interval.start, interval.end))
            .sum();
        let focus_minutes: i64 = focus_blocks
            .iter()
            .map(|block| block.duration_minutes)
            .sum();
        let flow_minutes: i64 = focus_blocks
            .iter()
            .filter(|block| block.flow)
            .map(|block| block.duration_minutes)
            .sum();
        let warmup_total: i64 = warmup_stats.values().map(|(_, sum)| *sum).sum();
        let warmup_count: i64 = warmup_stats.values().map(|(count, _)| *count).sum();

        let mut period_rows: Vec<ProductivityPeriodRow> = periods
            .into_iter()
            .map(|(period, acc)| ProductivityPeriodRow {
                period,
                commits: acc.commits,
                ai_commits: acc.ai_commits,
                messages: acc.messages,
                pr_count: acc.pr_count,
                merged_pr_count: acc.merged_pr_count,
                meeting_minutes: acc.meeting_minutes,
                focus_minutes: acc.focus_minutes,
                flow_minutes: acc.flow_minutes,
                avg_warmup_minutes: avg_i64(acc.warmup_sum, acc.warmup_count),
            })
            .collect();
        period_rows.sort_by(|a, b| a.period.cmp(&b.period));

        let warmup = warmup_stats
            .into_iter()
            .map(|(bucket, (count, sum))| WarmupBucketRow {
                bucket: bucket.to_string(),
                count,
                avg_minutes: avg_i64(sum, count),
            })
            .collect();

        let mut pr_correlation: Vec<PrCorrelationRow> = repo_acc
            .into_iter()
            .map(|(repo_key, acc)| PrCorrelationRow {
                repo_key,
                pr_count: acc.pr_count,
                merged_pr_count: acc.merged_pr_count,
                avg_lead_hours: avg(acc.lead_sum, acc.lead_count),
                avg_review_wait_hours: avg(acc.review_sum, acc.review_count),
                churn: acc.churn,
                ai_overlap_prs: acc.ai_overlap_prs,
                commits: acc.commits,
                messages: acc.messages,
            })
            .collect();
        pr_correlation.sort_by(|a, b| {
            (b.pr_count + b.commits)
                .cmp(&(a.pr_count + a.commits))
                .then_with(|| a.repo_key.cmp(&b.repo_key))
        });

        Ok(ProductivityInsightsBundle {
            grain: grain.as_str().to_string(),
            summary: ProductivitySummary {
                commits,
                ai_commits,
                messages,
                meeting_minutes,
                focus_minutes,
                flow_minutes,
                pr_count: pr_correlation.iter().map(|row| row.pr_count).sum(),
                merged_pr_count: pr_correlation.iter().map(|row| row.merged_pr_count).sum(),
                avg_warmup_minutes: avg_i64(warmup_total, warmup_count),
                estimated: true,
            },
            periods: period_rows,
            focus_blocks,
            warmup,
            pr_correlation,
        })
    }

    fn busy_intervals_locked(
        &self,
        conn: &rusqlite::Connection,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<BusyInterval>> {
        let since_dt = since.and_then(parse_ts);
        let until_dt = until.and_then(parse_ts);
        let sql = format!(
            "SELECT start_utc, end_utc FROM calendar_events \
             WHERE is_busy=1 AND start_utc IS NOT NULL AND end_utc IS NOT NULL \
             AND {CAL_OVERLAP_BOUND} ORDER BY start_utc"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![since, until], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (start, end) = row?;
            let (Some(start), Some(end)) = (parse_ts(&start), parse_ts(&end)) else {
                continue;
            };
            let start = since_dt.map_or(start, |since| start.max(since));
            let end = until_dt.map_or(end, |until| end.min(until));
            if end > start {
                out.push(BusyInterval { start, end });
            }
        }
        Ok(out)
    }

    fn add_pr_productivity_locked(
        conn: &rusqlite::Connection,
        since: Option<&str>,
        until: Option<&str>,
        grain: Grain,
        tz_offset_min: i64,
        periods: &mut BTreeMap<String, PeriodAcc>,
        repo_acc: &mut HashMap<String, RepoAcc>,
    ) -> Result<()> {
        let since_dt = since.and_then(parse_ts);
        let until_dt = until.and_then(parse_ts);
        let sql = format!(
            "SELECT repo_key, created_at_utc, merged_at_utc, additions, deletions, \
             first_review_at_utc, ai_session_overlap \
             FROM pull_requests WHERE {PR_CREATED_BOUND} ORDER BY created_at_utc"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![since, until], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)? != 0,
            ))
        })?;
        for row in rows {
            let (repo_key, created, merged, additions, deletions, first_review, overlap) = row?;
            let repo = repo_acc.entry(repo_key).or_default();
            repo.pr_count += 1;
            repo.churn += additions + deletions;
            if overlap {
                repo.ai_overlap_prs += 1;
            }
            if let Some(created) = created.as_deref().and_then(parse_ts) {
                periods
                    .entry(period_key_local(created, grain, tz_offset_min))
                    .or_default()
                    .pr_count += 1;
                if let Some(first_review) = first_review.as_deref().and_then(parse_ts) {
                    repo.review_sum += hours_between(created, first_review);
                    repo.review_count += 1;
                }
                if let Some(merged) = merged.as_deref().and_then(parse_ts) {
                    repo.lead_sum += hours_between(created, merged);
                    repo.lead_count += 1;
                }
            }
            if let Some(merged) = merged.as_deref().and_then(parse_ts) {
                if !in_range(merged, since_dt, until_dt) {
                    continue;
                }
                periods
                    .entry(period_key_local(merged, grain, tz_offset_min))
                    .or_default()
                    .merged_pr_count += 1;
                repo.merged_pr_count += 1;
            }
        }
        Ok(())
    }

    pub fn dora_bundle(
        &self,
        grain: Grain,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<DoraBundle> {
        let metrics = self.dora(since, until)?;
        let conn = self.conn.lock().unwrap();
        let mut trends: BTreeMap<String, DoraTrendAcc> = BTreeMap::new();
        let mut repo: HashMap<String, DoraRepoAcc> = HashMap::new();

        {
            let sql = format!(
                "SELECT repo_key, authored_at_utc, subject FROM commits WHERE {COMMIT_BOUND}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?;
            for row in rows {
                let (repo_key, at, subject) = row?;
                let Some(at) = parse_ts(&at) else {
                    continue;
                };
                let failure = is_failure_like(subject.as_deref());
                let t = trends.entry(period_key(at, grain)).or_default();
                t.commits += 1;
                if failure {
                    t.failures += 1;
                }
                let r = repo.entry(repo_key).or_default();
                r.commits += 1;
                if failure {
                    r.failures += 1;
                }
            }
        }

        let mut lead_buckets: BTreeMap<&'static str, i64> = [
            ("0-1h", 0),
            ("1-4h", 0),
            ("4-24h", 0),
            ("1-3d", 0),
            ("3-7d", 0),
            ("7d+", 0),
        ]
        .into_iter()
        .collect();
        let mut counted_ai_prs: HashSet<(String, i64)> = HashSet::new();
        let mut size_buckets: HashMap<&'static str, i64> = HashMap::new();
        let mut churn_values: Vec<i64> = Vec::new();
        let mut changed_files_sum: i64 = 0;
        let mut size_pr_count: i64 = 0;
        let mut rework_count: i64 = 0;
        {
            let sql = format!(
                "SELECT repo_key, number, ai_session_overlap, additions, deletions, changed_files \
                 FROM pull_requests WHERE {PR_CREATED_BOUND}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)? != 0,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })?;
            for row in rows {
                let (repo_key, number, overlap, additions, deletions, changed_files) = row?;
                let r = repo.entry(repo_key.clone()).or_default();
                r.pr_count += 1;
                if overlap && counted_ai_prs.insert((repo_key, number)) {
                    r.ai_overlap_prs += 1;
                }
                let lines = additions + deletions;
                *size_buckets.entry(size_bucket(lines)).or_default() += 1;
                churn_values.push(lines);
                changed_files_sum += changed_files;
                size_pr_count += 1;
                if lines > 0 && (deletions as f64 / lines as f64) > 0.5 {
                    rework_count += 1;
                }
            }
        }
        let mut cycle: HashMap<String, CycleAcc> = HashMap::new();
        {
            let sql = "SELECT repo_key, number, created_at_utc, merged_at_utc, first_review_at_utc, ai_session_overlap \
                 FROM pull_requests \
                 WHERE merged_at_utc IS NOT NULL AND created_at_utc IS NOT NULL \
                 AND merged_at_utc >= COALESCE(?, '') \
                 AND merged_at_utc < COALESCE(?, '9999-12-31T99:99:99Z')";
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)? != 0,
                ))
            })?;
            for row in rows {
                let (repo_key, number, created, merged, first_review, overlap) = row?;
                let r = repo.entry(repo_key.clone()).or_default();
                if overlap && counted_ai_prs.insert((repo_key.clone(), number)) {
                    r.ai_overlap_prs += 1;
                }
                let Some(created) = created.as_deref().and_then(parse_ts) else {
                    continue;
                };
                if let Some(merged) = merged.as_deref().and_then(parse_ts) {
                    let hours = hours_between(created, merged);
                    r.merged_pr_count += 1;
                    r.lead_sum += hours;
                    r.lead_count += 1;
                    let bucket = lead_bucket(hours);
                    *lead_buckets.entry(bucket).or_default() += 1;
                    let t = trends.entry(period_key(merged, grain)).or_default();
                    t.lead_sum += hours;
                    t.lead_count += 1;

                    // Cycle-time stages: pickup (open→first review), review (first
                    // review→merge). Coding/merge stages are unavailable (see DTO docs).
                    let c = cycle.entry(repo_key).or_default();
                    c.merged += 1;
                    if let Some(fr) = first_review.as_deref().and_then(parse_ts) {
                        c.pickup_sum += hours_between(created, fr);
                        c.pickup_n += 1;
                        c.review_sum += hours_between(fr, merged);
                        c.review_n += 1;
                    }
                }
            }
        }

        let mut deployments: BTreeMap<String, DeploymentTimelineRow> = BTreeMap::new();
        {
            let sql = format!(
                "SELECT repo_key, created_at_utc, status FROM deployments WHERE {DEPLOY_BOUND}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?;
            for row in rows {
                let (repo_key, at, status) = row?;
                let Some(at) = at.as_deref().and_then(parse_ts) else {
                    continue;
                };
                let failure = is_deploy_failure(status.as_deref());
                let key = period_key(at, grain);
                let d = deployments
                    .entry(key.clone())
                    .or_insert_with(|| DeploymentTimelineRow {
                        period: key.clone(),
                        ..Default::default()
                    });
                d.deployments += 1;
                if failure {
                    d.failures += 1;
                }
                let t = trends.entry(key).or_default();
                t.deploys += 1;
                let r = repo.entry(repo_key).or_default();
                r.deploys += 1;
            }
        }

        let trend_rows = trends
            .into_iter()
            .map(|(period, acc)| DoraTrendRow {
                period,
                commits: acc.commits,
                deploys: acc.deploys,
                avg_lead_hours: avg(acc.lead_sum, acc.lead_count),
                change_failure_rate: if acc.commits > 0 {
                    Some(acc.failures as f64 / acc.commits as f64 * 100.0)
                } else {
                    None
                },
            })
            .collect();

        let lead_time_distribution = lead_buckets
            .into_iter()
            .map(|(bucket, pull_requests)| LeadTimeBucketRow {
                bucket: bucket.to_string(),
                pull_requests,
            })
            .collect();

        let mut repo_comparison: Vec<DoraRepoRow> = repo
            .into_iter()
            .map(|(repo_key, acc)| DoraRepoRow {
                repo_key,
                commits: acc.commits,
                deploys: acc.deploys,
                pr_count: acc.pr_count,
                merged_pr_count: acc.merged_pr_count,
                avg_lead_hours: avg(acc.lead_sum, acc.lead_count),
                change_failure_rate: if acc.commits > 0 {
                    Some(acc.failures as f64 / acc.commits as f64 * 100.0)
                } else {
                    None
                },
                ai_overlap_prs: acc.ai_overlap_prs,
            })
            .collect();
        repo_comparison.sort_by(|a, b| {
            (b.commits + b.pr_count)
                .cmp(&(a.commits + a.pr_count))
                .then_with(|| a.repo_key.cmp(&b.repo_key))
        });

        // PR cycle-time: an "All repos" aggregate first, then per-repo (busiest first).
        let mut pr_cycle_time: Vec<PrCycleTimeRow> = Vec::new();
        {
            let mut all = CycleAcc::default();
            for c in cycle.values() {
                all.pickup_sum += c.pickup_sum;
                all.pickup_n += c.pickup_n;
                all.review_sum += c.review_sum;
                all.review_n += c.review_n;
                all.merged += c.merged;
            }
            if all.merged > 0 {
                pr_cycle_time.push(PrCycleTimeRow {
                    repo_key: "All repos".into(),
                    merged_pr_count: all.merged,
                    coding_hours: None,
                    pickup_hours: avg(all.pickup_sum, all.pickup_n),
                    review_hours: avg(all.review_sum, all.review_n),
                    merge_hours: None,
                });
            }
            let mut per_repo: Vec<PrCycleTimeRow> = cycle
                .into_iter()
                .map(|(repo_key, c)| PrCycleTimeRow {
                    repo_key,
                    merged_pr_count: c.merged,
                    coding_hours: None,
                    pickup_hours: avg(c.pickup_sum, c.pickup_n),
                    review_hours: avg(c.review_sum, c.review_n),
                    merge_hours: None,
                })
                .collect();
            per_repo.sort_by(|a, b| {
                b.merged_pr_count
                    .cmp(&a.merged_pr_count)
                    .then_with(|| a.repo_key.cmp(&b.repo_key))
            });
            pr_cycle_time.extend(per_repo);
        }

        let pr_size_distribution: Vec<PrSizeBucketRow> = SIZE_ORDER
            .iter()
            .map(|&b| PrSizeBucketRow {
                bucket: b.to_string(),
                pull_requests: size_buckets.get(&b).copied().unwrap_or(0),
            })
            .collect();

        churn_values.sort_unstable();
        let pr_churn_summary = PrChurnSummary {
            median_churn: percentile(&churn_values, 0.5),
            p90_churn: percentile(&churn_values, 0.9),
            avg_changed_files: avg(changed_files_sum as f64, size_pr_count),
            rework_proxy_pct: (size_pr_count > 0)
                .then(|| rework_count as f64 / size_pr_count as f64 * 100.0),
        };

        Ok(DoraBundle {
            grain: grain.as_str().to_string(),
            metrics,
            trends: trend_rows,
            lead_time_distribution,
            deployment_timeline: deployments.into_values().collect(),
            repo_comparison,
            pr_cycle_time,
            pr_size_distribution,
            pr_churn_summary,
        })
    }

    /// Investment / allocation split: classify each commit's subject (conventional
    /// commits) into feature/fix/ktlo/chore/other, accumulating totals and a per-period
    /// stacked breakdown. Classification is the pure `git::classify_allocation`.
    pub fn allocation(
        &self,
        grain: Grain,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<AllocationBundle> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT subject, authored_at_utc, insertions, deletions, \
             (ai_session_overlap=1 OR ai_coauthor_trailer=1) \
             FROM commits WHERE {COMMIT_BOUND}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![since, until], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)? != 0,
            ))
        })?;

        let mut totals: HashMap<String, AllocationRow> = HashMap::new();
        let mut periods: BTreeMap<String, AllocationPeriodRow> = BTreeMap::new();
        for row in rows {
            let (subject, at, insertions, deletions, ai) = row?;
            let class = classify_allocation(subject.as_deref());
            let cat = class.as_str();
            let entry = totals
                .entry(cat.to_string())
                .or_insert_with(|| AllocationRow {
                    category: cat.to_string(),
                    commits: 0,
                    insertions: 0,
                    deletions: 0,
                    ai_commits: 0,
                });
            entry.commits += 1;
            entry.insertions += insertions;
            entry.deletions += deletions;
            if ai {
                entry.ai_commits += 1;
            }
            if let Some(dt) = parse_ts(&at) {
                let p = periods.entry(period_key(dt, grain)).or_default();
                match class {
                    AllocationClass::Feature => p.feature += 1,
                    AllocationClass::Fix => p.fix += 1,
                    AllocationClass::Ktlo => p.ktlo += 1,
                    AllocationClass::Chore => p.chore += 1,
                    AllocationClass::Other => p.other += 1,
                }
            }
        }

        let period_rows: Vec<AllocationPeriodRow> = periods
            .into_iter()
            .map(|(period, mut row)| {
                row.period = period;
                row
            })
            .collect();
        let order = ["feature", "fix", "ktlo", "chore", "other"];
        let totals_vec: Vec<AllocationRow> =
            order.iter().filter_map(|c| totals.remove(*c)).collect();

        Ok(AllocationBundle {
            grain: grain.as_str().to_string(),
            totals: totals_vec,
            periods: period_rows,
        })
    }
}

#[derive(Debug, Default)]
struct DoraTrendAcc {
    commits: i64,
    deploys: i64,
    failures: i64,
    lead_sum: f64,
    lead_count: i64,
}

#[derive(Debug, Default)]
struct DoraRepoAcc {
    commits: i64,
    failures: i64,
    deploys: i64,
    pr_count: i64,
    merged_pr_count: i64,
    lead_sum: f64,
    lead_count: i64,
    ai_overlap_prs: i64,
}

#[derive(Debug, Default)]
struct CycleAcc {
    pickup_sum: f64,
    pickup_n: i64,
    review_sum: f64,
    review_n: i64,
    merged: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CalendarEventRow, CommitRow, PullRequestRow};

    fn commit(sha: &str, at: &str, ai: bool) -> CommitRow {
        CommitRow {
            sha: sha.to_string(),
            project_slug: Some("repo".into()),
            author_name: None,
            author_email: None,
            authored_at_utc: at.to_string(),
            authored_at_local: None,
            authored_tz_offset_min: 0,
            authored_local_hour: 9,
            authored_dow: 3,
            committed_at_utc: None,
            branch: None,
            message: None,
            subject: Some(if ai { "feat: ai" } else { "feat: human" }.into()),
            is_merge: false,
            files_changed: 1,
            insertions: 10,
            deletions: 2,
            ai_coauthor_trailer: ai,
            coauthors: Vec::new(),
        }
    }

    fn event(id: &str, start: &str, end: &str) -> CalendarEventRow {
        CalendarEventRow {
            event_id: id.to_string(),
            calendar_id: None,
            start_utc: Some(start.to_string()),
            end_utc: Some(end.to_string()),
            title: None,
            attendee_count: 2,
            is_busy: true,
            updated_at_utc: None,
        }
    }

    #[test]
    fn focus_blocks_exclude_meetings_and_mark_flow() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits(
            "repo-key",
            &[
                commit("a", "2026-01-01T09:45:00Z", true),
                commit("b", "2026-01-01T10:35:00Z", false),
            ],
        )
        .unwrap();
        db.insert_calendar_events(&[event("m1", "2026-01-01T09:00:00Z", "2026-01-01T09:30:00Z")])
            .unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO messages(uuid, provider, session_id, project_slug, type, timestamp) \
                 VALUES ('msg1','claude','s1','repo','assistant','2026-01-01T10:10:00Z')",
                [],
            )
            .unwrap();
        }

        let out = db
            .productivity_insights(
                Grain::Day,
                0,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-02T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(out.summary.commits, 2);
        assert_eq!(out.summary.messages, 1);
        assert_eq!(out.summary.focus_minutes, 50);
        assert_eq!(out.summary.flow_minutes, 50);
        assert_eq!(out.summary.avg_warmup_minutes, Some(15.0));
        assert_eq!(out.warmup[0].bucket, "0-15");
        assert_eq!(out.warmup[0].count, 1);
    }

    #[test]
    fn chained_meetings_share_one_warmup_window() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits("repo-key", &[commit("a", "2026-01-01T15:05:00Z", false)])
            .unwrap();
        db.insert_calendar_events(&[
            event("m1", "2026-01-01T13:00:00Z", "2026-01-01T13:30:00Z"),
            event("m2", "2026-01-01T13:30:00Z", "2026-01-01T14:00:00Z"),
            event("m3", "2026-01-01T20:00:00Z", "2026-01-01T21:00:00Z"),
        ])
        .unwrap();

        let out = db
            .productivity_insights(
                Grain::Day,
                0,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-02T00:00:00Z"),
            )
            .unwrap();
        let bucket = out
            .warmup
            .iter()
            .find(|row| row.bucket == "60-120")
            .unwrap();
        assert_eq!(bucket.count, 1);
        assert_eq!(bucket.avg_minutes, Some(65.0));
    }

    #[test]
    fn productivity_periods_use_viewer_timezone() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits("repo-key", &[commit("a", "2026-01-01T02:30:00Z", false)])
            .unwrap();

        let out = db
            .productivity_insights(
                Grain::Day,
                -180,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-02T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(out.periods[0].period, "2025-12-31");
        assert_eq!(out.focus_blocks[0].period, "2025-12-31");
    }

    #[test]
    fn calendar_overlap_is_clamped_and_merged() {
        let db = Db::open_in_memory().unwrap();
        db.insert_calendar_events(&[
            event("m1", "2025-12-31T23:30:00Z", "2026-01-01T00:30:00Z"),
            event("m2", "2026-01-01T00:15:00Z", "2026-01-01T00:45:00Z"),
        ])
        .unwrap();

        let out = db
            .productivity_insights(
                Grain::Day,
                0,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-02T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(out.summary.meeting_minutes, 45);
        assert_eq!(out.periods[0].meeting_minutes, 45);
    }

    #[test]
    fn pr_correlation_and_dora_bundle_use_pr_fields() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits("repo-key", &[commit("a", "2026-01-01T09:00:00Z", true)])
            .unwrap();
        db.insert_pull_requests(
            "repo-key",
            &[PullRequestRow {
                number: 1,
                title: Some("PR".into()),
                state: Some("merged".into()),
                author: None,
                created_at_utc: Some("2026-01-01T08:00:00Z".into()),
                merged_at_utc: Some("2026-01-01T12:00:00Z".into()),
                closed_at_utc: None,
                head_branch: None,
                base_branch: None,
                additions: 30,
                deletions: 5,
                changed_files: 2,
                review_count: 1,
                first_review_at_utc: Some("2026-01-01T10:00:00Z".into()),
                merge_commit_sha: None,
                html_url: None,
            }],
        )
        .unwrap();

        let insights = db
            .productivity_insights(
                Grain::Week,
                0,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-01-08T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(insights.periods[0].period, "2026-W01");
        assert_eq!(insights.pr_correlation[0].pr_count, 1);
        assert_eq!(insights.pr_correlation[0].avg_lead_hours, Some(4.0));
        assert_eq!(insights.pr_correlation[0].avg_review_wait_hours, Some(2.0));
        assert_eq!(insights.pr_correlation[0].churn, 35);

        let dora = db
            .dora_bundle(
                Grain::Month,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-02-01T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(dora.trends[0].period, "2026-01");
        assert_eq!(dora.trends[0].avg_lead_hours, Some(4.0));
        let lead_bucket = dora
            .lead_time_distribution
            .iter()
            .find(|row| row.bucket == "1-4h")
            .unwrap();
        assert_eq!(lead_bucket.pull_requests, 1);

        // Cycle-time: pickup (08:00→10:00) = 2h, review (10:00→12:00) = 2h; coding gap.
        let all = dora
            .pr_cycle_time
            .iter()
            .find(|r| r.repo_key == "All repos")
            .unwrap();
        assert_eq!(all.merged_pr_count, 1);
        assert_eq!(all.pickup_hours, Some(2.0));
        assert_eq!(all.review_hours, Some(2.0));
        assert!(all.coding_hours.is_none());

        // Size/churn: 30 + 5 = 35 lines → "11-50" bucket; median churn 35; low deletion share.
        let size = dora
            .pr_size_distribution
            .iter()
            .find(|b| b.bucket == "11-50")
            .unwrap();
        assert_eq!(size.pull_requests, 1);
        assert_eq!(dora.pr_churn_summary.median_churn, Some(35.0));
        assert_eq!(dora.pr_churn_summary.rework_proxy_pct, Some(0.0));
    }

    #[test]
    fn allocation_buckets_by_category_and_period() {
        let db = Db::open_in_memory().unwrap();
        let mk = |sha: &str, subject: &str, ai: bool| CommitRow {
            sha: sha.into(),
            project_slug: Some("repo".into()),
            author_name: None,
            author_email: None,
            authored_at_utc: "2026-01-01T09:00:00Z".into(),
            authored_at_local: None,
            authored_tz_offset_min: 0,
            authored_local_hour: 9,
            authored_dow: 3,
            committed_at_utc: None,
            branch: None,
            message: None,
            subject: Some(subject.into()),
            is_merge: false,
            files_changed: 1,
            insertions: 5,
            deletions: 1,
            ai_coauthor_trailer: ai,
            coauthors: Vec::new(),
        };
        db.insert_commits(
            "repo-key",
            &[
                mk("a", "feat: x", true),
                mk("b", "fix: y", false),
                mk("c", "refactor: z", false),
                mk("d", "random", false),
            ],
        )
        .unwrap();

        let out = db.allocation(Grain::Day, None, None).unwrap();
        let by = |cat: &str| out.totals.iter().find(|r| r.category == cat).unwrap();
        assert_eq!(by("feature").commits, 1);
        assert_eq!(by("feature").ai_commits, 1);
        assert_eq!(by("fix").commits, 1);
        assert_eq!(by("ktlo").commits, 1);
        assert_eq!(by("other").commits, 1);
        // Totals are emitted in canonical order.
        assert_eq!(out.totals.first().unwrap().category, "feature");
        // Single day → one period with the right per-category buckets.
        assert_eq!(out.periods.len(), 1);
        assert_eq!(out.periods[0].feature, 1);
        assert_eq!(out.periods[0].ktlo, 1);
        assert_eq!(out.periods[0].other, 1);
    }

    #[test]
    fn dora_bundle_splits_created_and_merged_pr_ranges() {
        let db = Db::open_in_memory().unwrap();
        db.insert_pull_requests(
            "repo-key",
            &[
                PullRequestRow {
                    number: 1,
                    title: Some("Merged in range".into()),
                    state: Some("merged".into()),
                    author: None,
                    created_at_utc: Some("2025-12-31T20:00:00Z".into()),
                    merged_at_utc: Some("2026-01-01T02:00:00Z".into()),
                    closed_at_utc: None,
                    head_branch: None,
                    base_branch: None,
                    additions: 10,
                    deletions: 2,
                    changed_files: 1,
                    review_count: 0,
                    first_review_at_utc: None,
                    merge_commit_sha: None,
                    html_url: None,
                },
                PullRequestRow {
                    number: 2,
                    title: Some("Created in range".into()),
                    state: Some("open".into()),
                    author: None,
                    created_at_utc: Some("2026-01-01T08:00:00Z".into()),
                    merged_at_utc: Some("2026-02-01T08:00:00Z".into()),
                    closed_at_utc: None,
                    head_branch: None,
                    base_branch: None,
                    additions: 20,
                    deletions: 4,
                    changed_files: 1,
                    review_count: 0,
                    first_review_at_utc: None,
                    merge_commit_sha: None,
                    html_url: None,
                },
            ],
        )
        .unwrap();

        let dora = db
            .dora_bundle(
                Grain::Month,
                Some("2026-01-01T00:00:00Z"),
                Some("2026-02-01T00:00:00Z"),
            )
            .unwrap();
        let row = dora
            .repo_comparison
            .iter()
            .find(|row| row.repo_key == "repo-key")
            .unwrap();
        assert_eq!(row.pr_count, 1);
        assert_eq!(row.merged_pr_count, 1);
        assert_eq!(row.avg_lead_hours, Some(6.0));
        let lead_bucket = dora
            .lead_time_distribution
            .iter()
            .find(|row| row.bucket == "4-24h")
            .unwrap();
        assert_eq!(lead_bucket.pull_requests, 1);
    }
}
