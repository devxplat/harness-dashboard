//! Local git history ingestion (offline, synchronous).
//!
//! Discover every repository that sits behind a transcript `cwd`, read its commits
//! incrementally with `git2` (a from-source, statically-linked libgit2 — no system
//! git), and hand them to the database. Like the JSONL scanner this is incremental:
//! each repo records its HEAD as a high-water mark and the next pass walks only
//! `last..HEAD`. The on-disk repository is the source of truth, so the derived
//! `commits` / `git_repos` tables can be cleared and replayed at any time.

use crate::db::Db;
use crate::error::Result;
use crate::model::{CommitRow, DeploymentRow};
use chrono::{DateTime, Datelike, FixedOffset, SecondsFormat, Timelike, Utc};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Minutes after a session's last message a commit may still count as
/// AI-assisted by overlap. Generous enough to catch "Claude finished, I committed
/// a moment later", tight enough not to absorb the next manual commit hours on.
const GRACE_MINUTES: i64 = 30;

/// Commit-message markers (lower-cased substrings) that mean a Claude trailer is
/// present. Audited, intentionally small — these are the strings Claude Code
/// stamps into co-authored commits.
const AI_TRAILERS: &[&str] = &[
    "co-authored-by: claude",
    "noreply@anthropic.com",
    "generated with [claude code]",
];

/// True if the commit message carries a Claude co-author / "Generated with" trailer.
pub fn detect_ai_trailer(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    AI_TRAILERS.iter().any(|m| lower.contains(m))
}

/// Coarse investment category derived from a conventional-commit subject prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllocationClass {
    Feature,
    Fix,
    Ktlo,
    Chore,
    Other,
}

impl AllocationClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Feature => "feature",
            Self::Fix => "fix",
            Self::Ktlo => "ktlo",
            Self::Chore => "chore",
            Self::Other => "other",
        }
    }
}

/// Classify a commit subject by its conventional-commit type (the token before the
/// first `:`, ignoring an optional `(scope)` and a trailing `!`), case-insensitively.
/// `feat`→Feature; `fix`→Fix; refactor/perf/build/ci/revert→KTLO (keep-the-lights-on
/// maintenance); docs/style/test/chore→Chore; anything else→Other. Pure / unit-tested.
pub fn classify_allocation(subject: Option<&str>) -> AllocationClass {
    let Some(subject) = subject else {
        return AllocationClass::Other;
    };
    let head = subject.split(':').next().unwrap_or("");
    let token = head
        .split('(')
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches('!')
        .to_ascii_lowercase();
    match token.as_str() {
        "feat" => AllocationClass::Feature,
        "fix" => AllocationClass::Fix,
        "refactor" | "perf" | "build" | "ci" | "revert" => AllocationClass::Ktlo,
        "chore" | "docs" | "style" | "test" => AllocationClass::Chore,
        _ => AllocationClass::Other,
    }
}

/// Extract `Co-authored-by:` trailer values ("Name <email>") from a commit message,
/// case-insensitively. Order-preserving, de-duplicated.
pub fn parse_coauthors(message: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in message.lines() {
        let trimmed = line.trim();
        if trimmed.to_ascii_lowercase().starts_with("co-authored-by:") {
            if let Some((_, value)) = trimmed.split_once(':') {
                let value = value.trim();
                if !value.is_empty() && !out.iter().any(|v| v == value) {
                    out.push(value.to_string());
                }
            }
        }
    }
    out
}

/// Parse `(owner, repo)` from a GitHub origin remote URL — https, ssh, or scp-like
/// (`git@github.com:owner/repo.git`) forms. `None` for non-GitHub or unparseable
/// remotes. Offline, so it lives here in the pure core, not the network layer.
pub fn parse_github_remote(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    let no_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("ssh://"))
        .or_else(|| trimmed.strip_prefix("git://"))
        .unwrap_or(trimmed);
    // Drop any "git@" / "user@" credential prefix (scp-like and ssh forms).
    let host_path = no_scheme.rsplit('@').next().unwrap_or(no_scheme);
    let idx = host_path.find("github.com")?;
    let after = &host_path[idx + "github.com".len()..];
    let after = after
        .strip_prefix(':')
        .or_else(|| after.strip_prefix('/'))
        .unwrap_or(after)
        .trim_start_matches('/');
    let mut parts = after.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Stable, comparison-friendly key for a repo root.
