//! Commit-side write path (incremental ingest + AI-overlap correlation) and the
//! read queries backing `/api/commits`, `/api/commits/daily`, and
//! `/api/productivity`. Kept separate from `queries.rs` so the heavily-tested
//! message queries stay untouched. As everywhere, user-reachable values are bound.

use super::Db;
use crate::error::Result;
use crate::model::{
    CommitRow, DeploymentRow, PullRequestEventRow, PullRequestFileRow, PullRequestRow,
};
use rusqlite::params;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// `authored_at_utc >= since AND < until`, NULL bounds meaning unbounded. The
/// message queries' `TIME_BOUND` binds the `timestamp` column; this is its
/// commit-column twin (so we never touch those queries to add a second column).
const COMMIT_TIME_BOUND: &str =
    " authored_at_utc >= COALESCE(?, '') AND authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";

/// `ai_session_overlap=1 OR ai_coauthor_trailer=1` — a commit counts as AI-assisted
/// if *either* signal fires (the union the spec calls for).
const AI_PREDICATE: &str = "(ai_session_overlap=1 OR ai_coauthor_trailer=1)";

// ---------- DTOs ----------

#[derive(Debug, Serialize)]
pub struct CommitDailyRow {
    pub day: String,
    pub commits: i64,
    pub ai_commits: i64,
    pub human_commits: i64,
    pub insertions: i64,
    pub deletions: i64,
}

#[derive(Debug, Serialize)]
pub struct AiSplitRow {
    /// A day ("2026-06-20") or a project slug, per the requested grouping.
    pub key: String,
    pub ai_commits: i64,
    pub human_commits: i64,
}

/// One cell of the dense 7×24 productive-hours matrix (local weekday × hour).
#[derive(Debug, Serialize)]
pub struct ProductiveHourRow {
    /// 0=Sunday..6=Saturday.
    pub dow: i32,
    pub hour: i32,
    pub commits: i64,
    /// Assistant messages in that local bucket (the "Claude working" signal).
    pub messages: i64,
}

#[derive(Debug, Serialize)]
pub struct CommitRowDto {
    pub sha: String,
    pub repo_key: String,
    pub project_slug: Option<String>,
    pub sample_cwd: Option<String>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub authored_at_utc: String,
    pub authored_at_local: Option<String>,
    pub subject: Option<String>,
    pub branch: Option<String>,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub is_merge: bool,
    /// Either AI signal fired.
    pub ai_assisted: bool,
    pub ai_session_overlap: bool,
    pub ai_coauthor_trailer: bool,
    /// `Co-authored-by:` trailer values ("Name <email>").
    pub coauthors: Vec<String>,
}

/// A repo with GitHub coordinates — the unit of work for GitHub enrichment.
#[derive(Debug, Clone)]
pub struct GithubRepo {
    pub repo_key: String,
    pub primary_slug: Option<String>,
    pub slugs_json: Option<String>,
    pub owner: String,
    pub repo: String,
}

/// A discovered GitHub repo with its enable flag + last sync time (for the picker).
#[derive(Debug, Clone, Serialize)]
pub struct GithubRepoMeta {
    pub repo_key: String,
    pub owner: String,
    pub repo: String,
    pub primary_slug: Option<String>,
    pub enabled: bool,
    pub last_synced_at: Option<String>,
}

