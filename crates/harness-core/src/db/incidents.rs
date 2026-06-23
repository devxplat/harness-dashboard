//! Incident storage + the DORA stats they unlock (real MTTR and change-failure
//! rate). Incidents come from a source (GitHub issues labeled `incident` today);
//! `correlate_incident_deploys` links each to the deployment immediately preceding
//! it so a failed deploy can be counted. When no incident source is connected,
//! `incident_dora().has_source` is false and `dora.rs` keeps its heuristics.

use super::Db;
use crate::error::Result;
use crate::model::IncidentRow;
use rusqlite::params;
use serde::Serialize;

const INCIDENT_OPENED_BOUND: &str =
    " opened_at_utc >= COALESCE(?, '') AND opened_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";
const DEPLOY_CREATED_BOUND: &str =
    " created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";

#[derive(Debug, Serialize)]
pub struct IncidentDto {
    pub source: String,
    pub repo_key: Option<String>,
    pub ext_id: String,
    pub title: Option<String>,
    pub severity: Option<String>,
    pub opened_at_utc: Option<String>,
    pub resolved_at_utc: Option<String>,
    pub state: Option<String>,
    pub html_url: Option<String>,
    #[serde(rename = "deployExtId")]
    pub deploy_ext_id: Option<String>,
    #[serde(rename = "mttrHours")]
    pub mttr_hours: Option<f64>,
}

/// Incident-derived DORA inputs for a range. `has_source` gates the fallback in
/// `dora.rs`: false → keep the heuristic MTTR/change-failure.
#[derive(Debug)]
pub struct IncidentDoraStats {
    pub resolved_count: i64,
    pub avg_mttr_hours: Option<f64>,
    pub deploys_with_incident: i64,
    pub total_deploys: i64,
    pub has_source: bool,
}

impl Db {
    /// Upsert incidents, preserving any existing deploy-correlation columns (filled
    /// separately by `correlate_incident_deploys`).
    pub fn insert_incidents(&self, incidents: &[IncidentRow]) -> Result<usize> {
        if incidents.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO incidents \
                 (source, repo_key, ext_id, title, severity, opened_at_utc, resolved_at_utc, state, html_url, \
                  deploy_repo_key, deploy_kind, deploy_ext_id) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9, \
                   (SELECT deploy_repo_key FROM incidents WHERE source=?1 AND ext_id=?3), \
                   (SELECT deploy_kind FROM incidents WHERE source=?1 AND ext_id=?3), \
                   (SELECT deploy_ext_id FROM incidents WHERE source=?1 AND ext_id=?3))",
            )?;
            for inc in incidents {
                stmt.execute(params![
                    inc.source,
                    inc.repo_key,
                    inc.ext_id,
                    inc.title,
                    inc.severity,
                    inc.opened_at_utc,
                    inc.resolved_at_utc,
                    inc.state,
                    inc.html_url
                ])?;
            }
        }
        tx.commit()?;
        Ok(incidents.len())
    }

    /// Link each not-yet-linked incident to the deployment on its repo with the
    /// greatest `created_at_utc <= opened_at_utc`. Idempotent.
    pub fn correlate_incident_deploys(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE incidents SET \
               deploy_repo_key = repo_key, \
               deploy_kind = (SELECT d.kind FROM deployments d \
                   WHERE d.repo_key = incidents.repo_key AND d.created_at_utc IS NOT NULL \
                     AND d.created_at_utc <= incidents.opened_at_utc \
                   ORDER BY d.created_at_utc DESC LIMIT 1), \
               deploy_ext_id = (SELECT d.ext_id FROM deployments d \
                   WHERE d.repo_key = incidents.repo_key AND d.created_at_utc IS NOT NULL \
                     AND d.created_at_utc <= incidents.opened_at_utc \
                   ORDER BY d.created_at_utc DESC LIMIT 1) \
             WHERE deploy_ext_id IS NULL AND repo_key IS NOT NULL AND opened_at_utc IS NOT NULL \
               AND EXISTS (SELECT 1 FROM deployments d \
                   WHERE d.repo_key = incidents.repo_key AND d.created_at_utc IS NOT NULL \
                     AND d.created_at_utc <= incidents.opened_at_utc)",
            [],
        )?;
        Ok(())
    }

    /// List incidents opened in range (newest first), with a computed MTTR per row.
    pub fn incidents(
        &self,
        limit: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<IncidentDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT source, repo_key, ext_id, title, severity, opened_at_utc, resolved_at_utc, \
             state, html_url, deploy_ext_id, \
             CASE WHEN resolved_at_utc IS NOT NULL AND opened_at_utc IS NOT NULL \
                  THEN (julianday(resolved_at_utc)-julianday(opened_at_utc))*24.0 ELSE NULL END \
             FROM incidents WHERE {INCIDENT_OPENED_BOUND} ORDER BY opened_at_utc DESC LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until, limit], |r| {
                Ok(IncidentDto {
                    source: r.get(0)?,
                    repo_key: r.get(1)?,
                    ext_id: r.get(2)?,
                    title: r.get(3)?,
                    severity: r.get(4)?,
                    opened_at_utc: r.get(5)?,
                    resolved_at_utc: r.get(6)?,
                    state: r.get(7)?,
                    html_url: r.get(8)?,
                    deploy_ext_id: r.get(9)?,
                    mttr_hours: r.get(10)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Incident-derived MTTR + change-failure inputs for the range.
    pub fn incident_dora(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<IncidentDoraStats> {
        let conn = self.conn.lock().unwrap();
        let has_source: bool =
            conn.query_row("SELECT EXISTS(SELECT 1 FROM incidents)", [], |r| {
                r.get::<_, i64>(0)
            })? != 0;

        let mttr_sql = format!(
            "SELECT COUNT(*), \
             SUM((julianday(resolved_at_utc)-julianday(opened_at_utc))*24.0) \
             FROM incidents WHERE state='resolved' AND resolved_at_utc IS NOT NULL \
               AND opened_at_utc IS NOT NULL AND {INCIDENT_OPENED_BOUND}"
        );
        let (resolved_count, mttr_sum): (i64, Option<f64>) =
            conn.query_row(&mttr_sql, params![since, until], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;
        let avg_mttr_hours = if resolved_count > 0 {
            mttr_sum.map(|s| s / resolved_count as f64)
        } else {
            None
        };

        let total_sql = format!("SELECT COUNT(*) FROM deployments WHERE {DEPLOY_CREATED_BOUND}");
        let total_deploys: i64 = conn.query_row(&total_sql, params![since, until], |r| r.get(0))?;

        let linked_sql = "SELECT COUNT(*) FROM deployments d \
             WHERE d.created_at_utc >= COALESCE(?1,'') \
               AND d.created_at_utc < COALESCE(?2,'9999-12-31T99:99:99Z') \
               AND EXISTS (SELECT 1 FROM incidents i \
                 WHERE i.deploy_repo_key = d.repo_key AND i.deploy_kind = d.kind \
                   AND i.deploy_ext_id = d.ext_id)";
        let deploys_with_incident: i64 =
            conn.query_row(linked_sql, params![since, until], |r| r.get(0))?;

        Ok(IncidentDoraStats {
            resolved_count,
            avg_mttr_hours,
            deploys_with_incident,
            total_deploys,
            has_source,
        })
    }
}