fn path_key(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// Canonicalize, falling back to the input on failure (e.g. path no longer exists).
fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// The repository's shared common git dir (git2 0.19 has no `commondir()`). For a
/// normal repo this is `repo.path()` (`…/.git`); for a worktree, git writes a
/// `commondir` file in the per-worktree gitdir pointing back to the shared `…/.git`,
/// so all worktrees of a repo resolve to the same canonical path.
fn common_dir(repo: &git2::Repository) -> PathBuf {
    let gitdir = repo.path();
    if let Ok(rel) = std::fs::read_to_string(gitdir.join("commondir")) {
        return canonical(&gitdir.join(rel.trim()));
    }
    canonical(gitdir)
}

/// Where a `cwd` lives: the shared git common directory (the dedup key — identical
/// across all worktrees of one repo) and a working-tree root to open for walking.
pub struct RepoLoc {
    /// Canonical common `.git` dir — the per-repo identity, shared by all worktrees.
    pub key: String,
    /// A working-tree root to open (the worktree the cwd is in).
    pub workdir: PathBuf,
}

/// Locate the repository containing `cwd`. Uses libgit2 discovery, so a `.git`
/// *file* (worktrees / submodules) resolves correctly. `None` if `cwd` isn't in a
/// repo (bare, or gone from disk). The key is the **common** git dir so that the
/// many worktrees of one repo — which share the same commits — collapse to a single
/// logical repo instead of duplicating every commit per worktree.
pub fn locate_repo(cwd: &Path) -> Option<RepoLoc> {
    let repo = git2::Repository::discover(cwd).ok()?;
    let workdir = repo.workdir()?.to_path_buf();
    Some(RepoLoc {
        key: path_key(&common_dir(&repo)),
        workdir: canonical(&workdir),
    })
}

/// The repo key (canonical common git dir) for a `cwd` — the same identity ingestion
/// uses. Exposed for callers that need to address a repo by key.
pub fn repo_key_for(cwd: &Path) -> Option<String> {
    locate_repo(cwd).map(|l| l.key)
}

/// Derive `(utc_rfc3339, local_rfc3339, local_hour, dow)` from an epoch-seconds
/// instant and the commit's own tz offset (minutes east of UTC).
fn split_time(secs: i64, offset_min: i32) -> (String, Option<String>, i32, i32) {
    let utc = DateTime::<Utc>::from_timestamp(secs, 0)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).expect("epoch is valid"));
    let utc_s = utc.to_rfc3339_opts(SecondsFormat::Secs, true);
    match FixedOffset::east_opt(offset_min.saturating_mul(60)) {
        Some(off) => {
            let local = utc.with_timezone(&off);
            (
                utc_s,
                Some(local.to_rfc3339_opts(SecondsFormat::Secs, false)),
                local.hour() as i32,
                local.weekday().num_days_from_sunday() as i32,
            )
        }
        None => (
            utc_s,
            None,
            utc.hour() as i32,
            utc.weekday().num_days_from_sunday() as i32,
        ),
    }
}

/// Non-merge diff stats `(files_changed, insertions, deletions)`. Initial commits
/// diff against the empty tree (everything is an insertion); merges are handled by
/// the caller (skipped). Any failure degrades to zeros rather than aborting.
fn diff_stats(repo: &git2::Repository, commit: &git2::Commit) -> (i64, i64, i64) {
    let Ok(tree) = commit.tree() else {
        return (0, 0, 0);
    };
    let parent_tree = match commit.parent_count() {
        0 => None,
        _ => commit.parent(0).ok().and_then(|p| p.tree().ok()),
    };
    repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .ok()
        .and_then(|d| d.stats().ok())
        .map(|s| {
            (
                s.files_changed() as i64,
                s.insertions() as i64,
                s.deletions() as i64,
            )
        })
        .unwrap_or((0, 0, 0))
}

/// Result of an incremental walk of one repository.
pub struct RepoCommits {
    pub commits: Vec<CommitRow>,
    pub head_sha: Option<String>,
    pub head_branch: Option<String>,
    /// Origin remote URL and (for GitHub) parsed owner/repo, for opt-in enrichment.
    pub remote_url: Option<String>,
    pub gh_owner: Option<String>,
    pub gh_repo: Option<String>,
    /// Git tags as local "deployments" (the offline deploy-frequency source for DORA).
    pub tags: Vec<DeploymentRow>,
}

