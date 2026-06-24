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
    /// Performance band (Elite/High/Medium/Low) for the benchmarkable keys, when a
    /// value exists. `None` for non-benchmarkable keys (throughput, mttr).
    pub band: Option<DoraBand>,
    /// Human-readable band thresholds, present whenever the metric is benchmarkable
    /// (even with no value, so the UI can still show where Elite sits).
    pub band_target: Option<String>,
}

/// 2024 DORA "Accelerate State of DevOps" performance bands.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DoraBand {
    Elite,
    High,
    Medium,
    Low,
}

/// Classify a metric value against the public 2024 DORA thresholds. Returns the
/// band (when a value exists) and the human-readable target string (whenever the
/// key is benchmarkable). Only lead_time / deploy_frequency / change_failure map to
/// canonical DORA bands; throughput and mttr return `(None, None)`.
fn band_for(key: &str, value: Option<f64>) -> (Option<DoraBand>, Option<String>) {
    use DoraBand::*;
    match key {
        // Lead time to merge, hours.
        "lead_time" => (
            value.map(|v| {
                if v < 24.0 {
                    Elite
                } else if v < 168.0 {
                    High
                } else if v < 720.0 {
                    Medium
                } else {
                    Low
                }
            }),
            Some("Elite < 24h · High < 1wk · Medium < 1mo".into()),
        ),
        // Deploy frequency, deploys/week.
        "deploy_frequency" => (
            value.map(|v| {
                if v >= 7.0 {
                    Elite
                } else if v >= 1.0 {
                    High
                } else if v >= 0.25 {
                    Medium
                } else {
                    Low
                }
            }),
            Some("Elite ≥ 1/day · High ≥ 1/wk · Medium ≥ 1/mo".into()),
        ),
        // Change failure rate, percent.
        "change_failure" => (
            value.map(|v| {
                if v <= 5.0 {
                    Elite
                } else if v <= 15.0 {
                    High
                } else if v <= 30.0 {
                    Medium
                } else {
                    Low
                }
            }),
            Some("Elite ≤ 5% · High ≤ 15% · Medium ≤ 30%".into()),
        ),
        _ => (None, None),
    }
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

        // Incident-derived MTTR / change-failure (falls back to heuristics when no
        // incident source is connected — `incident_dora` locks the conn itself).
        let inc = self.incident_dora(since, until)?;
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
            band: None,
            band_target: None,
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
            band: None,
            band_target: None,
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
                band: None,
                band_target: None,
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
                band: None,
                band_target: None,
            }
        });

        out.push(if inc.has_source && inc.total_deploys > 0 {
            DoraMetric {
                key: "change_failure".into(),
                label: "Change failure rate".into(),
                value: Some(inc.deploys_with_incident as f64 / inc.total_deploys as f64 * 100.0),
                unit: "%".into(),
                detail: format!(
                    "{} of {} deploys linked to an incident",
                    inc.deploys_with_incident, inc.total_deploys
                ),
                source: "GitHub incidents".into(),
                exact: true,
                band: None,
                band_target: None,
            }
        } else {
            DoraMetric {
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
                band: None,
                band_target: None,
            }
        });

        out.push(if inc.has_source && inc.avg_mttr_hours.is_some() {
            DoraMetric {
                key: "mttr".into(),
                label: "Time to restore".into(),
                value: inc.avg_mttr_hours,
                unit: "hours (avg)".into(),
                detail: format!("{} resolved incidents", inc.resolved_count),
                source: "GitHub incidents".into(),
                exact: true,
                band: None,
                band_target: None,
            }
        } else {
            DoraMetric {
                key: "mttr".into(),
                label: "Time to restore".into(),
                value: None,
                unit: "hours".into(),
                detail: "Connect a GitHub incident source for exact MTTR".into(),
                source: "unavailable".into(),
                exact: false,
                band: None,
                band_target: None,
            }
        });

        // Band post-pass: classify the benchmarkable metrics against the DORA
        // thresholds (and attach the target string even when there's no value).
        for m in &mut out {
            let (band, target) = band_for(&m.key, m.value);
            m.band = band;
            m.band_target = target;
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DeploymentRow, IncidentRow, PullRequestRow};

    fn merged_pr(number: i64, created: &str, merged: &str) -> PullRequestRow {
        PullRequestRow {
            number,
            title: Some("pr".into()),
            state: Some("merged".into()),
            author: None,
            created_at_utc: Some(created.into()),
            merged_at_utc: Some(merged.into()),
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
        }
    }

    #[test]
    fn band_for_boundaries() {
        // Lead time (hours): boundaries land in the higher (worse) band.
        assert_eq!(band_for("lead_time", Some(23.9)).0, Some(DoraBand::Elite));
        assert_eq!(band_for("lead_time", Some(24.0)).0, Some(DoraBand::High));
        assert_eq!(band_for("lead_time", Some(168.0)).0, Some(DoraBand::Medium));
        assert_eq!(band_for("lead_time", Some(720.0)).0, Some(DoraBand::Low));
        // Change failure (%).
        assert_eq!(
            band_for("change_failure", Some(5.0)).0,
            Some(DoraBand::Elite)
        );
        assert_eq!(
            band_for("change_failure", Some(15.0)).0,
            Some(DoraBand::High)
        );
        assert_eq!(
            band_for("change_failure", Some(30.1)).0,
            Some(DoraBand::Low)
        );
        // Deploy frequency (per week).
        assert_eq!(
            band_for("deploy_frequency", Some(7.0)).0,
            Some(DoraBand::Elite)
        );
        assert_eq!(
            band_for("deploy_frequency", Some(0.1)).0,
            Some(DoraBand::Low)
        );
        // Non-benchmarkable keys.
        assert_eq!(band_for("throughput", Some(10.0)), (None, None));
        assert_eq!(band_for("mttr", None), (None, None));
        // Benchmarkable but no value → band None, target still present.
        let (band, target) = band_for("lead_time", None);
        assert!(band.is_none());
        assert!(target.is_some());
    }

    #[test]
    fn dora_attaches_bands() {
        let db = Db::open_in_memory().unwrap();
        // Merged ~2h after creation → Elite lead time.
        db.insert_pull_requests(
            "repo-key",
            &[merged_pr(1, "2026-01-01T08:00:00Z", "2026-01-01T10:00:00Z")],
        )
        .unwrap();

        let metrics = db.dora(None, None).unwrap();
        let lead = metrics.iter().find(|m| m.key == "lead_time").unwrap();
        assert_eq!(lead.band, Some(DoraBand::Elite));
        assert!(lead.band_target.is_some());

        let thr = metrics.iter().find(|m| m.key == "throughput").unwrap();
        assert!(thr.band.is_none());

        let mttr = metrics.iter().find(|m| m.key == "mttr").unwrap();
        assert!(mttr.band.is_none() && mttr.band_target.is_none());
    }

    #[test]
    fn dora_uses_incident_mttr_and_cfr() {
        let db = Db::open_in_memory().unwrap();
        db.insert_deployments(
            "repo-key",
            &[DeploymentRow {
                kind: "release".into(),
                ext_id: "1".into(),
                name: None,
                created_at_utc: Some("2026-01-01T08:00:00Z".into()),
                status: Some("success".into()),
                sha: None,
                html_url: None,
            }],
        )
        .unwrap();
        db.insert_incidents(&[IncidentRow {
            source: "github_issue".into(),
            repo_key: Some("repo-key".into()),
            ext_id: "7".into(),
            title: Some("API down".into()),
            severity: Some("high".into()),
            opened_at_utc: Some("2026-01-01T09:00:00Z".into()),
            resolved_at_utc: Some("2026-01-01T13:00:00Z".into()),
            state: Some("resolved".into()),
            html_url: None,
        }])
        .unwrap();
        db.correlate_incident_deploys().unwrap();

        let st = db.incident_dora(None, None).unwrap();
        assert!(st.has_source);
        assert_eq!(st.resolved_count, 1);
        assert!((st.avg_mttr_hours.unwrap() - 4.0).abs() < 1e-6);
        assert_eq!(st.total_deploys, 1);
        assert_eq!(st.deploys_with_incident, 1);

        let metrics = db.dora(None, None).unwrap();
        let mttr = metrics.iter().find(|m| m.key == "mttr").unwrap();
        assert!(mttr.exact);
        assert!((mttr.value.unwrap() - 4.0).abs() < 1e-6);
        let cfr = metrics.iter().find(|m| m.key == "change_failure").unwrap();
        assert!(cfr.exact);
        assert!((cfr.value.unwrap() - 100.0).abs() < 1e-6);
    }

    #[test]
    fn dora_falls_back_without_incidents() {
        let db = Db::open_in_memory().unwrap();
        let metrics = db.dora(None, None).unwrap();
        let mttr = metrics.iter().find(|m| m.key == "mttr").unwrap();
        assert!(mttr.value.is_none());
        assert!(!mttr.exact);
        // Change-failure stays on the local-git heuristic (not exact) without a source.
        let cfr = metrics.iter().find(|m| m.key == "change_failure").unwrap();
        assert!(!cfr.exact);
    }
}
