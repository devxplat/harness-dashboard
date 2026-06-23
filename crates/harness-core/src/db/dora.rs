//! Individual, approximate DORA metrics (Phase 4), computed from whatever sources
//! are configured. Each metric is labeled `exact` vs approximated and names its
//! `source`, so the UI never overstates precision. Throughput / change-failure come
//! from local git (always available); lead-time needs GitHub PRs; MTTR needs
//! incident data we don't have.

use super::Db;
use crate::error::Result;
use rusqlite::params;
use serde::Serialize;

/// One DORA metric. `value == None` means "not derivable from configured sources".
#[derive(Debug, Serialize)]
pub struct DoraMetric {
    pub key: String,
    pub label: String,
    pub value: Option<f64>,
    pub unit: String,
    pub detail: String,
    pub source: String,
    pub exact: bool,
}

const COMMIT_BOUND: &str =
    " authored_at_utc >= COALESCE(?, '') AND authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";

impl Db {
    /// Compute the DORA panel for the range.
    pub fn dora(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<DoraMetric>> {
        let conn = self.conn.lock().unwrap();

        // Commits: total, revert/hotfix-like, and the calendar span (for rates).
        let csql = format!(
            "SELECT COUNT(*), \
             COALESCE(SUM(CASE WHEN lower(subject) LIKE 'revert%' OR lower(subject) LIKE '%hotfix%' \
                OR lower(subject) LIKE '%rollback%' THEN 1 ELSE 0 END),0), \
             COALESCE(julianday(MAX(authored_at_utc)) - julianday(MIN(authored_at_utc)), 0) \
             FROM commits WHERE {COMMIT_BOUND}"
        );
        let (total_commits, revert_commits, span_days): (i64, i64, f64) =
            conn.query_row(&csql, params![since, until], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?;

        let deploy_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM deployments \
             WHERE created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z')",
            params![since, until],
            |r| r.get(0),
        )?;

        // Merged PRs in range → average lead time (created → merged) in hours.
        let (merged_prs, avg_lead_hours): (i64, f64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(AVG((julianday(merged_at_utc)-julianday(created_at_utc))*24.0),0) \
             FROM pull_requests WHERE merged_at_utc IS NOT NULL AND created_at_utc IS NOT NULL \
               AND merged_at_utc >= COALESCE(?, '') AND merged_at_utc < COALESCE(?, '9999-12-31T99:99:99Z')",
            params![since, until],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        drop(conn);

        let weeks = (span_days / 7.0).max(1.0);
        let mut out = Vec::new();

        out.push(DoraMetric {
            key: "throughput".into(),
            label: "Throughput".into(),
            value: Some(total_commits as f64 / weeks),
            unit: "commits / week".into(),
            detail: format!("{total_commits} commits over ~{:.1} weeks", weeks),
            source: "local git".into(),
            exact: true,
        });

        out.push(DoraMetric {
            key: "deploy_frequency".into(),
            label: "Deployment frequency".into(),
            value: Some(deploy_count as f64 / weeks),
            unit: "deploys / week".into(),
            detail: if deploy_count == 0 {
                "No tags/releases found in range".into()
            } else {
                format!("{deploy_count} deployments (git tags + GitHub releases/runs)")
            },
            source: "git tags / GitHub".into(),
            exact: false,
        });

        out.push(if merged_prs > 0 {
            DoraMetric {
                key: "lead_time".into(),
                label: "Lead time to merge".into(),
                value: Some(avg_lead_hours),
                unit: "hours (avg)".into(),
                detail: format!("{merged_prs} merged PRs"),
                source: "GitHub PRs".into(),
                exact: true,
            }
        } else {
            DoraMetric {
                key: "lead_time".into(),
                label: "Lead time to merge".into(),
                value: None,
                unit: "hours".into(),
                detail: "Connect GitHub to measure PR lead time".into(),
                source: "GitHub (not configured)".into(),
                exact: false,
            }
        });

        out.push(DoraMetric {
            key: "change_failure".into(),
            label: "Change failure rate".into(),
            value: if total_commits > 0 {
                Some(revert_commits as f64 / total_commits as f64 * 100.0)
            } else {
                None
            },
            unit: "%".into(),
            detail: format!("{revert_commits} revert/hotfix-like of {total_commits} commits"),
            source: "local git (approx)".into(),
            exact: false,
        });

        out.push(DoraMetric {
            key: "mttr".into(),
            label: "Time to restore".into(),
            value: None,
            unit: "hours".into(),
            detail: "Needs incident data (e.g. GitHub issues) — not available".into(),
            source: "unavailable".into(),
            exact: false,
        });

        Ok(out)
    }
}