/// Tags (lightweight or annotated) as deployment rows, dated by their target
/// commit. Bounded by the same `cutoff_secs` as commits.
fn read_tags(repo: &git2::Repository, cutoff_secs: Option<i64>) -> Vec<DeploymentRow> {
    let Ok(names) = repo.tag_names(None) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for name in names.iter().flatten() {
        let Ok(obj) = repo.revparse_single(name) else {
            continue;
        };
        let Ok(commit) = obj.peel_to_commit() else {
            continue;
        };
        let when = commit.author().when();
        if let Some(cut) = cutoff_secs {
            if when.seconds() < cut {
                continue;
            }
        }
        let (utc, _, _, _) = split_time(when.seconds(), when.offset_minutes());
        out.push(DeploymentRow {
            kind: "tag".to_string(),
            ext_id: name.to_string(),
            name: Some(name.to_string()),
            created_at_utc: Some(utc),
            status: None,
            sha: Some(commit.id().to_string()),
            html_url: None,
        });
    }
    out
}

/// Margin (seconds) below the cutoff before the time-sorted walk gives up. The
/// walk is ordered by *committer* time but the cutoff is on *author* time; a rebase
/// can leave author time well behind committer time, so we keep walking a week past
/// the cutoff before breaking, to avoid dropping a recently-committed older change.
const CUTOFF_MARGIN_SECS: i64 = 7 * 24 * 3600;

/// Walk `last..HEAD` (across all local branches) of the repo at `root`, returning
/// the new commits plus the current HEAD sha/branch to record as the next
/// high-water mark.
///
/// `since_sha` is hidden from the walk so only new commits are returned. If it is
/// missing/garbage (a rebase or force-push rewrote history), the guard simply skips
/// the hide and the full set is re-walked — harmless because inserts are
/// `INSERT OR IGNORE` (idempotent).
///
/// `cutoff_secs` (epoch seconds, the earliest Claude activity on this repo) bounds
/// the expensive work: commits authored before it are skipped without computing
/// diff stats, and the walk breaks once it is a margin past the cutoff.
pub fn read_new_commits(
    root: &Path,
    project_slug: Option<&str>,
    since_sha: Option<&str>,
    cutoff_secs: Option<i64>,
) -> Result<RepoCommits> {
    let repo = git2::Repository::open(root)?;

    let (head_sha, head_branch) = {
        let head = repo.head().ok();
        (
            head.as_ref()
                .and_then(|h| h.target())
                .map(|o| o.to_string()),
            head.as_ref()
                .and_then(|h| h.shorthand())
                .map(str::to_string),
        )
    };

    let remote_url = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(str::to_string));
    let (gh_owner, gh_repo) = match remote_url.as_deref().and_then(parse_github_remote) {
        Some((o, r)) => (Some(o), Some(r)),
        None => (None, None),
    };

    let mut walk = repo.revwalk()?;
    walk.set_sorting(git2::Sort::TIME)?;

    if let Some(sha) = since_sha {
        if let Ok(oid) = git2::Oid::from_str(sha) {
            // Only hide a commit that still exists; an orphaned/garbage sha falls
            // through to a full re-walk (idempotent on insert).
            if repo.find_commit(oid).is_ok() {
                let _ = walk.hide(oid);
            }
        }
    }

    // Walk from HEAD and every local branch tip so commits on side branches that
    // were never on HEAD are still captured.
    let _ = walk.push_head();
    if let Ok(branches) = repo.branches(Some(git2::BranchType::Local)) {
        for (branch, _) in branches.flatten() {
            if let Some(oid) = branch.get().target() {
                let _ = walk.push(oid);
            }
        }
    }

    let mut commits = Vec::new();
    for oid in walk {
        let Ok(oid) = oid else { continue };
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        // The walk is committer-time descending; once we're a margin past the
        // cutoff, everything older follows, so stop. Skip (don't break) on author
        // time so we never diff pre-window commits.
        if let Some(cut) = cutoff_secs {
            if commit.time().seconds() < cut - CUTOFF_MARGIN_SECS {
                break;
            }
        }
        let author = commit.author();
        let when = author.when();
        if let Some(cut) = cutoff_secs {
            if when.seconds() < cut {
                continue;
            }
        }
        let (authored_at_utc, authored_at_local, hour, dow) =
            split_time(when.seconds(), when.offset_minutes());
        let committed = commit.committer().when();
        let (committed_at_utc, _, _, _) =
            split_time(committed.seconds(), committed.offset_minutes());

        let is_merge = commit.parent_count() > 1;
        let (files_changed, insertions, deletions) = if is_merge {
            (0, 0, 0)
        } else {
            diff_stats(&repo, &commit)
        };

        let message = commit.message().map(str::to_string);
        let ai_coauthor_trailer = message.as_deref().map(detect_ai_trailer).unwrap_or(false);
        let coauthors = message.as_deref().map(parse_coauthors).unwrap_or_default();

        commits.push(CommitRow {
            sha: oid.to_string(),
            project_slug: project_slug.map(str::to_string),
            author_name: author.name().map(str::to_string),
            author_email: author.email().map(str::to_string),
            authored_at_utc,
            authored_at_local,
            authored_tz_offset_min: when.offset_minutes(),
            authored_local_hour: hour,
            authored_dow: dow,
            committed_at_utc: Some(committed_at_utc),
            branch: head_branch.clone(),
            message,
            subject: commit.summary().map(str::to_string),
            is_merge,
            files_changed,
            insertions,
            deletions,
            ai_coauthor_trailer,
            coauthors,
        });
    }

    let tags = read_tags(&repo, cutoff_secs);

    Ok(RepoCommits {
        commits,
        head_sha,
        head_branch,
        remote_url,
        gh_owner,
        gh_repo,
        tags,
    })
}

