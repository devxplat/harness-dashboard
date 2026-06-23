//! Fixture tests for the local-git data source: incremental ingest + idempotency,
//! the two AI-attribution signals (co-author trailer and session overlap), merge
//! handling, sub-directory cwd → repo resolution, productive-hours tz bucketing,
//! and the missing-since-sha full-rewalk fallback. Real repos are built on disk
//! with git2 (mirroring scan_dedup.rs's tempdir style).

use git2::{Repository, Signature, Time};
use harness_core::db::{AiSplitGroup, Db};
use harness_core::git;
use harness_core::model::{
    CalendarEventRow, CostSource, DeploymentRow, MessageRow, ProviderId, PullRequestRow, Usage,
    UsageSource,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_tmp(tag: &str) -> PathBuf {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("harness-git-{tag}-{n}"))
}

/// Epoch seconds for an RFC3339 instant (so a commit's `authored_at_utc` reads
/// back exactly as the literal we passed in).
fn epoch(rfc3339: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .unwrap()
        .timestamp()
}

fn init_repo(root: &Path) -> Repository {
    std::fs::create_dir_all(root).unwrap();
    Repository::init(root).unwrap()
}

/// Commit a file on top of the current HEAD (linear history). `secs`/`offset_min`
/// set the author + committer time so tz/overlap assertions are deterministic.
fn add_commit(
    repo: &Repository,
    file: &str,
    content: &str,
    message: &str,
    secs: i64,
    offset_min: i32,
) -> git2::Oid {
    let root = repo.workdir().unwrap();
    std::fs::write(root.join(file), content).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(file)).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let time = Time::new(secs, offset_min);
    let sig = Signature::new("Dev", "dev@example.com", &time).unwrap();
    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|o| repo.find_commit(o).ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .unwrap()
}

/// A minimal assistant message row whose `cwd` lives in `cwd` (drives repo
/// discovery) at instant `ts`.
fn message(uuid: &str, session: &str, slug: &str, cwd: &str, ts: &str) -> MessageRow {
    MessageRow {
        uuid: uuid.into(),
        provider: ProviderId::Claude,
        parent_uuid: None,
        session_id: session.into(),
        project_slug: slug.into(),
        cwd: Some(cwd.into()),
        git_branch: None,
        cc_version: None,
        entrypoint: None,
        msg_type: "assistant".into(),
        is_sidechain: false,
        agent_id: None,
        timestamp: ts.into(),
        model: Some("claude-opus-4-8".into()),
        stop_reason: None,
        prompt_id: None,
        message_id: Some(uuid.into()),
        usage: Usage::default(),
        usage_source: UsageSource::Exact,
        reported_cost_usd: None,
        cost_source: CostSource::ApiEstimate,
        source_path: None,
        source_key: None,
        source_fingerprint: None,
        prompt_text: None,
        attribution_skill: None,
        tool_calls: vec![],
    }
}