/// Per-(repo, resource) incremental sync state.
#[derive(Debug, Clone)]
pub struct SyncState {
    pub etag: Option<String>,
    pub high_water_utc: Option<String>,
    pub last_status: Option<String>,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PullRequestDto {
    pub repo_key: String,
    pub number: i64,
    pub title: Option<String>,
    pub state: Option<String>,
    pub author: Option<String>,
    pub created_at_utc: Option<String>,
    pub merged_at_utc: Option<String>,
    pub head_branch: Option<String>,
    pub base_branch: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub review_count: i64,
    pub html_url: Option<String>,
    pub ai_session_overlap: bool,
}

#[derive(Debug, Serialize)]
pub struct PullRequestEventDto {
    pub repo_key: String,
    pub pr_number: i64,
    pub event_type: String,
    pub ext_id: String,
    pub title: Option<String>,
    pub actor: Option<String>,
    pub body: Option<String>,
    pub state: Option<String>,
    pub conclusion: Option<String>,
    pub created_at_utc: Option<String>,
    pub html_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeploymentDto {
    pub repo_key: String,
    pub kind: String,
    pub ext_id: String,
    pub name: Option<String>,
    pub created_at_utc: Option<String>,
    pub status: Option<String>,
    pub html_url: Option<String>,
}

/// How to group an AI-vs-human commit split.
#[derive(Debug, Clone, Copy)]
pub enum AiSplitGroup {
    Day,
    Project,
}

impl AiSplitGroup {
    /// The (constant, never user-supplied) SQL grouping expression.
    fn expr(self) -> &'static str {
        match self {
            AiSplitGroup::Day => "substr(authored_at_utc,1,10)",
            AiSplitGroup::Project => "COALESCE(project_slug,'unknown')",
        }
    }
}

impl Db {
    // ---------- scan support ----------

    /// Distinct `(project_slug, cwd)` pairs — the seed for repo discovery.
    pub fn distinct_cwds(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT DISTINCT project_slug, cwd FROM messages WHERE cwd IS NOT NULL")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Earliest message timestamp across a repo's slugs — the lower bound for
    /// commit ingestion. Commits before any Claude activity on the repo are
    /// irrelevant to the AI-vs-human / session-overlap analysis (and on a large
    /// repo, diffing all of that ancient history dominates first-scan cost), so
    /// the git walk uses this to skip them.
    pub fn earliest_message_for_slugs(&self, slugs: &[&str]) -> Result<Option<String>> {
        if slugs.is_empty() {
            return Ok(None);
        }
        let conn = self.conn.lock().unwrap();
        let ph = vec!["?"; slugs.len()].join(",");
        let sql = format!("SELECT MIN(timestamp) FROM messages WHERE project_slug IN ({ph})");
        let params: Vec<&dyn rusqlite::ToSql> =
            slugs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let row: Option<String> = conn.query_row(&sql, params.as_slice(), |r| r.get(0))?;
        Ok(row)
    }

    /// The recorded HEAD (high-water mark) for a repo, if it has been scanned.
    pub fn repo_state_sha(&self, repo_key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT last_ingested_sha FROM git_repos WHERE repo_key=?1",
                params![repo_key],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok();
        Ok(row.flatten())
    }

    /// Insert new commits (one transaction, `INSERT OR IGNORE` so re-walks are
    /// idempotent). Returns the number of rows actually inserted.
    pub fn insert_commits(&self, repo_key: &str, commits: &[CommitRow]) -> Result<usize> {
        if commits.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut n = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO commits \
                 (repo_key, sha, project_slug, author_name, author_email, authored_at_utc, \
                  authored_at_local, authored_tz_offset_min, authored_local_hour, authored_dow, \
                  committed_at_utc, branch, message, subject, is_merge, files_changed, \
                  insertions, deletions, ai_coauthor_trailer, coauthors) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            )?;
            for c in commits {
                let coauthors = serde_json::to_string(&c.coauthors).unwrap_or_else(|_| "[]".into());
                n += stmt.execute(params![
                    repo_key,
                    c.sha,
                    c.project_slug,
                    c.author_name,
                    c.author_email,
                    c.authored_at_utc,
                    c.authored_at_local,
                    c.authored_tz_offset_min,
                    c.authored_local_hour,
                    c.authored_dow,
                    c.committed_at_utc,
                    c.branch,
                    c.message,
                    c.subject,
                    c.is_merge as i64,
                    c.files_changed,
                    c.insertions,
                    c.deletions,
                    c.ai_coauthor_trailer as i64,
                    coauthors
                ])?;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    /// Flag commits authored during (or within `grace_min` after) any Claude
    /// session on this repo's slugs. Both timestamp sides are normalized through
    /// `datetime()` so the raw ISO `…Z` strings and the grace-shifted bound compare
    /// in one canonical form. Idempotent: only flips rows still at 0.
    pub fn correlate_session_overlap(
        &self,
        repo_key: &str,
        slugs: &[&str],
        grace_min: i64,
    ) -> Result<()> {
        if slugs.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        let ph = vec!["?"; slugs.len()].join(",");
        let grace = format!("+{grace_min} minutes");
        // Placeholders are all bare `?`, numbered by appearance: slugs… , repo_key, grace.
        let sql = format!(
            "WITH sessions AS ( \
               SELECT MIN(timestamp) AS started, MAX(timestamp) AS ended \
               FROM messages WHERE project_slug IN ({ph}) GROUP BY session_id \
             ) \
             UPDATE commits SET ai_session_overlap = 1 \
             WHERE repo_key = ? AND ai_session_overlap = 0 AND EXISTS ( \
               SELECT 1 FROM sessions s \
               WHERE datetime(commits.authored_at_utc) >= datetime(s.started) \
                 AND datetime(commits.authored_at_utc) < datetime(s.ended, ?) \
             )"
        );
        let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(slugs.len() + 2);
        for s in slugs {
            p.push(s);
        }
        p.push(&repo_key);
        p.push(&grace);
        conn.execute(&sql, p.as_slice())?;
        Ok(())
    }

    /// Record a repo's HEAD high-water mark, slug set, and a fresh commit count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_repo_state(
        &self,
        repo_key: &str,
        repo_root: &str,
        primary_slug: Option<&str>,
        slugs_json: &str,
        head_sha: Option<&str>,
        head_branch: Option<&str>,
    ) -> Result<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO git_repos \
             (repo_key, repo_root, primary_slug, slugs_json, last_ingested_sha, head_branch, commit_count, last_scanned_at) \
             VALUES (?1,?2,?3,?4,?5,?6,(SELECT COUNT(*) FROM commits WHERE repo_key=?1),?7) \
             ON CONFLICT(repo_key) DO UPDATE SET \
               repo_root=?2, primary_slug=?3, slugs_json=?4, last_ingested_sha=?5, head_branch=?6, \
               commit_count=(SELECT COUNT(*) FROM commits WHERE repo_key=?1), last_scanned_at=?7",
            params![repo_key, repo_root, primary_slug, slugs_json, head_sha, head_branch, now],
        )?;
        Ok(())
    }