/// Accumulated slugs + a representative workdir for one logical repo (keyed by its
/// shared common git dir, so every worktree of a repo aggregates here once).
struct RepoAcc {
    slugs: BTreeSet<String>,
    workdir: PathBuf,
}

/// Discover → per-repo incremental ingest → correlate AI session overlap → record
/// state, then prune repos that no longer back any transcript. Returns
/// `(repos_ingested, commits_inserted)`. A failure on one repo is caught and skipped
/// so a single bad repo never aborts the whole scan.
pub fn scan_git(db: &Db) -> Result<(i64, i64)> {
    // Group every distinct transcript cwd by the *common git dir* it lives under, so
    // the many worktrees of a single repo collapse to one logical repo (and one copy
    // of each shared commit) instead of duplicating commits per worktree.
    let mut repos: std::collections::HashMap<String, RepoAcc> = std::collections::HashMap::new();
    for (slug, cwd) in db.distinct_cwds()? {
        if let Some(loc) = locate_repo(Path::new(&cwd)) {
            repos
                .entry(loc.key)
                .or_insert_with(|| RepoAcc {
                    slugs: BTreeSet::new(),
                    workdir: loc.workdir,
                })
                .slugs
                .insert(slug);
        }
    }

    // Drop derived rows for repos no longer present (incl. the old per-worktree keys
    // from before this dedup) so stale duplicates disappear on the next scan.
    let keys: Vec<String> = repos.keys().cloned().collect();
    let _ = db.retain_repos(&keys);

    let mut repos_ingested = 0;
    let mut commits_inserted = 0;
    for (key, acc) in repos {
        match ingest_repo(db, &key, &acc.workdir, &acc.slugs) {
            Ok(n) => {
                repos_ingested += 1;
                commits_inserted += n;
            }
            // Best-effort: one unreadable repo must not sink the rest of the scan.
            Err(_) => continue,
        }
    }
    Ok((repos_ingested, commits_inserted))
}

