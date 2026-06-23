//! AI-impact / ROI layer (Phase 5). Turns the raw AI-coding-tool data we already
//! capture (token/prompt/session + AI-attributed commits/PRs) into the
//! "AI impact" metrics the market frameworks (DX Core 4, etc.) headline:
//! line-level % AI-generated, adoption/utilization, ROI, and usage↔delivery
//! correlation. All computed in Rust over bound queries; one concern per module.
//!
//! Attribution is intentionally commit-level ("lines in AI-assisted commits"),
//! not per-line provenance — labeled as such in the UI. Cost is never recomputed
//! here; ROI reuses the already-tested `overview_totals_for_providers` costing.

use super::Db;
use crate::error::Result;
use crate::model::ProviderId;
use crate::pricing::Pricing;
use rusqlite::params;
use serde::Serialize;
use std::collections::BTreeMap;

/// `authored_at_utc` range bound (commit-column twin of the message `TIME_BOUND`).
/// Kept module-local so the heavily-tested git/dora queries stay untouched.
const COMMIT_BOUND: &str =
    " authored_at_utc >= COALESCE(?, '') AND authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";

/// `created_at_utc` range bound for pull requests.
const PR_CREATED_BOUND: &str =
    " created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";

/// `timestamp` range bound for messages (twin of `queries::TIME_BOUND`).
const MSG_TIME_BOUND: &str =
    " timestamp >= COALESCE(?, '') AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') ";

/// A commit counts as AI-assisted if *either* signal fires (same union as `git.rs`).
const AI_PREDICATE: &str = "(ai_session_overlap=1 OR ai_coauthor_trailer=1)";

/// Pearson correlation coefficient, or `None` when there are fewer than two
/// paired points or either series has zero variance. Pure — unit-tested directly.
/// Shared with `survey.rs` (DevEx sentiment vs hard metrics).
pub(super) fn pearson(xs: &[f64], ys: &[f64]) -> Option<f64> {
    let n = xs.len();
    if n < 2 || xs.len() != ys.len() {
        return None;
    }
    let nf = n as f64;
    let mean_x = xs.iter().sum::<f64>() / nf;
    let mean_y = ys.iter().sum::<f64>() / nf;
    let mut cov = 0.0;
    let mut var_x = 0.0;
    let mut var_y = 0.0;
    for i in 0..n {
        let dx = xs[i] - mean_x;
        let dy = ys[i] - mean_y;
        cov += dx * dy;
        var_x += dx * dx;
        var_y += dy * dy;
    }
    let denom = (var_x * var_y).sqrt();
    if denom == 0.0 {
        None
    } else {
        Some(cov / denom)
    }
}

/// `numer / denom * 100`, `None` when `denom <= 0` (the guard idiom from `dora.rs`).
fn pct(numer: i64, denom: i64) -> Option<f64> {
    if denom > 0 {
        Some(numer as f64 / denom as f64 * 100.0)
    } else {
        None
    }
}

/// `num / denom`, `None` when the cost is absent or the denominator is non-positive.
fn ratio(num: Option<f64>, denom: f64) -> Option<f64> {
    match num {
        Some(n) if denom > 0.0 => Some(n / denom),
        _ => None,
    }
}

// ---------- P0#1 line-level % AI-generated ----------

#[derive(Debug, Serialize)]
pub struct AiLinesRow {
    pub day: String,
    pub ai_insertions: i64,
    pub ai_deletions: i64,
    pub human_insertions: i64,
    pub human_deletions: i64,
    pub ai_commits: i64,
    pub human_commits: i64,
}