#[test]
fn ingest_basic_and_idempotent() {
    let root = unique_tmp("basic");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "add a",
        epoch("2026-06-20T09:00:00Z"),
        0,
    );
    add_commit(
        &repo,
        "b.txt",
        "bb",
        "add b",
        epoch("2026-06-20T11:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-20T08:00:00Z")])
        .unwrap();

    let (repos, commits) = git::scan_git(&db).unwrap();
    assert_eq!(repos, 1, "the seeded cwd's repo is discovered");
    assert_eq!(commits, 2, "both commits ingested");

    let daily = db.commits_daily(None, None).unwrap();
    assert_eq!(daily.len(), 1);
    assert_eq!(daily[0].day, "2026-06-20");
    assert_eq!(daily[0].commits, 2);

    // Re-scan with no new commits → idempotent (INSERT OR IGNORE), no duplicates.
    let (_repos2, commits2) = git::scan_git(&db).unwrap();
    assert_eq!(commits2, 0, "second scan ingests nothing new");
    assert_eq!(db.commits(100, None, None).unwrap().len(), 2);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn coauthor_trailer_flags_ai() {
    let root = unique_tmp("trailer");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "x.txt",
        "x",
        "feat: thing\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>",
        epoch("2026-06-20T10:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    // Message far from the commit so ONLY the trailer signal can fire.
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2020-01-01T00:00:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();

    let c = &db.commits(100, None, None).unwrap()[0];
    assert!(c.ai_coauthor_trailer, "trailer detected");
    assert!(
        !c.ai_session_overlap,
        "no session overlap (message is years away)"
    );
    assert!(c.ai_assisted);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn session_overlap_flags_ai() {
    let root = unique_tmp("overlap");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    // In-window commit (10:15, session 10:00–10:30) and an out-of-window control
    // the next day with no session.
    add_commit(
        &repo,
        "a.txt",
        "a",
        "during session",
        epoch("2026-06-20T10:15:00Z"),
        0,
    );
    add_commit(
        &repo,
        "b.txt",
        "b",
        "lone commit",
        epoch("2026-06-21T15:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[
        message("m1", "s1", "proj", &cwd, "2026-06-20T10:00:00Z"),
        message("m2", "s1", "proj", &cwd, "2026-06-20T10:30:00Z"),
    ])
    .unwrap();
    git::scan_git(&db).unwrap();

    let commits = db.commits(100, None, None).unwrap();
    let during = commits
        .iter()
        .find(|c| c.subject.as_deref() == Some("during session"))
        .unwrap();
    let lone = commits
        .iter()
        .find(|c| c.subject.as_deref() == Some("lone commit"))
        .unwrap();
    assert!(
        during.ai_session_overlap,
        "commit inside the session window is AI-assisted"
    );
    assert!(!during.ai_coauthor_trailer);
    assert!(
        !lone.ai_session_overlap,
        "commit outside any session is human"
    );
    assert!(!lone.ai_assisted);

    // AI-vs-human day split reflects the two classifications.
    let split = db.ai_split(AiSplitGroup::Day, None, None).unwrap();
    let d20 = split.iter().find(|r| r.key == "2026-06-20").unwrap();
    assert_eq!(d20.ai_commits, 1);
    let d21 = split.iter().find(|r| r.key == "2026-06-21").unwrap();
    assert_eq!(d21.human_commits, 1);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn grace_window_after_session_end() {
    let root = unique_tmp("grace");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    // 20 min after the session ended → within the 30-min grace → still AI.
    add_commit(
        &repo,
        "a.txt",
        "a",
        "just after",
        epoch("2026-06-20T10:50:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[
        message("m1", "s1", "proj", &cwd, "2026-06-20T10:00:00Z"),
        message("m2", "s1", "proj", &cwd, "2026-06-20T10:30:00Z"),
    ])
    .unwrap();
    git::scan_git(&db).unwrap();

    let c = &db.commits(100, None, None).unwrap()[0];
    assert!(
        c.ai_session_overlap,
        "commit within the grace window counts as AI"
    );

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn merge_commit_has_zero_stats() {
    let root = unique_tmp("merge");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    let base = add_commit(
        &repo,
        "a.txt",
        "a",
        "base",
        epoch("2026-06-20T09:00:00Z"),
        0,
    );
    let main_b = add_commit(
        &repo,
        "b.txt",
        "b",
        "main work",
        epoch("2026-06-20T09:30:00Z"),
        0,
    );
    // A feature commit branching off `base`, then a 2-parent merge.
    repo.branch("feature", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    let feat = {
        // Commit onto the feature branch ref directly (HEAD stays on main's branch).
        std::fs::write(root.join("c.txt"), "c").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("c.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::new(
            "Dev",
            "dev@example.com",
            &Time::new(epoch("2026-06-20T09:45:00Z"), 0),
        )
        .unwrap();
        repo.commit(
            Some("refs/heads/feature"),
            &sig,
            &sig,
            "feature work",
            &tree,
            &[&repo.find_commit(base).unwrap()],
        )
        .unwrap()
    };
    let merge_tree = repo.find_commit(main_b).unwrap().tree().unwrap();
    let sig = Signature::new(
        "Dev",
        "dev@example.com",
        &Time::new(epoch("2026-06-20T10:00:00Z"), 0),
    )
    .unwrap();
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "Merge feature",
        &merge_tree,
        &[
            &repo.find_commit(main_b).unwrap(),
            &repo.find_commit(feat).unwrap(),
        ],
    )
    .unwrap();

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2020-01-01T00:00:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();

    let commits = db.commits(100, None, None).unwrap();
    let merge = commits
        .iter()
        .find(|c| c.subject.as_deref() == Some("Merge feature"))
        .unwrap();
    assert!(merge.is_merge);
    assert_eq!(merge.insertions, 0, "merge diff stats are skipped");
    assert_eq!(merge.deletions, 0);
    // The feature branch commit is reachable from a branch tip → captured too.
    assert!(commits
        .iter()
        .any(|c| c.subject.as_deref() == Some("feature work")));

    std::fs::remove_dir_all(&root).ok();
}

fn pr(number: i64, created: &str, merged: Option<&str>) -> PullRequestRow {
    PullRequestRow {
        number,
        title: Some(format!("PR {number}")),
        state: Some(if merged.is_some() { "merged" } else { "open" }.into()),
        author: Some("dev".into()),
        created_at_utc: Some(created.into()),
        merged_at_utc: merged.map(str::to_string),
        closed_at_utc: None,
        head_branch: Some("feature".into()),
        base_branch: Some("main".into()),
        additions: 10,
        deletions: 2,
        changed_files: 3,
        review_count: 1,
        first_review_at_utc: None,
        merge_commit_sha: None,
        html_url: None,
    }
}

#[test]
fn pull_request_overlap_and_read() {
    let db = Db::open_in_memory().unwrap();
    // A Claude session 10:00–10:30 on slug "proj".
    db.insert_messages(&[
        message("m1", "s1", "proj", "/x", "2026-06-20T10:00:00Z"),
        message("m2", "s1", "proj", "/x", "2026-06-20T10:30:00Z"),
    ])
    .unwrap();
    db.insert_pull_requests(
        "repoA",
        &[
            pr(1, "2026-06-20T10:10:00Z", Some("2026-06-20T10:20:00Z")), // inside session
            pr(2, "2027-01-01T00:00:00Z", None),                         // long after
        ],
    )
    .unwrap();
    db.correlate_pr_overlap("repoA", &["proj"], 30).unwrap();

    let prs = db.pull_requests(10, None, None).unwrap();
    let p1 = prs.iter().find(|p| p.number == 1).unwrap();
    let p2 = prs.iter().find(|p| p.number == 2).unwrap();
    assert!(
        p1.ai_session_overlap,
        "PR opened/merged in-session is AI-assisted"
    );
    assert_eq!(p1.state.as_deref(), Some("merged"));
    assert!(!p2.ai_session_overlap);

    // Re-sync (idempotent upsert) preserves the overlap flag.
    db.insert_pull_requests(
        "repoA",
        &[pr(1, "2026-06-20T10:10:00Z", Some("2026-06-20T10:20:00Z"))],
    )
    .unwrap();
    let again = db.pull_requests(10, None, None).unwrap();
    assert!(
        again
            .iter()
            .find(|p| p.number == 1)
            .unwrap()
            .ai_session_overlap
    );
}

#[test]
fn deployments_insert_and_read() {
    let db = Db::open_in_memory().unwrap();
    db.insert_deployments(
        "repoA",
        &[
            DeploymentRow {
                kind: "release".into(),
                ext_id: "7".into(),
                name: Some("v1.0.0".into()),
                created_at_utc: Some("2026-06-20T12:00:00Z".into()),
                status: Some("success".into()),
                sha: None,
                html_url: None,
            },
            DeploymentRow {
                kind: "tag".into(),
                ext_id: "v0.9".into(),
                name: Some("v0.9".into()),
                created_at_utc: Some("2026-06-10T12:00:00Z".into()),
                status: None,
                sha: Some("abc".into()),
                html_url: None,
            },
        ],
    )
    .unwrap();
    let deps = db.deployments(10, None, None).unwrap();
    assert_eq!(deps.len(), 2);
    assert_eq!(deps[0].name.as_deref(), Some("v1.0.0"), "newest first");
}

#[test]
fn worktrees_do_not_duplicate_commits() {
    let root = unique_tmp("worktree-main");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "shared commit",
        epoch("2026-06-20T09:00:00Z"),
        0,
    );

    // A linked worktree: a separate working directory sharing the same object DB
    // (and thus the same commits) as the main checkout.
    let wt = unique_tmp("worktree-linked");
    repo.worktree("wt", &wt, None).unwrap();
    let wt_cwd = wt.to_string_lossy().to_string();

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[
        message("m1", "s1", "main-slug", &cwd, "2026-06-20T08:00:00Z"),
        message("m2", "s2", "wt-slug", &wt_cwd, "2026-06-20T08:30:00Z"),
    ])
    .unwrap();
    let (repos, _commits) = git::scan_git(&db).unwrap();

    assert_eq!(repos, 1, "main + worktree collapse to one logical repo");
    let commits = db.commits(100, None, None).unwrap();
    assert_eq!(
        commits.len(),
        1,
        "the shared commit is ingested once, not per-worktree"
    );

    std::fs::remove_dir_all(&root).ok();
    std::fs::remove_dir_all(&wt).ok();
}

#[test]
fn parses_and_stores_coauthors() {
    let root = unique_tmp("coauthor");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "feat: pair work\n\nCo-authored-by: Alice <alice@x.com>\nCo-Authored-By: Claude <noreply@anthropic.com>",
        epoch("2026-06-20T10:00:00Z"),
        0,
    );
    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-20T08:00:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();

    let c = &db.commits(10, None, None).unwrap()[0];
    assert_eq!(c.coauthors.len(), 2, "both co-author trailers captured");
    assert!(c.coauthors.iter().any(|a| a.contains("Alice")));
    assert!(
        c.ai_coauthor_trailer,
        "a Claude co-author marks the commit AI-assisted"
    );

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn ingests_tags_as_deployments_and_computes_dora() {
    let root = unique_tmp("dora");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "feat: a",
        epoch("2026-06-01T09:00:00Z"),
        0,
    );
    let tagged = add_commit(
        &repo,
        "b.txt",
        "b",
        "feat: b",
        epoch("2026-06-08T09:00:00Z"),
        0,
    );
    add_commit(
        &repo,
        "c.txt",
        "c",
        "Revert \"feat: b\"",
        epoch("2026-06-09T09:00:00Z"),
        0,
    );
    // A lightweight tag on the second commit → one local "deployment".
    repo.tag_lightweight("v1.0.0", &repo.find_object(tagged, None).unwrap(), false)
        .unwrap();

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-01T08:00:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();

    // The tag was ingested as a deployment.
    let deps = db.deployments(10, None, None).unwrap();
    assert!(deps
        .iter()
        .any(|d| d.kind == "tag" && d.name.as_deref() == Some("v1.0.0")));

    let dora = db.dora(None, None).unwrap();
    let by = |k: &str| dora.iter().find(|m| m.key == k).unwrap();
    assert!(by("throughput").exact, "throughput is exact (local git)");
    assert!(by("throughput").value.unwrap() > 0.0);
    // 1 revert of 3 commits → ~33% change failure.
    let cf = by("change_failure").value.unwrap();
    assert!((cf - 33.3).abs() < 1.0, "change failure ≈33%, got {cf}");
    assert!(
        by("deploy_frequency").value.unwrap() > 0.0,
        "the tag counts as a deploy"
    );
    // No PRs and no incidents → lead time / MTTR unavailable.
    assert!(by("lead_time").value.is_none());
    assert!(by("mttr").value.is_none());

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn meeting_impact_splits_output_in_vs_out_of_meetings() {
    let db = Db::open_in_memory().unwrap();
    // Two assistant messages: one during a 10:00–11:00 meeting, one outside.
    db.insert_messages(&[
        message("m1", "s1", "proj", "/x", "2026-06-20T10:30:00Z"),
        message("m2", "s1", "proj", "/x", "2026-06-20T14:00:00Z"),
    ])
    .unwrap();
    db.insert_calendar_events(&[CalendarEventRow {
        event_id: "e1".into(),
        calendar_id: Some("me@x.com".into()),
        start_utc: Some("2026-06-20T10:00:00Z".into()),
        end_utc: Some("2026-06-20T11:00:00Z".into()),
        title: Some("Planning".into()),
        attendee_count: 3,
        is_busy: true,
        updated_at_utc: None,
    }])
    .unwrap();

    let impact = db.meeting_impact(None, None).unwrap();
    assert_eq!(
        impact.during_messages, 1,
        "the 10:30 message is in the meeting"
    );
    assert_eq!(impact.free_messages, 1, "the 14:00 message is meeting-free");

    let days = db.meetings_daily(None, None).unwrap();
    assert_eq!(days.len(), 1);
    assert_eq!(days[0].day, "2026-06-20");
    assert_eq!(days[0].minutes, 60, "a one-hour busy meeting");
}

#[test]
fn skips_commits_before_first_session() {
    let root = unique_tmp("cutoff");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    // A commit from long before any Claude activity, then one during it.
    add_commit(
        &repo,
        "old.txt",
        "o",
        "ancient history",
        epoch("2020-01-01T09:00:00Z"),
        0,
    );
    add_commit(
        &repo,
        "new.txt",
        "n",
        "recent work",
        epoch("2026-06-20T10:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    // Earliest Claude activity on the repo is in 2026 → the 2020 commit is skipped.
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-19T08:00:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();

    let commits = db.commits(100, None, None).unwrap();
    assert_eq!(commits.len(), 1, "pre-session commit is not ingested");
    assert_eq!(commits[0].subject.as_deref(), Some("recent work"));

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn incremental_picks_up_only_new_commits() {
    let root = unique_tmp("incremental");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "first",
        epoch("2026-06-20T09:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-20T08:00:00Z")])
        .unwrap();
    let (_r, n1) = git::scan_git(&db).unwrap();
    assert_eq!(n1, 1);

    add_commit(
        &repo,
        "b.txt",
        "b",
        "second",
        epoch("2026-06-20T10:00:00Z"),
        0,
    );
    let (_r2, n2) = git::scan_git(&db).unwrap();
    assert_eq!(n2, 1, "only the new commit is ingested");
    assert_eq!(db.commits(100, None, None).unwrap().len(), 2);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn subdir_cwd_resolves_to_repo_root() {
    let root = unique_tmp("subdir");
    let repo = init_repo(&root);
    let sub = root.join("crates").join("inner");
    std::fs::create_dir_all(&sub).unwrap();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "only commit",
        epoch("2026-06-20T09:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    // The transcript cwd is a nested sub-directory, not the repo root.
    db.insert_messages(&[message(
        "m1",
        "s1",
        "proj",
        &sub.to_string_lossy(),
        "2026-06-20T08:00:00Z",
    )])
    .unwrap();
    let (repos, commits) = git::scan_git(&db).unwrap();
    assert_eq!(repos, 1, "sub-directory cwd resolves to the enclosing repo");
    assert_eq!(commits, 1);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn productive_hours_buckets_by_local_offset() {
    let root = unique_tmp("tz");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    // 01:30Z at -03:00 → local Fri (dow 5) 22:00 for both the commit (its own
    // offset) and the message (the configured -180 offset).
    add_commit(
        &repo,
        "a.txt",
        "a",
        "evening commit",
        epoch("2026-06-20T01:30:00Z"),
        -180,
    );

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-20T01:30:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();

    let hours = db.productive_hours(-180, None, None).unwrap();
    assert_eq!(hours.len(), 168, "dense 7×24 matrix");
    let cell = hours.iter().find(|h| h.dow == 5 && h.hour == 22).unwrap();
    assert_eq!(cell.commits, 1, "commit uses its own tz offset");
    assert_eq!(cell.messages, 1, "message shifted by the configured offset");

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn missing_since_sha_triggers_full_rewalk() {
    let root = unique_tmp("rewalk");
    let repo = init_repo(&root);
    let cwd = root.to_string_lossy().to_string();
    add_commit(
        &repo,
        "a.txt",
        "a",
        "first",
        epoch("2026-06-20T09:00:00Z"),
        0,
    );
    add_commit(
        &repo,
        "b.txt",
        "b",
        "second",
        epoch("2026-06-20T10:00:00Z"),
        0,
    );

    let db = Db::open_in_memory().unwrap();
    db.insert_messages(&[message("m1", "s1", "proj", &cwd, "2026-06-20T08:00:00Z")])
        .unwrap();
    git::scan_git(&db).unwrap();
    assert_eq!(db.commits(100, None, None).unwrap().len(), 2);

    // Simulate a rewritten history: point the high-water mark at a sha that no
    // longer exists. The next walk can't hide it, so it re-walks the whole graph;
    // INSERT OR IGNORE keeps it from duplicating.
    let repo_key = git::repo_key_for(Path::new(&cwd)).unwrap();
    db.set_repo_state(
        &repo_key,
        &repo_key,
        Some("proj"),
        "[\"proj\"]",
        Some("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
        Some("main"),
    )
    .unwrap();

    let (_r, n) = git::scan_git(&db).unwrap();
    assert_eq!(
        n, 0,
        "re-walk re-sees both commits but inserts no duplicates"
    );
    assert_eq!(db.commits(100, None, None).unwrap().len(), 2);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn github_repo_enable_toggle_and_sync_state() {
    let db = Db::open_in_memory().unwrap();
    // Two GitHub repos under two owners (rows created via the normal state path).
    db.set_repo_state(
        "rkA",
        "/a",
        Some("slugA"),
        "[\"slugA\"]",
        None,
        Some("main"),
    )
    .unwrap();
    db.set_repo_remote(
        "rkA",
        Some("https://github.com/acme/a.git"),
        Some("acme"),
        Some("a"),
    )
    .unwrap();
    db.set_repo_state(
        "rkB",
        "/b",
        Some("slugB"),
        "[\"slugB\"]",
        None,
        Some("main"),
    )
    .unwrap();
    db.set_repo_remote(
        "rkB",
        Some("https://github.com/rd/b.git"),
        Some("rd"),
        Some("b"),
    )
    .unwrap();

    // Enabled by default → both in the sync work-list and the picker listing.
    assert_eq!(db.github_repos().unwrap().len(), 2);
    assert_eq!(db.github_repos_all().unwrap().len(), 2);

    // Disable one → drops from the work-list but stays (disabled) in the listing.
    db.set_repo_sync_enabled("rkA", false).unwrap();
    assert_eq!(db.github_repos().unwrap().len(), 1);
    assert!(
        !db.github_repos_all()
            .unwrap()
            .iter()
            .find(|r| r.repo_key == "rkA")
            .unwrap()
            .enabled
    );

    // Per-org toggle flips every repo of an owner.
    db.set_org_sync_enabled("rd", false).unwrap();
    assert_eq!(db.github_repos().unwrap().len(), 0);

    // Sync-state round-trip; the listing carries the latest last_synced_at.
    db.set_sync_state(
        "rkA",
        "pulls",
        Some("etag1"),
        Some("2026-06-20T10:00:00Z"),
        "ok",
        "2026-06-20T10:00:00Z",
    )
    .unwrap();
    let st = db.get_sync_state("rkA", "pulls").unwrap().unwrap();
    assert_eq!(st.etag.as_deref(), Some("etag1"));
    assert_eq!(st.high_water_utc.as_deref(), Some("2026-06-20T10:00:00Z"));
    assert!(db.get_sync_state("rkA", "releases").unwrap().is_none());
    assert_eq!(
        db.github_repos_all()
            .unwrap()
            .iter()
            .find(|r| r.repo_key == "rkA")
            .unwrap()
            .last_synced_at
            .as_deref(),
        Some("2026-06-20T10:00:00Z"),
    );

    // retain_repos drops repos (and their sync state) not in the keep-set.
    db.retain_repos(&["rkA".to_string()]).unwrap();
    assert_eq!(db.github_repos_all().unwrap().len(), 1);
    assert!(db.get_sync_state("rkA", "pulls").unwrap().is_some());
}