/// Ingest one repo: walk new commits, insert them, correlate session overlap, then
/// record the new HEAD high-water mark. Returns the number of newly inserted commits.
fn ingest_repo(db: &Db, repo_key: &str, root: &Path, slugs: &BTreeSet<String>) -> Result<i64> {
    let since = db.repo_state_sha(repo_key)?;
    let primary = slugs.iter().next().map(String::as_str);
    let slug_list: Vec<&str> = slugs.iter().map(String::as_str).collect();

    // Lower-bound ingestion at the repo's earliest Claude activity (epoch secs).
    let cutoff_secs = db
        .earliest_message_for_slugs(&slug_list)?
        .and_then(|ts| DateTime::parse_from_rfc3339(&ts).ok())
        .map(|dt| dt.timestamp());

    let rc = read_new_commits(root, primary, since.as_deref(), cutoff_secs)?;
    let inserted = db.insert_commits(repo_key, &rc.commits)? as i64;
    db.insert_deployments(repo_key, &rc.tags)?;

    if !slug_list.is_empty() {
        db.correlate_session_overlap(repo_key, &slug_list, GRACE_MINUTES)?;
    }
    let slugs_json = serde_json::to_string(&slug_list)?;
    db.set_repo_state(
        repo_key,
        &root.to_string_lossy(),
        primary,
        &slugs_json,
        rc.head_sha.as_deref(),
        rc.head_branch.as_deref(),
    )?;
    // Record the origin remote (after the row exists) for opt-in GitHub enrichment.
    db.set_repo_remote(
        repo_key,
        rc.remote_url.as_deref(),
        rc.gh_owner.as_deref(),
        rc.gh_repo.as_deref(),
    )?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailer_detection_is_case_insensitive() {
        assert!(detect_ai_trailer(
            "fix things\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>"
        ));
        assert!(detect_ai_trailer("🤖 Generated with [Claude Code]"));
        assert!(detect_ai_trailer("CO-AUTHORED-BY: CLAUDE"));
        assert!(!detect_ai_trailer("a perfectly ordinary human commit"));
    }

    #[test]
    fn allocation_classifies_conventional_commits() {
        use AllocationClass::*;
        assert_eq!(classify_allocation(Some("feat: add page")), Feature);
        assert_eq!(classify_allocation(Some("FEAT: caps")), Feature);
        assert_eq!(classify_allocation(Some("fix(api): bug")), Fix);
        assert_eq!(classify_allocation(Some("feat!: breaking")), Feature);
        assert_eq!(classify_allocation(Some("refactor: tidy")), Ktlo);
        assert_eq!(classify_allocation(Some("ci: bump action")), Ktlo);
        assert_eq!(classify_allocation(Some("revert: oops")), Ktlo);
        assert_eq!(classify_allocation(Some("chore(deps): bump")), Chore);
        assert_eq!(classify_allocation(Some("docs: readme")), Chore);
        assert_eq!(classify_allocation(Some("random message")), Other);
        assert_eq!(classify_allocation(None), Other);
    }

    #[test]
    fn parses_coauthor_trailers() {
        let msg = "feat: x\n\nCo-authored-by: Alice <a@x.com>\nco-AUTHORED-by: Bob <b@x.com>\nCo-authored-by: Alice <a@x.com>";
        let co = parse_coauthors(msg);
        assert_eq!(
            co,
            vec!["Alice <a@x.com>", "Bob <b@x.com>"],
            "case-insensitive, de-duped"
        );
        assert!(parse_coauthors("no trailers here").is_empty());
    }

    #[test]
    fn parses_github_remotes() {
        let want = Some(("owner".to_string(), "repo".to_string()));
        assert_eq!(
            parse_github_remote("https://github.com/owner/repo.git"),
            want
        );
        assert_eq!(parse_github_remote("https://github.com/owner/repo"), want);
        assert_eq!(parse_github_remote("git@github.com:owner/repo.git"), want);
        assert_eq!(
            parse_github_remote("ssh://git@github.com/owner/repo.git"),
            want
        );
        // Non-GitHub or junk → None.
        assert_eq!(
            parse_github_remote("https://gitlab.com/owner/repo.git"),
            None
        );
        assert_eq!(parse_github_remote("git@github.com:owner"), None);
        assert_eq!(parse_github_remote(""), None);
    }

    #[test]
    fn split_time_buckets_local_offset() {
        // 2026-06-20T01:30:00Z at -03:00 → previous local hour 22 on Fri (dow 5).
        let secs = DateTime::parse_from_rfc3339("2026-06-20T01:30:00Z")
            .unwrap()
            .timestamp();
        let (utc, local, hour, dow) = split_time(secs, -180);
        assert_eq!(utc, "2026-06-20T01:30:00Z");
        assert_eq!(local.as_deref(), Some("2026-06-19T22:30:00-03:00"));
        assert_eq!(hour, 22);
        assert_eq!(dow, 5); // Friday
    }
}
