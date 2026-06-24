//! Per-author (Path A of the team rollup) views over the commit data we already
//! store — no new tables, no ingestion change. Identity is the lowercased author
//! email. Lead-time / deploy-frequency per author need PR-author data and are left
//! to a later pass; this is the local-derivable DORA-lite subset.

use super::Db;
use crate::error::Result;
use rusqlite::params;
use serde::Serialize;

const COMMIT_BOUND: &str =
    " authored_at_utc >= COALESCE(?, '') AND authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";
const AI_PREDICATE: &str = "(ai_session_overlap=1 OR ai_coauthor_trailer=1)";
const HAS_EMAIL: &str = " author_email IS NOT NULL AND author_email != '' ";

#[derive(Debug, Serialize)]
pub struct AuthorRow {
    pub author_email: String,
    pub author_name: Option<String>,
    pub commits: i64,
    pub ai_commits: i64,
    pub human_commits: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub active_days: i64,
}

#[derive(Debug, Serialize)]
pub struct AuthorDoraRow {
    pub author_email: String,
    pub author_name: Option<String>,
    #[serde(rename = "throughputPerWeek")]
    pub throughput_per_week: Option<f64>,
    #[serde(rename = "changeFailurePct")]
    pub change_failure_pct: Option<f64>,
}

impl Db {
    /// Per-author commit leaderboard (busiest first), with AI split and active days.
    pub fn authors(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<AuthorRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT lower(author_email) AS email, MAX(author_name), COUNT(*), \
             COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN 1 ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN NOT {AI_PREDICATE} THEN 1 ELSE 0 END),0), \
             COALESCE(SUM(insertions),0), COALESCE(SUM(deletions),0), \
             COUNT(DISTINCT substr(authored_at_utc,1,10)) \
             FROM commits WHERE {COMMIT_BOUND} AND {HAS_EMAIL} \
             GROUP BY email ORDER BY 3 DESC, email"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(AuthorRow {
                    author_email: r.get(0)?,
                    author_name: r.get(1)?,
                    commits: r.get(2)?,
                    ai_commits: r.get(3)?,
                    human_commits: r.get(4)?,
                    insertions: r.get(5)?,
                    deletions: r.get(6)?,
                    active_days: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Per-author DORA-lite: throughput (commits/week) and a change-failure proxy
    /// (the same revert/hotfix heuristic as the global panel), from local git only.
    pub fn authors_dora(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<AuthorDoraRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT lower(author_email) AS email, MAX(author_name), COUNT(*), \
             COALESCE(julianday(MAX(authored_at_utc))-julianday(MIN(authored_at_utc)),0), \
             COALESCE(SUM(CASE WHEN lower(subject) LIKE 'revert%' OR lower(subject) LIKE '%hotfix%' \
                OR lower(subject) LIKE '%rollback%' THEN 1 ELSE 0 END),0) \
             FROM commits WHERE {COMMIT_BOUND} AND {HAS_EMAIL} \
             GROUP BY email ORDER BY 3 DESC, email"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                let email: String = r.get(0)?;
                let name: Option<String> = r.get(1)?;
                let commits: i64 = r.get(2)?;
                let span_days: f64 = r.get(3)?;
                let failures: i64 = r.get(4)?;
                let weeks = (span_days / 7.0).max(1.0);
                Ok(AuthorDoraRow {
                    author_email: email,
                    author_name: name,
                    throughput_per_week: (commits > 0).then(|| commits as f64 / weeks),
                    change_failure_pct: (commits > 0)
                        .then(|| failures as f64 / commits as f64 * 100.0),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CommitRow;

    fn commit(sha: &str, email: &str, at: &str, subject: &str, ai: bool) -> CommitRow {
        CommitRow {
            sha: sha.into(),
            project_slug: Some("repo".into()),
            author_name: Some(format!("Dev {email}")),
            author_email: Some(email.into()),
            authored_at_utc: at.into(),
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
        }
    }

    #[test]
    fn authors_group_by_email_with_ai_split() {
        let db = Db::open_in_memory().unwrap();
        db.insert_commits(
            "repo-key",
            &[
                commit("a", "alice@x.com", "2026-01-01T09:00:00Z", "feat: x", true),
                commit("b", "Alice@x.com", "2026-01-02T09:00:00Z", "fix: y", false),
                commit("c", "bob@x.com", "2026-01-01T09:00:00Z", "revert: z", false),
            ],
        )
        .unwrap();

        let authors = db.authors(None, None).unwrap();
        let alice = authors
            .iter()
            .find(|a| a.author_email == "alice@x.com")
            .unwrap();
        assert_eq!(alice.commits, 2); // case-insensitive identity
        assert_eq!(alice.ai_commits, 1);
        assert_eq!(alice.human_commits, 1);
        assert_eq!(alice.active_days, 2);

        let dora = db.authors_dora(None, None).unwrap();
        let bob = dora.iter().find(|a| a.author_email == "bob@x.com").unwrap();
        // Bob's single commit is a revert → 100% change-failure proxy.
        assert_eq!(bob.change_failure_pct, Some(100.0));
        assert!(bob.throughput_per_week.unwrap() > 0.0);
    }
}