    /// Record a repo's origin remote (and parsed GitHub owner/repo) for opt-in
    /// enrichment. No-op if the repo row doesn't exist yet.
    pub fn set_repo_remote(
        &self,
        repo_key: &str,
        remote_url: Option<&str>,
        gh_owner: Option<&str>,
        gh_repo: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE git_repos SET remote_url=?2, gh_owner=?3, gh_repo=?4 WHERE repo_key=?1",
            params![repo_key, remote_url, gh_owner, gh_repo],
        )?;
        Ok(())
    }

    /// Repos with GitHub coordinates that are **enabled** for sync — the work-list
    /// for the enrichment sync. Disabled repos are excluded here (but still listed
    /// by [`github_repos_all`] for the picker).
    pub fn github_repos(&self) -> Result<Vec<GithubRepo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT repo_key, primary_slug, slugs_json, gh_owner, gh_repo \
             FROM git_repos WHERE gh_owner IS NOT NULL AND gh_repo IS NOT NULL \
               AND gh_sync_enabled = 1",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(GithubRepo {
                    repo_key: r.get(0)?,
                    primary_slug: r.get(1)?,
                    slugs_json: r.get(2)?,
                    owner: r.get(3)?,
                    repo: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Every GitHub-coordinate repo with its enabled flag + last sync time — backs
    /// the repo picker (which must show disabled repos too).
    pub fn github_repos_all(&self) -> Result<Vec<GithubRepoMeta>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT g.repo_key, g.gh_owner, g.gh_repo, g.primary_slug, g.gh_sync_enabled, \
             (SELECT MAX(s.last_synced_at) FROM github_sync_state s WHERE s.repo_key=g.repo_key) \
             FROM git_repos g WHERE g.gh_owner IS NOT NULL AND g.gh_repo IS NOT NULL \
             ORDER BY g.gh_owner, g.gh_repo",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(GithubRepoMeta {
                    repo_key: r.get(0)?,
                    owner: r.get(1)?,
                    repo: r.get(2)?,
                    primary_slug: r.get(3)?,
                    enabled: r.get::<_, i64>(4)? != 0,
                    last_synced_at: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Toggle a single repo's participation in the GitHub sync.
    pub fn set_repo_sync_enabled(&self, repo_key: &str, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE git_repos SET gh_sync_enabled=?2 WHERE repo_key=?1",
            params![repo_key, enabled as i64],
        )?;
        Ok(())
    }

    /// Toggle every repo of an owner/org at once (the per-org control).
    pub fn set_org_sync_enabled(&self, owner: &str, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE git_repos SET gh_sync_enabled=?2 WHERE gh_owner=?1",
            params![owner, enabled as i64],
        )?;
        Ok(())
    }

    /// Read the ETag + high-water mark for one (repo, resource).
    pub fn get_sync_state(&self, repo_key: &str, resource: &str) -> Result<Option<SyncState>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT etag, high_water_utc, last_status, last_synced_at \
                 FROM github_sync_state WHERE repo_key=?1 AND resource=?2",
                params![repo_key, resource],
                |r| {
                    Ok(SyncState {
                        etag: r.get(0)?,
                        high_water_utc: r.get(1)?,
                        last_status: r.get(2)?,
                        last_synced_at: r.get(3)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    /// Upsert the ETag + high-water mark for one (repo, resource).
    pub fn set_sync_state(
        &self,
        repo_key: &str,
        resource: &str,
        etag: Option<&str>,
        high_water_utc: Option<&str>,
        last_status: &str,
        last_synced_at: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO github_sync_state \
             (repo_key, resource, etag, high_water_utc, last_status, last_synced_at) \
             VALUES (?1,?2,?3,?4,?5,?6) \
             ON CONFLICT(repo_key, resource) DO UPDATE SET \
               etag=?3, high_water_utc=?4, last_status=?5, last_synced_at=?6",
            params![
                repo_key,
                resource,
                etag,
                high_water_utc,
                last_status,
                last_synced_at
            ],
        )?;
        Ok(())
    }

    // ---------- read queries ----------

    /// Per-day commit counts (AI / human split + churn). `day` aligns with the
    /// message `daily` query's day (both UTC `substr(…,1,10)`) so the web layer
    /// can overlay them by date.
    pub fn commits_daily(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<CommitDailyRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT substr(authored_at_utc,1,10) AS day, COUNT(*), \
             COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN 1 ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN NOT {AI_PREDICATE} THEN 1 ELSE 0 END),0), \
             COALESCE(SUM(insertions),0), COALESCE(SUM(deletions),0) \
             FROM commits WHERE {COMMIT_TIME_BOUND} GROUP BY day ORDER BY day"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(CommitDailyRow {
                    day: r.get(0)?,
                    commits: r.get(1)?,
                    ai_commits: r.get(2)?,
                    human_commits: r.get(3)?,
                    insertions: r.get(4)?,
                    deletions: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// AI-vs-human commit counts grouped by day or project.
    pub fn ai_split(
        &self,
        group: AiSplitGroup,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<AiSplitRow>> {
        let conn = self.conn.lock().unwrap();
        let expr = group.expr();
        let sql = format!(
            "SELECT {expr} AS key, \
             COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN 1 ELSE 0 END),0), \
             COALESCE(SUM(CASE WHEN NOT {AI_PREDICATE} THEN 1 ELSE 0 END),0) \
             FROM commits WHERE {COMMIT_TIME_BOUND} GROUP BY key ORDER BY key"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(AiSplitRow {
                    key: r.get(0)?,
                    ai_commits: r.get(1)?,
                    human_commits: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Dense 7×24 productive-hours matrix (local weekday × hour). Commits use their
    /// own stored local bucket (the committer's machine recorded the offset);
    /// messages are UTC and shifted by the caller-supplied `tz_offset_min`.
    pub fn productive_hours(
        &self,
        tz_offset_min: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<ProductiveHourRow>> {
        let conn = self.conn.lock().unwrap();

        let mut commit_grid = [[0i64; 24]; 7];
        {
            let sql = format!(
                "SELECT authored_dow, authored_local_hour, COUNT(*) \
                 FROM commits WHERE {COMMIT_TIME_BOUND} GROUP BY authored_dow, authored_local_hour"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (d, h, c) = row?;
                if (0..7).contains(&d) && (0..24).contains(&h) {
                    commit_grid[d as usize][h as usize] = c;
                }
            }
        }

        let mut msg_grid = [[0i64; 24]; 7];
        {
            // strftime applies the offset as a date modifier ("-180 minutes");
            // an unsigned positive value is treated as +N by SQLite.
            let modifier = format!("{tz_offset_min} minutes");
            let mut stmt = conn.prepare(
                "SELECT CAST(strftime('%w', timestamp, ?1) AS INTEGER), \
                 CAST(strftime('%H', timestamp, ?1) AS INTEGER), COUNT(*) \
                 FROM messages WHERE type='assistant' \
                   AND timestamp >= COALESCE(?2,'') AND timestamp < COALESCE(?3,'9999-12-31T99:99:99Z') \
                 GROUP BY 1, 2",
            )?;
            let rows = stmt.query_map(params![modifier, since, until], |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                if let (Some(d), Some(h), c) = row? {
                    if (0..7).contains(&d) && (0..24).contains(&h) {
                        msg_grid[d as usize][h as usize] = c;
                    }
                }
            }
        }

        let mut out = Vec::with_capacity(7 * 24);
        for d in 0..7 {
            for h in 0..24 {
                out.push(ProductiveHourRow {
                    dow: d as i32,
                    hour: h as i32,
                    commits: commit_grid[d][h],
                    messages: msg_grid[d][h],
                });
            }
        }
        Ok(out)
    }

    /// Recent commits (newest first) for the drill-down table, with a sample cwd
    /// resolved from the messages of the same project for nice path display.
    pub fn commits(
        &self,
        limit: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<CommitRowDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT c.sha, c.repo_key, c.project_slug, c.author_name, c.author_email, \
             c.authored_at_utc, c.authored_at_local, c.subject, c.branch, \
             c.files_changed, c.insertions, c.deletions, c.is_merge, \
             c.ai_session_overlap, c.ai_coauthor_trailer, \
             (SELECT m.cwd FROM messages m WHERE m.project_slug=c.project_slug AND m.cwd IS NOT NULL LIMIT 1), \
             c.coauthors \
             FROM commits c WHERE {COMMIT_TIME_BOUND} \
             ORDER BY c.authored_at_utc DESC LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until, limit], |r| {
                let overlap = r.get::<_, i64>(13)? != 0;
                let trailer = r.get::<_, i64>(14)? != 0;
                let coauthors = r
                    .get::<_, Option<String>>(16)?
                    .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
                    .unwrap_or_default();
                Ok(CommitRowDto {
                    sha: r.get(0)?,
                    repo_key: r.get(1)?,
                    project_slug: r.get(2)?,
                    author_name: r.get(3)?,
                    author_email: r.get(4)?,
                    authored_at_utc: r.get(5)?,
                    authored_at_local: r.get(6)?,
                    subject: r.get(7)?,
                    branch: r.get(8)?,
                    files_changed: r.get(9)?,
                    insertions: r.get(10)?,
                    deletions: r.get(11)?,
                    is_merge: r.get::<_, i64>(12)? != 0,
                    ai_assisted: overlap || trailer,
                    ai_session_overlap: overlap,
                    ai_coauthor_trailer: trailer,
                    sample_cwd: r.get(15)?,
                    coauthors,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Drop derived rows for repos whose key isn't in `keys` (orphans from renamed /
    /// removed repos, and the old per-worktree keys from before commondir dedup).
    /// No-op when `keys` is empty (avoids wiping everything on an empty discovery).
    pub fn retain_repos(&self, keys: &[String]) -> Result<()> {
        if keys.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let ph = vec!["?"; keys.len()].join(",");
        let params: Vec<&dyn rusqlite::ToSql> =
            keys.iter().map(|k| k as &dyn rusqlite::ToSql).collect();
        // Fixed, non-user table list → safe to interpolate.
        for table in [
            "commits",
            "deployments",
            "pull_request_ai_indexes",
            "pull_request_session_correlations",
            "pull_request_events",
            "pull_request_files",
            "pull_requests",
            "github_sync_state",
            "git_repos",
        ] {
            let sql = format!("DELETE FROM {table} WHERE repo_key NOT IN ({ph})");
            tx.execute(&sql, params.as_slice())?;
        }
        tx.commit()?;
        Ok(())
    }
}

// ---------- GitHub enrichment (Phase 2): pull requests + deployments ----------

impl Db {
    /// Upsert pull requests for a repo (one transaction). `INSERT OR REPLACE` so a
    /// re-sync refreshes mutable fields (state, merged_at, review_count, …).
    pub fn insert_pull_requests(&self, repo_key: &str, prs: &[PullRequestRow]) -> Result<usize> {
        if prs.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO pull_requests \
                 (repo_key, number, title, state, author, created_at_utc, merged_at_utc, closed_at_utc, \
                  head_branch, base_branch, additions, deletions, changed_files, review_count, \
                  first_review_at_utc, merge_commit_sha, head_sha, html_url, ai_session_overlap) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,\
                   COALESCE((SELECT ai_session_overlap FROM pull_requests WHERE repo_key=?1 AND number=?2),0))",
            )?;
            for pr in prs {
                stmt.execute(params![
                    repo_key,
                    pr.number,
                    pr.title,
                    pr.state,
                    pr.author,
                    pr.created_at_utc,
                    pr.merged_at_utc,
                    pr.closed_at_utc,
                    pr.head_branch,
                    pr.base_branch,
                    pr.additions,
                    pr.deletions,
                    pr.changed_files,
                    pr.review_count,
                    pr.first_review_at_utc,
                    pr.merge_commit_sha,
                    pr.head_sha,
                    pr.html_url
                ])?;
            }
        }
        tx.commit()?;
        Ok(prs.len())
    }

    /// Replace timeline events for the PRs included in a sync page. This keeps
    /// comments/reviews/checks fresh without preserving stale events that were
    /// deleted or re-run upstream.
    pub fn replace_pull_request_events(
        &self,
        repo_key: &str,
        events: &[PullRequestEventRow],
    ) -> Result<usize> {
        if events.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut seen_prs = std::collections::BTreeSet::new();
            for event in events {
                if seen_prs.insert(event.pr_number) {
                    tx.execute(
                        "DELETE FROM pull_request_events WHERE repo_key=?1 AND pr_number=?2",
                        params![repo_key, event.pr_number],
                    )?;
                }
            }
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO pull_request_events \
                 (repo_key, pr_number, event_type, ext_id, title, actor, body, state, conclusion, created_at_utc, html_url) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            )?;
            for event in events {
                stmt.execute(params![
                    repo_key,
                    event.pr_number,
                    event.event_type,
                    event.ext_id,
                    event.title,
                    event.actor,
                    event.body,
                    event.state,
                    event.conclusion,
                    event.created_at_utc,
                    event.html_url,
                ])?;
            }
        }
        tx.commit()?;
        Ok(events.len())
    }

    /// Replace changed-file rows for the PRs included in a sync page.
    pub fn replace_pull_request_files(
        &self,
        repo_key: &str,
        files: &[PullRequestFileRow],
    ) -> Result<usize> {
        if files.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut seen_prs = std::collections::BTreeSet::new();
            for file in files {
                if seen_prs.insert(file.pr_number) {
                    tx.execute(
                        "DELETE FROM pull_request_files WHERE repo_key=?1 AND pr_number=?2",
                        params![repo_key, file.pr_number],
                    )?;
                }
            }
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO pull_request_files \
                 (repo_key, pr_number, path, status, additions, deletions, changes, previous_path, blob_url) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            )?;
            for file in files {
                stmt.execute(params![
                    repo_key,
                    file.pr_number,
                    file.path,
                    file.status,
                    file.additions,
                    file.deletions,
                    file.changes,
                    file.previous_path,
                    file.blob_url,
                ])?;
            }
        }
        tx.commit()?;
        Ok(files.len())
    }

    /// Upsert deployment-like events for a repo (tags / releases / runs).
    pub fn insert_deployments(&self, repo_key: &str, deps: &[DeploymentRow]) -> Result<usize> {
        if deps.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO deployments \
                 (repo_key, kind, ext_id, name, created_at_utc, status, sha, html_url) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            for d in deps {
                stmt.execute(params![
                    repo_key,
                    d.kind,
                    d.ext_id,
                    d.name,
                    d.created_at_utc,
                    d.status,
                    d.sha,
                    d.html_url
                ])?;
            }
        }
        tx.commit()?;
        Ok(deps.len())
    }

    /// Flag PRs opened or merged during (or within `grace_min` after) a Claude
    /// session on this repo's slugs — the PR-level twin of commit session overlap.
    pub fn correlate_pr_overlap(
        &self,
        repo_key: &str,
        slugs: &[&str],
        grace_min: i64,
    ) -> Result<()> {
        if slugs.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        let ph = vec!["?"; slugs.len()].join(",");
        let grace = format!("+{grace_min} minutes");
        let sql = format!(
            "WITH sessions AS ( \
               SELECT MIN(timestamp) AS started, MAX(timestamp) AS ended \
               FROM messages WHERE project_slug IN ({ph}) GROUP BY session_id \
             ) \
             UPDATE pull_requests SET ai_session_overlap = 1 \
             WHERE repo_key = ? AND ai_session_overlap = 0 AND EXISTS ( \
               SELECT 1 FROM sessions s \
               WHERE (datetime(pull_requests.created_at_utc) >= datetime(s.started) \
                        AND datetime(pull_requests.created_at_utc) < datetime(s.ended, ?)) \
                  OR (pull_requests.merged_at_utc IS NOT NULL \
                        AND datetime(pull_requests.merged_at_utc) >= datetime(s.started) \
                        AND datetime(pull_requests.merged_at_utc) < datetime(s.ended, ?)) \
             )"
        );
        let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(slugs.len() + 3);
        for s in slugs {
            p.push(s);
        }
        p.push(&repo_key);
        p.push(&grace);
        p.push(&grace);
        conn.execute(&sql, p.as_slice())?;
        Ok(())
    }

    /// Recent pull requests (newest first) in range, by created date.
    pub fn pull_requests(
        &self,
        limit: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<PullRequestDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT repo_key, number, title, state, author, created_at_utc, merged_at_utc, \
             head_branch, base_branch, additions, deletions, changed_files, review_count, html_url, ai_session_overlap \
             FROM pull_requests \
             WHERE created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') \
             ORDER BY created_at_utc DESC LIMIT ?";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(params![since, until, limit], |r| {
                Ok(PullRequestDto {
                    repo_key: r.get(0)?,
                    number: r.get(1)?,
                    title: r.get(2)?,
                    state: r.get(3)?,
                    author: r.get(4)?,
                    created_at_utc: r.get(5)?,
                    merged_at_utc: r.get(6)?,
                    head_branch: r.get(7)?,
                    base_branch: r.get(8)?,
                    additions: r.get(9)?,
                    deletions: r.get(10)?,
                    changed_files: r.get(11)?,
                    review_count: r.get(12)?,
                    html_url: r.get(13)?,
                    ai_session_overlap: r.get::<_, i64>(14)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Recent deployments (newest first) in range.
    pub fn deployments(
        &self,
        limit: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<DeploymentDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT repo_key, kind, ext_id, name, created_at_utc, status, html_url \
             FROM deployments \
             WHERE created_at_utc >= COALESCE(?, '') AND created_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') \
             ORDER BY created_at_utc DESC LIMIT ?";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(params![since, until, limit], |r| {
                Ok(DeploymentDto {
                    repo_key: r.get(0)?,
                    kind: r.get(1)?,
                    ext_id: r.get(2)?,
                    name: r.get(3)?,
                    created_at_utc: r.get(4)?,
                    status: r.get(5)?,
                    html_url: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}
