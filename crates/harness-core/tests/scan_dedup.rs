//! Golden test for the load-bearing invariant: streaming-snapshot dedup keys on
//! `(session_id, message_id)`, usage is never summed across snapshot siblings, and
//! tool_use blocks spread across siblings are re-pointed onto the keeper.

use harness_core::db::Db;
use harness_core::pricing::Pricing;
use harness_core::scan::scan_dir;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_tmp(tag: &str) -> PathBuf {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("harness-{tag}-{n}"))
}

/// A user turn, then one assistant response written as THREE streaming snapshots
/// that share `message.id = "msg1"` and repeat the same final usage. Each snapshot
/// carries a different `tool_use` block (parallel tools spread across siblings).
fn fixture_lines() -> String {
    let user = r#"{"uuid":"u1","sessionId":"s1","timestamp":"2026-06-20T10:00:00Z","type":"user","cwd":"/proj","message":{"role":"user","content":"please read the files"}}"#;
    let snap = |uuid: &str, tu: &str, file: &str| {
        format!(
            r#"{{"uuid":"{uuid}","parentUuid":"u1","sessionId":"s1","timestamp":"2026-06-20T10:00:01Z","type":"assistant","message":{{"id":"msg1","model":"claude-opus-4-8","stop_reason":"tool_use","usage":{{"input_tokens":100,"output_tokens":200,"cache_read_input_tokens":50,"cache_creation":{{"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":0}}}},"content":[{{"type":"tool_use","id":"{tu}","name":"Read","input":{{"file_path":"{file}"}}}}]}}}}"#
        )
    };
    [
        user.to_string(),
        snap("a1", "tuA", "/proj/a.rs"),
        snap("a2", "tuB", "/proj/b.rs"),
        snap("a3", "tuC", "/proj/c.rs"),
    ]
    .join("\n")
        + "\n"
}

#[test]
fn dedup_does_not_inflate_tokens() {
    let root = unique_tmp("dedup");
    let proj = root.join("projects").join("myproj");
    fs::create_dir_all(&proj).unwrap();
    fs::write(proj.join("s1.jsonl"), fixture_lines()).unwrap();

    let db = Db::open_in_memory().unwrap();
    let stats = scan_dir(&db, &root.join("projects")).unwrap();
    assert_eq!(stats.files, 1);

    // 2 message rows survive: the user turn + the single assistant keeper.
    assert_eq!(
        db.message_count().unwrap(),
        2,
        "snapshots must collapse to one keeper"
    );

    let pricing = Pricing::load_default();
    let t = db.overview_totals(&pricing, None, None).unwrap();
    assert_eq!(t.sessions, 1);
    assert_eq!(t.turns, 1);
    // Usage counted ONCE, not 3x.
    assert_eq!(
        t.input_tokens, 100,
        "usage must not be summed across snapshots"
    );
    assert_eq!(t.output_tokens, 200);
    assert_eq!(t.cache_read_tokens, 50);
    assert_eq!(t.cache_create_5m_tokens, 10);
    // opus 4.8: input 5 + output 25 + cache_read 0.5 per MTok over 1e6.
    let expected = (100.0 * 5.0 + 200.0 * 25.0 + 50.0 * 0.5 + 10.0 * 6.25) / 1_000_000.0;
    assert!((t.cost_usd.unwrap() - expected).abs() < 1e-9);

    // All three parallel Read tool calls re-pointed onto the keeper.
    let tools = db.tools(None, None).unwrap();
    let read = tools
        .iter()
        .find(|r| r.tool_name == "Read")
        .expect("Read tool present");
    assert_eq!(
        read.calls, 3,
        "parallel tool_use blocks must survive on the keeper"
    );

    // Workspaces: the three Read calls all land in the "myproj" workspace.
    let ws = db.workspaces(None, None).unwrap();
    let mp = ws
        .iter()
        .find(|w| w.workspace == "myproj")
        .expect("myproj workspace");
    assert_eq!(mp.calls, 3);
    assert_eq!(mp.files, 3);

    // Tips: this tiny fixture is below every rule threshold → no tips.
    assert!(db.tips(None, None).unwrap().is_empty());

    fs::remove_dir_all(&root).ok();
}

#[test]
fn rescan_unchanged_is_idempotent() {
    let root = unique_tmp("idem");
    let proj = root.join("projects").join("myproj");
    fs::create_dir_all(&proj).unwrap();
    fs::write(proj.join("s1.jsonl"), fixture_lines()).unwrap();

    let db = Db::open_in_memory().unwrap();
    let first = scan_dir(&db, &root.join("projects")).unwrap();
    assert!(first.messages >= 2);
    let count_after_first = db.message_count().unwrap();

    // Second scan sees no new bytes → no work, no change.
    let second = scan_dir(&db, &root.join("projects")).unwrap();
    assert_eq!(second.files, 0);
    assert_eq!(second.messages, 0);
    assert_eq!(db.message_count().unwrap(), count_after_first);

    fs::remove_dir_all(&root).ok();
}

#[test]
fn skills_and_subagents_breakdowns() {
    let root = unique_tmp("skills");
    let proj = root.join("projects").join("p");
    fs::create_dir_all(&proj).unwrap();
    let user = r#"{"uuid":"u1","sessionId":"s1","timestamp":"2026-06-19T10:00:00Z","type":"user","entrypoint":"cli","message":{"role":"user","content":"<command-name>/review</command-name> go"}}"#;
    let asst = r#"{"uuid":"a1","sessionId":"s1","timestamp":"2026-06-19T10:00:01Z","type":"assistant","entrypoint":"cli","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":20},"content":[{"type":"text","text":"ok"}]}}"#;
    fs::write(proj.join("s.jsonl"), format!("{user}\n{asst}\n")).unwrap();

    let db = Db::open_in_memory().unwrap();
    scan_dir(&db, &root.join("projects")).unwrap();

    let skills = db.skill_breakdown(None, None).unwrap();
    let review = skills
        .iter()
        .find(|s| s.skill == "review")
        .expect("review skill present");
    assert_eq!(
        review.manual_sessions, 1,
        "user-typed slash command counts as manual"
    );
    assert_eq!(review.tool_invocations, 0);

    let pricing = Pricing::load_default();
    let kinds = db.subagents_by_kind(&pricing, None, None).unwrap();
    assert!(
        kinds.iter().any(|k| k.group == "main"),
        "main-thread assistant work present"
    );
    let eps = db.subagents_by_entrypoint(&pricing, None, None).unwrap();
    assert!(
        eps.iter().any(|e| e.group == "cli"),
        "cli entrypoint present"
    );

    fs::remove_dir_all(&root).ok();
}