#[derive(Debug, Serialize)]
pub struct AiLinesSummary {
    pub ai_lines: i64,
    pub human_lines: i64,
    pub total_lines: i64,
    /// Share of committed lines (ins+del) landing in AI-assisted commits.
    pub ai_line_pct: Option<f64>,
    /// Share of commits that are AI-assisted.
    pub ai_commit_pct: Option<f64>,
    pub pr_ai_lines: i64,
    pub pr_human_lines: i64,
    pub pr_ai_line_pct: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct AiLinesBundle {
    pub summary: AiLinesSummary,
    pub daily: Vec<AiLinesRow>,
}

// ---------- P0#4 adoption / utilization ----------

#[derive(Debug, Serialize)]
pub struct AiAdoptionDayRow {
    pub day: String,
    pub sessions: i64,
    pub messages: i64,
    /// True when the day had at least one assistant message (the "active day" rule).
    pub active: bool,
}

#[derive(Debug, Serialize)]
pub struct AiAdoptionBundle {
    /// Distinct days with ≥1 assistant message.
    pub active_days: i64,
    /// Inclusive calendar-day span of the window's activity.
    pub span_days: i64,
    pub sessions: i64,
    pub messages: i64,
    /// Distinct sidechain agent ids — a subagent/agent-task count (DAU/WAU-style signal).
    pub agent_tasks: i64,
    /// Share of days in the active span that were active.
    pub pct_active_days: Option<f64>,
    pub avg_sessions_per_active_day: Option<f64>,
    pub daily: Vec<AiAdoptionDayRow>,
}

// ---------- P0#2 AI spend → ROI ----------

#[derive(Debug, Serialize)]
pub struct AiRoiByGroupRow {
    pub group: String,
    /// "provider" | "project".
    pub kind: String,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
    pub merged_prs: i64,
    pub commits: i64,
    pub lines_shipped: i64,
    pub cost_per_merged_pr: Option<f64>,
    pub cost_per_commit: Option<f64>,
    pub cost_per_1k_lines: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct AiRoiBundle {
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
    pub reported_cost_usd: Option<f64>,
    /// Days with any AI assistant activity (the cost-per-active-day denominator).
    pub active_days: i64,
    pub merged_prs: i64,
    pub commits: i64,
    pub lines_shipped: i64,
    pub cost_per_active_day: Option<f64>,
    pub cost_per_merged_pr: Option<f64>,
    pub cost_per_commit: Option<f64>,
    pub cost_per_1k_lines: Option<f64>,
    /// Cost split by provider (delivery counts are global — not provider-attributed).
    pub by_provider: Vec<AiRoiByGroupRow>,
    /// Delivery split by project (cost is not attributable per repo → `cost_usd: None`).
    pub by_project: Vec<AiRoiByGroupRow>,
}

// ---------- P0#3 usage ↔ delivery correlation ----------

#[derive(Debug, Serialize)]
pub struct AiCorrelationSeriesRow {
    pub day: String,
    pub sessions: i64,
    pub active: bool,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub commits: i64,
    pub ai_commits: i64,
    pub merged_prs: i64,
    pub avg_lead_hours: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AiCorrelationCoeffs {
    /// Pearson r of daily sessions vs daily commits.
    pub usage_vs_commits: Option<f64>,
    /// Pearson r of daily sessions vs daily merged PRs.
    pub usage_vs_merged_prs: Option<f64>,
    /// Pearson r of daily output tokens vs that day's avg PR lead time.
    pub tokens_vs_lead_hours: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct AiCorrelationBundle {
    pub series: Vec<AiCorrelationSeriesRow>,
    pub coeffs: AiCorrelationCoeffs,
    /// Coefficients for the prior equal-length window (filled by the handler).
    pub previous_period: Option<AiCorrelationCoeffs>,
}

// ---------- P0#5 AI Impact bundle ----------

#[derive(Debug, Serialize)]
pub struct AiImpactBundle {
    pub lines: AiLinesBundle,
    pub roi: AiRoiBundle,
    pub correlation: AiCorrelationBundle,
    pub adoption: AiAdoptionBundle,
}

impl Db {
    /// P0#1 — line-level % AI-generated: weight commit (and PR) churn by the AI
    /// predicate, daily + summary. Commit-level attribution (see module docs).
    pub fn ai_lines(&self, since: Option<&str>, until: Option<&str>) -> Result<AiLinesBundle> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT substr(authored_at_utc,1,10) AS day, \
             COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN insertions ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN deletions  ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN NOT {AI_PREDICATE} THEN insertions ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN NOT {AI_PREDICATE} THEN deletions  ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN 1 ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN NOT {AI_PREDICATE} THEN 1 ELSE 0 END),0) \
             FROM commits WHERE {COMMIT_BOUND} GROUP BY day ORDER BY day"
        );
        let daily: Vec<AiLinesRow> = {
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params![since, until], |r| {
                    Ok(AiLinesRow {
                        day: r.get(0)?,
                        ai_insertions: r.get(1)?,
                        ai_deletions: r.get(2)?,
                        human_insertions: r.get(3)?,
                        human_deletions: r.get(4)?,
                        ai_commits: r.get(5)?,
                        human_commits: r.get(6)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        // PR-level extension: weight PR churn by the synced AI-session overlap.
        let pr_sql = format!(
            "SELECT COALESCE(SUM(CASE WHEN ai_session_overlap=1 THEN additions+deletions ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN ai_session_overlap=0 THEN additions+deletions ELSE 0 END),0) \
             FROM pull_requests WHERE {PR_CREATED_BOUND}"
        );
        let (pr_ai_lines, pr_human_lines): (i64, i64) =
            conn.query_row(&pr_sql, params![since, until], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;
        drop(conn);

        let mut ai_lines = 0i64;
        let mut human_lines = 0i64;
        let mut ai_commits = 0i64;
        let mut human_commits = 0i64;
        for d in &daily {
            ai_lines += d.ai_insertions + d.ai_deletions;
            human_lines += d.human_insertions + d.human_deletions;
            ai_commits += d.ai_commits;
            human_commits += d.human_commits;
        }
        let total_lines = ai_lines + human_lines;

        Ok(AiLinesBundle {
            summary: AiLinesSummary {
                ai_lines,
                human_lines,
                total_lines,
                ai_line_pct: pct(ai_lines, total_lines),
                ai_commit_pct: pct(ai_commits, ai_commits + human_commits),
                pr_ai_lines,
                pr_human_lines,
                pr_ai_line_pct: pct(pr_ai_lines, pr_ai_lines + pr_human_lines),
            },
            daily,
        })
    }

    /// P0#4 — adoption / utilization trend over assistant activity. "Active day" =
    /// ≥1 assistant message; sessions/agent-tasks are the DAU/WAU-style signals.
    pub fn ai_adoption(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<AiAdoptionBundle> {
        let conn = self.conn.lock().unwrap();
        let daily_sql = format!(
            "SELECT substr(timestamp,1,10) AS day, \
             COUNT(DISTINCT provider || ':' || session_id), \
             COALESCE(SUM(CASE WHEN type='assistant' THEN 1 ELSE 0 END),0) \
             FROM messages WHERE {MSG_TIME_BOUND} GROUP BY day ORDER BY day"
        );
        let daily: Vec<AiAdoptionDayRow> = {
            let mut stmt = conn.prepare(&daily_sql)?;
            let rows = stmt
                .query_map(params![since, until], |r| {
                    let messages: i64 = r.get(2)?;
                    Ok(AiAdoptionDayRow {
                        day: r.get(0)?,
                        sessions: r.get(1)?,
                        messages,
                        active: messages > 0,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        // One aggregate pass: total sessions, calendar span (days), subagent tasks.
        let agg_sql = format!(
            "SELECT COUNT(DISTINCT provider || ':' || session_id), \
             COALESCE(julianday(MAX(timestamp)) - julianday(MIN(timestamp)), 0), \
             COUNT(DISTINCT CASE WHEN is_sidechain=1 THEN agent_id END), \
             COUNT(*) \
             FROM messages WHERE {MSG_TIME_BOUND}"
        );
        let (sessions, span_raw, agent_tasks, row_count): (i64, f64, i64, i64) =
            conn.query_row(&agg_sql, params![since, until], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?;
        drop(conn);

        let active_days = daily.iter().filter(|d| d.active).count() as i64;
        let messages: i64 = daily.iter().map(|d| d.messages).sum();
        // Inclusive day count: a same-day-only window still spans 1 day.
        let span_days = if row_count > 0 {
            span_raw.floor() as i64 + 1
        } else {
            0
        };

        Ok(AiAdoptionBundle {
            active_days,
            span_days,
            sessions,
            messages,
            agent_tasks,
            pct_active_days: pct(active_days, span_days),
            avg_sessions_per_active_day: if active_days > 0 {
                Some(sessions as f64 / active_days as f64)
            } else {
                None
            },
            daily,
        })
    }
}

impl Db {
    /// P0#2 — AI spend → ROI. Cost reuses the tested `overview_totals_for_providers`
    /// (and per-provider `by_model`) costing; delivery counts come from commits/PRs.
    /// Cost is provider-attributed; commits/PRs are not, so `by_project` is delivery-only.
    pub fn ai_roi(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<AiRoiBundle> {
        let totals = self.overview_totals_for_providers(pricing, since, until, providers)?;

        let (commits, lines_shipped): (i64, i64) = {
            let conn = self.conn.lock().unwrap();
            let sql = format!(
                "SELECT COUNT(*), COALESCE(SUM(insertions+deletions),0) \
                 FROM commits WHERE {COMMIT_BOUND}"
            );
            conn.query_row(&sql, params![since, until], |r| Ok((r.get(0)?, r.get(1)?)))?
        };
        let merged_prs: i64 = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT COUNT(*) FROM pull_requests \
                 WHERE merged_at_utc IS NOT NULL \
                   AND merged_at_utc >= COALESCE(?, '') \
                   AND merged_at_utc < COALESCE(?, '9999-12-31T99:99:99Z')",
                params![since, until],
                |r| r.get(0),
            )?
        };
        let active_days: i64 = {
            let conn = self.conn.lock().unwrap();
            let sql = format!(
                "SELECT COUNT(DISTINCT substr(timestamp,1,10)) \
                 FROM messages WHERE type='assistant' AND {MSG_TIME_BOUND}"
            );
            conn.query_row(&sql, params![since, until], |r| r.get(0))?
        };

        // Per-provider cost from a single by_model pass (sum priced costs per provider).
        let mut prov: BTreeMap<String, (f64, bool)> = BTreeMap::new();
        for m in self.by_model_for_providers(pricing, since, until, providers)? {
            if let Some(usd) = m.cost_usd {
                let e = prov.entry(m.provider).or_insert((0.0, false));
                e.0 += usd;
                e.1 |= m.cost_estimated;
            }
        }
        let by_provider = prov
            .into_iter()
            .map(|(group, (cost, est))| {
                let cost = Some(cost);
                AiRoiByGroupRow {
                    group,
                    kind: "provider".into(),
                    cost_usd: cost,
                    cost_estimated: est,
                    merged_prs,
                    commits,
                    lines_shipped,
                    cost_per_merged_pr: ratio(cost, merged_prs as f64),
                    cost_per_commit: ratio(cost, commits as f64),
                    cost_per_1k_lines: ratio(cost, lines_shipped as f64 / 1000.0),
                }
            })
            .collect();

        let by_project = {
            let conn = self.conn.lock().unwrap();
            let sql = format!(
                "SELECT COALESCE(project_slug,'(none)'), COUNT(*), COALESCE(SUM(insertions+deletions),0) \
                 FROM commits WHERE {COMMIT_BOUND} GROUP BY project_slug ORDER BY 2 DESC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params![since, until], |r| {
                    let group: String = r.get(0)?;
                    let commits: i64 = r.get(1)?;
                    let lines_shipped: i64 = r.get(2)?;
                    Ok(AiRoiByGroupRow {
                        group,
                        kind: "project".into(),
                        cost_usd: None,
                        cost_estimated: false,
                        merged_prs: 0,
                        commits,
                        lines_shipped,
                        cost_per_merged_pr: None,
                        cost_per_commit: None,
                        cost_per_1k_lines: None,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        Ok(AiRoiBundle {
            cost_usd: totals.cost_usd,
            cost_estimated: totals.cost_estimated,
            reported_cost_usd: totals.reported_cost_usd,
            active_days,
            merged_prs,
            commits,
            lines_shipped,
            cost_per_active_day: ratio(totals.cost_usd, active_days as f64),
            cost_per_merged_pr: ratio(totals.cost_usd, merged_prs as f64),
            cost_per_commit: ratio(totals.cost_usd, commits as f64),
            cost_per_1k_lines: ratio(totals.cost_usd, lines_shipped as f64 / 1000.0),
            by_provider,
            by_project,
        })
    }

    /// P0#3 — usage ↔ delivery correlation: an aligned daily series (sessions/tokens
    /// vs commits/merged-PRs/lead) plus Pearson coefficients. The period-over-period
    /// comparison is assembled by the handler (a second call over the prior window).
    pub fn ai_correlation(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<AiCorrelationBundle> {
        #[derive(Default)]
        struct Acc {
            sessions: i64,
            input: i64,
            output: i64,
            commits: i64,
            ai_commits: i64,
            merged: i64,
            lead_sum: f64,
            lead_n: i64,
        }
        let mut map: BTreeMap<String, Acc> = BTreeMap::new();

        // Usage/day (collapse providers) via the tested daily query.
        for row in self.daily_for_providers(since, until, &[])? {
            let e = map.entry(row.day).or_default();
            e.sessions += row.sessions;
            e.input += row.input_tokens;
            e.output += row.output_tokens;
        }

        {
            let conn = self.conn.lock().unwrap();
            let csql = format!(
                "SELECT substr(authored_at_utc,1,10) AS day, COUNT(*), \
                 COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN 1 ELSE 0 END),0) \
                 FROM commits WHERE {COMMIT_BOUND} GROUP BY day"
            );
            let mut stmt = conn.prepare(&csql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (day, commits, ai_commits) = row?;
                let e = map.entry(day).or_default();
                e.commits += commits;
                e.ai_commits += ai_commits;
            }

            let psql = "SELECT substr(merged_at_utc,1,10) AS day, COUNT(*), \
                 COALESCE(SUM((julianday(merged_at_utc)-julianday(created_at_utc))*24.0),0) \
                 FROM pull_requests \
                 WHERE merged_at_utc IS NOT NULL AND created_at_utc IS NOT NULL \
                   AND merged_at_utc >= COALESCE(?, '') \
                   AND merged_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') GROUP BY day";
            let mut stmt = conn.prepare(psql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, f64>(2)?,
                ))
            })?;
            for row in rows {
                let (day, merged, lead_sum) = row?;
                let e = map.entry(day).or_default();
                e.merged += merged;
                e.lead_sum += lead_sum;
                e.lead_n += merged;
            }
        }

        let series: Vec<AiCorrelationSeriesRow> = map
            .into_iter()
            .map(|(day, a)| AiCorrelationSeriesRow {
                day,
                sessions: a.sessions,
                active: a.sessions > 0,
                input_tokens: a.input,
                output_tokens: a.output,
                commits: a.commits,
                ai_commits: a.ai_commits,
                merged_prs: a.merged,
                avg_lead_hours: if a.lead_n > 0 {
                    Some(a.lead_sum / a.lead_n as f64)
                } else {
                    None
                },
            })
            .collect();

        let sessions: Vec<f64> = series.iter().map(|r| r.sessions as f64).collect();
        let commits: Vec<f64> = series.iter().map(|r| r.commits as f64).collect();
        let merged: Vec<f64> = series.iter().map(|r| r.merged_prs as f64).collect();
        let mut tok = Vec::new();
        let mut lead = Vec::new();
        for r in &series {
            if let Some(l) = r.avg_lead_hours {
                tok.push(r.output_tokens as f64);
                lead.push(l);
            }
        }

        Ok(AiCorrelationBundle {
            coeffs: AiCorrelationCoeffs {
                usage_vs_commits: pearson(&sessions, &commits),
                usage_vs_merged_prs: pearson(&sessions, &merged),
                tokens_vs_lead_hours: pearson(&tok, &lead),
            },
            series,
            previous_period: None,
        })
    }

    /// P0#5 — compose the four quadrants. Correlation period-over-period is left to
    /// the handler (the DX-Core-4 mapping: utilization=adoption, impact=lines+correlation,
    /// cost=roi cost, net value=roi ratios).
    pub fn ai_impact_bundle(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<AiImpactBundle> {
        Ok(AiImpactBundle {
            lines: self.ai_lines(since, until)?,
            roi: self.ai_roi(pricing, since, until, providers)?,
            correlation: self.ai_correlation(since, until)?,
            adoption: self.ai_adoption(since, until)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CommitRow, PullRequestRow};

    fn commit(sha: &str, at: &str, ai: bool, ins: i64, del: i64) -> CommitRow {
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
            insertions: ins,
            deletions: del,
            ai_coauthor_trailer: ai,
            coauthors: Vec::new(),
        }
    }

    fn insert_msg(db: &Db, uuid: &str, session: &str, ts: &str) {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages(uuid, provider, session_id, project_slug, type, timestamp) \
             VALUES (?1,'claude',?2,'repo','assistant',?3)",
            params![uuid, session, ts],
        )
        .unwrap();
    }

    fn pr(number: i64, created: &str, merged: Option<&str>) -> PullRequestRow {
        PullRequestRow {
            number,
            title: Some("pr".into()),
            state: Some(if merged.is_some() { "merged" } else { "open" }.into()),
            author: Some("dev".into()),
            created_at_utc: Some(created.into()),
            merged_at_utc: merged.map(|s| s.into()),
            closed_at_utc: merged.map(|s| s.into()),
            head_branch: None,
            base_branch: None,
            additions: 30,
            deletions: 6,
            changed_files: 3,
            review_count: 0,
            first_review_at_utc: None,
            merge_commit_sha: None,
            html_url: None,
        }
    }

    #[test]
    fn pearson_known_vectors() {
        let r = pearson(&[1.0, 2.0, 3.0], &[2.0, 4.0, 6.0]).unwrap();
        assert!(
            (r - 1.0).abs() < 1e-9,
            "perfect positive correlation, got {r}"
        );
        let r2 = pearson(&[1.0, 2.0, 3.0], &[6.0, 4.0, 2.0]).unwrap();
        assert!(
            (r2 + 1.0).abs() < 1e-9,
            "perfect negative correlation, got {r2}"
        );
        assert!(pearson(&[1.0], &[2.0]).is_none(), "n<2 → None");
        assert!(
            pearson(&[1.0, 1.0, 1.0], &[2.0, 4.0, 6.0]).is_none(),
            "zero variance → None"
        );
    }

    #[test]
    fn ai_lines_split_and_pct() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits(
            "repo-key",
            &[
                commit("a", "2026-01-01T09:00:00Z", true, 10, 2),
                commit("b", "2026-01-01T10:00:00Z", false, 10, 2),
            ],
        )
        .unwrap();

        let out = db.ai_lines(None, None).unwrap();
        assert_eq!(out.summary.ai_lines, 12);
        assert_eq!(out.summary.human_lines, 12);
        assert_eq!(out.summary.total_lines, 24);
        assert!((out.summary.ai_line_pct.unwrap() - 50.0).abs() < 1e-9);
        assert!((out.summary.ai_commit_pct.unwrap() - 50.0).abs() < 1e-9);
        assert_eq!(out.daily.len(), 1);
        assert_eq!(out.daily[0].ai_insertions, 10);
        assert_eq!(out.daily[0].human_deletions, 2);
    }

    #[test]
    fn ai_lines_empty_is_none() {
        let db = Db::open_in_memory().unwrap();
        let out = db.ai_lines(None, None).unwrap();
        assert!(out.summary.ai_line_pct.is_none());
        assert_eq!(out.summary.total_lines, 0);
    }

    #[test]
    fn ai_adoption_counts_active_days() {
        let db = Db::open_in_memory().unwrap();
        insert_msg(&db, "m1", "s1", "2026-01-01T09:00:00Z");
        insert_msg(&db, "m2", "s1", "2026-01-01T10:00:00Z");
        insert_msg(&db, "m3", "s2", "2026-01-03T09:00:00Z");
        insert_msg(&db, "m4", "s3", "2026-01-05T09:00:00Z");

        let out = db.ai_adoption(None, None).unwrap();
        assert_eq!(out.active_days, 3);
        assert_eq!(out.sessions, 3);
        assert_eq!(out.messages, 4);
        // Jan 1 → Jan 5 inclusive = 5 calendar days.
        assert_eq!(out.span_days, 5);
        assert!((out.pct_active_days.unwrap() - 60.0).abs() < 1e-9);
        assert_eq!(out.daily.len(), 3);
        assert!(out.daily.iter().all(|d| d.active));
    }

    #[test]
    fn ai_adoption_empty() {
        let db = Db::open_in_memory().unwrap();
        let out = db.ai_adoption(None, None).unwrap();
        assert_eq!(out.active_days, 0);
        assert_eq!(out.span_days, 0);
        assert!(out.pct_active_days.is_none());
        assert!(out.avg_sessions_per_active_day.is_none());
    }

    #[test]
    fn ai_roi_counts_delivery_without_cost() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits(
            "repo-key",
            &[
                commit("a", "2026-01-01T09:00:00Z", true, 10, 2),
                commit("b", "2026-01-01T10:00:00Z", false, 10, 2),
            ],
        )
        .unwrap();
        db.insert_pull_requests(
            "repo-key",
            &[pr(1, "2026-01-01T08:00:00Z", Some("2026-01-01T12:00:00Z"))],
        )
        .unwrap();
        insert_msg(&db, "m1", "s1", "2026-01-01T09:00:00Z");

        let pricing = Pricing::load_default();
        let roi = db.ai_roi(&pricing, None, None, &[]).unwrap();
        assert_eq!(roi.commits, 2);
        assert_eq!(roi.merged_prs, 1);
        assert_eq!(roi.lines_shipped, 24);
        assert_eq!(roi.active_days, 1);
        // The seeded message carries no model/usage → no cost → ratios are None.
        assert!(roi.cost_usd.is_none());
        assert!(roi.cost_per_merged_pr.is_none());
        assert!(roi.cost_per_1k_lines.is_none());
    }

    #[test]
    fn ai_correlation_perfect_lockstep() {
        let db = Db::open_in_memory().unwrap();
        // Day d carries d distinct sessions and d commits, in lockstep.
        insert_msg(&db, "m1", "d1s1", "2026-01-01T09:00:00Z");
        insert_msg(&db, "m2", "d2s1", "2026-01-02T09:00:00Z");
        insert_msg(&db, "m3", "d2s2", "2026-01-02T10:00:00Z");
        insert_msg(&db, "m4", "d3s1", "2026-01-03T09:00:00Z");
        insert_msg(&db, "m5", "d3s2", "2026-01-03T10:00:00Z");
        insert_msg(&db, "m6", "d3s3", "2026-01-03T11:00:00Z");
        db.insert_commits(
            "repo-key",
            &[
                commit("c1", "2026-01-01T09:30:00Z", true, 5, 1),
                commit("c2", "2026-01-02T09:30:00Z", true, 5, 1),
                commit("c3", "2026-01-02T10:30:00Z", false, 5, 1),
                commit("c4", "2026-01-03T09:30:00Z", true, 5, 1),
                commit("c5", "2026-01-03T10:30:00Z", false, 5, 1),
                commit("c6", "2026-01-03T11:30:00Z", false, 5, 1),
            ],
        )
        .unwrap();

        let out = db.ai_correlation(None, None).unwrap();
        assert_eq!(out.series.len(), 3);
        assert_eq!(out.series[0].sessions, 1);
        assert_eq!(out.series[2].commits, 3);
        let r = out.coeffs.usage_vs_commits.unwrap();
        assert!(
            (r - 1.0).abs() < 1e-9,
            "perfect lockstep correlation, got {r}"
        );
        assert!(out.previous_period.is_none());
    }
}
