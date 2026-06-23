//! Write path (scan ingestion with snapshot dedup) and the read queries backing
//! the `/api/*` surface. All user-derived values are bound, never interpolated.

use super::Db;
use crate::error::Result;
use crate::model::{MessageRow, ProviderId, ToolCall, Usage};
use crate::pricing::Pricing;
use rusqlite::{params, ToSql};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// `timestamp >= since AND timestamp < until`, with NULL bounds meaning unbounded.
/// Bind `since` then `until` (both `Option<&str>`) wherever this fragment appears.
const TIME_BOUND: &str =
    " timestamp >= COALESCE(?, '') AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') ";

type ModelUsageRow = (String, Option<String>, i64, Usage);

fn provider_clause(column: &str, providers: &[ProviderId]) -> (String, Vec<&'static str>) {
    if providers.is_empty() || providers.len() >= ProviderId::ALL.len() {
        return (String::new(), Vec::new());
    }

    let mut seen = HashSet::new();
    let mut vals = Vec::new();
    for provider in providers {
        let value = provider.as_str();
        if seen.insert(value) {
            vals.push(value);
        }
    }
    if vals.is_empty() || vals.len() >= ProviderId::ALL.len() {
        return (String::new(), Vec::new());
    }
    let placeholders = vec!["?"; vals.len()].join(",");
    (format!(" AND {column} IN ({placeholders}) "), vals)
}

fn time_provider_params<'a>(
    since: &'a Option<&'a str>,
    until: &'a Option<&'a str>,
    providers: &'a [&'static str],
) -> Vec<&'a dyn ToSql> {
    let mut out: Vec<&dyn ToSql> = Vec::with_capacity(2 + providers.len());
    out.push(since);
    out.push(until);
    for provider in providers {
        out.push(provider);
    }
    out
}

fn provider_only_params<'a>(providers: &'a [&'static str]) -> Vec<&'a dyn ToSql> {
    let mut out: Vec<&dyn ToSql> = Vec::with_capacity(providers.len());
    for provider in providers {
        out.push(provider);
    }
    out
}

fn brief_json(row: &MessageRow) -> Option<String> {
    let briefs: Vec<_> = row
        .tool_calls
        .iter()
        .filter(|t| t.tool_name != "_tool_result")
        .map(|t| serde_json::json!({ "name": t.tool_name, "target": t.target }))
        .collect();
    if briefs.is_empty() {
        None
    } else {
        serde_json::to_string(&briefs).ok()
    }
}

// ---------- DTOs ----------

#[derive(Debug, Serialize)]
pub struct Totals {
    pub sessions: i64,
    pub turns: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_create_5m_tokens: i64,
    pub cache_create_1h_tokens: i64,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
    pub reported_cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct DailyRow {
    pub provider: String,
    pub day: String,
    pub sessions: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_create_tokens: i64,
}

/// A finer-than-daily activity bucket (half-day: AM/PM) — feeds the dense
/// "booking-sources"-style activity matrix so short ranges get more columns.
#[derive(Debug, Serialize)]
pub struct ActivityBucket {
    pub provider: String,
    pub key: String,
    pub day: String,
    pub half: String,
    pub sessions: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_create_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct ModelRow {
    pub provider: String,
    pub model: Option<String>,
    pub turns: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
}

#[derive(Debug, Serialize)]
pub struct ProjectRow {
    pub provider: String,
    pub providers: Vec<String>,
    pub project_slug: String,
    pub repo_key: Option<String>,
    pub repo_root: Option<String>,
    pub sample_cwd: Option<String>,
    pub sessions: i64,
    pub turns: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub billable_tokens: i64,
    pub cache_read_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct ToolRow {
    pub provider: String,
    pub tool_name: String,
    pub calls: i64,
    pub result_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct SessionRow {
    pub provider: String,
    pub session_id: String,
    pub project_slug: Option<String>,
    pub sample_cwd: Option<String>,
    pub started: Option<String>,
    pub ended: Option<String>,
    pub turns: i64,
    pub tokens: i64,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
    pub reported_cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct MessageDetail {
    pub provider: String,
    pub uuid: String,
    pub parent_uuid: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub timestamp: String,
    pub model: Option<String>,
    pub is_sidechain: bool,
    pub agent_id: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_create_5m_tokens: i64,
    pub cache_create_1h_tokens: i64,
    pub usage_source: String,
    pub reported_cost_usd: Option<f64>,
    pub cost_source: String,
    pub prompt_text: Option<String>,
    pub prompt_chars: Option<i64>,
    pub tool_calls_json: Option<String>,
    pub project_slug: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PromptRow {
    pub provider: String,
    pub user_uuid: String,
    pub session_id: String,
    pub project_slug: String,
    pub sample_cwd: Option<String>,
    pub timestamp: String,
    pub prompt_text: Option<String>,
    pub prompt_chars: Option<i64>,
    pub model: Option<String>,
    pub billable_tokens: i64,
    pub cache_read_tokens: i64,
    pub estimated_cost_usd: Option<f64>,
    pub cost_estimated: bool,
    pub reported_cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ProviderSummary {
    pub provider: String,
    pub label: String,
    pub sessions: i64,
    pub messages: i64,
    pub turns: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_create_tokens: i64,
    pub cost_usd: Option<f64>,
    pub reported_cost_usd: Option<f64>,
    pub tokens_available: bool,
    pub cost_available: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ProviderObservedStats {
    pub provider: String,
    pub sessions: i64,
    pub messages: i64,
    pub tools: i64,
    pub prompts: i64,
    pub usage_exact: bool,
    pub usage_reported: bool,
    pub usage_unavailable: bool,
    pub cost_estimated: bool,
    pub cost_reported: bool,
    pub cost_unavailable: bool,
}

#[derive(Debug, Serialize)]
pub struct OverviewUsageBundle {
    pub totals: Totals,
    pub projects: Vec<ProjectRow>,
    pub sessions: Vec<SessionRow>,
    pub daily: Vec<DailyRow>,
    pub activity: Vec<ActivityBucket>,
    pub providers: Vec<ProviderSummary>,
    #[serde(rename = "byModel")]
    pub by_model: Vec<ModelRow>,
}

#[derive(Default)]
struct TokenAcc {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_create_5m_tokens: i64,
    cache_create_1h_tokens: i64,
}

impl TokenAcc {
    fn add(&mut self, usage: Usage) {
        self.input_tokens += usage.input_tokens;
        self.output_tokens += usage.output_tokens;
        self.cache_read_tokens += usage.cache_read_tokens;
        self.cache_create_5m_tokens += usage.cache_create_5m_tokens;
        self.cache_create_1h_tokens += usage.cache_create_1h_tokens;
    }

    fn usage(&self) -> Usage {
        Usage {
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cache_read_tokens: self.cache_read_tokens,
            cache_create_5m_tokens: self.cache_create_5m_tokens,
            cache_create_1h_tokens: self.cache_create_1h_tokens,
        }
    }

    fn cache_create_tokens(&self) -> i64 {
        self.cache_create_5m_tokens + self.cache_create_1h_tokens
    }

    fn total_tokens(&self) -> i64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_create_5m_tokens
            + self.cache_create_1h_tokens
    }

    fn billable_tokens(&self) -> i64 {
        self.input_tokens + self.output_tokens + self.cache_create_tokens()
    }
}

#[derive(Default)]
struct DailyAcc {
    sessions: HashSet<String>,
    tokens: TokenAcc,
}

#[derive(Default)]
struct ModelAcc {
    turns: i64,
    tokens: TokenAcc,
}

#[derive(Default)]
struct ProviderAcc {
    sessions: HashSet<String>,
    messages: i64,
    turns: i64,
    tokens: TokenAcc,
    reported_cost_usd: Option<f64>,
    tokens_available: bool,
    cost_available: bool,
}

#[derive(Default)]
struct ProjectAcc {
    providers: BTreeSet<String>,
    project_slug: Option<String>,
    repo_key: Option<String>,
    repo_root: Option<String>,
    sessions: HashSet<String>,
    sample_cwd: Option<String>,
    turns: i64,
    tokens: TokenAcc,
}

#[derive(Default)]
struct SessionAcc {
    project_slug: Option<String>,
    sample_cwd: Option<String>,
    started: Option<String>,
    ended: Option<String>,
    turns: i64,
    tokens: TokenAcc,
    reported_cost_usd: Option<f64>,
    model_usage: HashMap<Option<String>, TokenAcc>,
}

fn add_reported_cost(dst: &mut Option<f64>, value: Option<f64>) {
    if let Some(value) = value {
        *dst = Some(dst.unwrap_or(0.0) + value);
    }
}

type RepoLookup = (
    HashMap<String, (String, String)>,
    Vec<(String, String, String)>,
);
type RepoResolutionCache = HashMap<(String, Option<String>), (Option<String>, Option<String>)>;

fn repo_lookup(conn: &rusqlite::Connection) -> Result<RepoLookup> {
    let mut stmt = conn.prepare("SELECT repo_key, repo_root, slugs_json FROM git_repos")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut by_slug = HashMap::new();
    let mut roots = Vec::new();
    for row in rows {
        let (repo_key, repo_root, slugs_json) = row?;
        roots.push((
            repo_key.clone(),
            repo_root.clone(),
            normalize_path_key(&repo_root),
        ));
        if let Some(slugs_json) = slugs_json {
            if let Ok(slugs) = serde_json::from_str::<Vec<String>>(&slugs_json) {
                for slug in slugs {
                    by_slug.insert(slug, (repo_key.clone(), repo_root.clone()));
                }
            }
        }
    }
    roots.sort_by_key(|(_, repo_root, _)| std::cmp::Reverse(repo_root.len()));
    Ok((by_slug, roots))
}

fn normalize_path_key(path: &str) -> String {
    display_path(path).replace('\\', "/").to_ascii_lowercase()
}

fn display_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{rest}")
    } else if let Some(rest) = path.strip_prefix("\\\\?\\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

fn repo_for_project(
    cwd: Option<&str>,
    project_slug: &str,
    by_slug: &HashMap<String, (String, String)>,
    roots: &[(String, String, String)],
) -> (Option<String>, Option<String>) {
    if let Some(candidate) = cwd {
        let cwd_key = normalize_path_key(candidate);
        for (repo_key, repo_root, root_key) in roots {
            if cwd_key == root_key.as_str() || cwd_key.starts_with(&format!("{root_key}/")) {
                return (Some(display_path(repo_key)), Some(display_path(repo_root)));
            }
        }
    }
    by_slug
        .get(project_slug)
        .cloned()
        .map(|(key, root)| (Some(display_path(&key)), Some(display_path(&root))))
        .unwrap_or((None, None))
}

fn priced_usage(
    pricing: &Pricing,
    provider: &str,
    model: Option<&str>,
    usage: &Usage,
) -> (Option<f64>, bool) {
    let provider = provider.parse().unwrap_or(ProviderId::Claude);
    let cost = pricing.cost_for_provider(provider, model, usage);
    (cost.usd, cost.estimated)
}

impl Db {
    // ---------- scan support ----------

    /// `(mtime, bytes_read)` for a previously-scanned file, if any.
    pub fn file_state(&self, path: &str) -> Result<Option<(f64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT mtime, bytes_read FROM files WHERE path=?1",
                params![path],
                |r| Ok((r.get::<_, f64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok();
        Ok(row)
    }

    pub fn set_file_state(
        &self,
        path: &str,
        mtime: f64,
        bytes_read: i64,
        scanned_at: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO files (path, mtime, bytes_read, scanned_at) VALUES (?1,?2,?3,?4) \
             ON CONFLICT(path) DO UPDATE SET mtime=?2, bytes_read=?3, scanned_at=?4",
            params![path, mtime, bytes_read, scanned_at],
        )?;
        Ok(())
    }

    pub fn source_item_fingerprint(
        &self,
        provider: ProviderId,
        source_path: &str,
        source_key: &str,
    ) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT fingerprint FROM source_items WHERE provider=?1 AND source_path=?2 AND source_key=?3",
                params![provider.as_str(), source_path, source_key],
                |r| r.get::<_, String>(0),
            )
            .ok();
        Ok(row)
    }

    pub fn set_source_item(
        &self,
        provider: ProviderId,
        source_path: &str,
        source_key: &str,
        fingerprint: &str,
        mtime: Option<f64>,
        scanned_at: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO source_items (provider, source_path, source_key, fingerprint, mtime, scanned_at) \
             VALUES (?1,?2,?3,?4,?5,?6) \
             ON CONFLICT(provider, source_path, source_key) DO UPDATE SET fingerprint=?4, mtime=?5, scanned_at=?6",
            params![
                provider.as_str(),
                source_path,
                source_key,
                fingerprint,
                mtime,
                scanned_at
            ],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn replace_source_item_rows(
        &self,
        provider: ProviderId,
        source_path: &str,
        source_key: &str,
        fingerprint: &str,
        mtime: Option<f64>,
        scanned_at: f64,
        rows: &[MessageRow],
    ) -> Result<(usize, usize)> {
        if self.source_item_fingerprint(provider, source_path, source_key)?
            == Some(fingerprint.to_string())
        {
            return Ok((0, 0));
        }
        {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM tool_calls WHERE message_uuid IN \
                 (SELECT uuid FROM messages WHERE provider=?1 AND source_path=?2 AND source_key=?3)",
                params![provider.as_str(), source_path, source_key],
            )?;
            tx.execute(
                "DELETE FROM messages WHERE provider=?1 AND source_path=?2 AND source_key=?3",
                params![provider.as_str(), source_path, source_key],
            )?;
            tx.execute(
                "INSERT INTO source_items (provider, source_path, source_key, fingerprint, mtime, scanned_at) \
                 VALUES (?1,?2,?3,?4,?5,?6) \
                 ON CONFLICT(provider, source_path, source_key) DO UPDATE SET fingerprint=?4, mtime=?5, scanned_at=?6",
                params![
                    provider.as_str(),
                    source_path,
                    source_key,
                    fingerprint,
                    mtime,
                    scanned_at
                ],
            )?;
            tx.commit()?;
        }
        self.insert_messages(rows)
    }

    pub fn prune_missing_source_items(
        &self,
        provider: ProviderId,
        source_path: &str,
        seen_keys: &HashSet<String>,
    ) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let existing = {
            let mut stmt = tx.prepare(
                "SELECT source_key FROM source_items WHERE provider=?1 AND source_path=?2",
            )?;
            let rows = stmt
                .query_map(params![provider.as_str(), source_path], |r| {
                    r.get::<_, String>(0)
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let stale = existing
            .into_iter()
            .filter(|key| !seen_keys.contains(key))
            .collect::<Vec<_>>();
        for key in &stale {
            tx.execute(
                "DELETE FROM tool_calls WHERE message_uuid IN \
                 (SELECT uuid FROM messages WHERE provider=?1 AND source_path=?2 AND source_key=?3)",
                params![provider.as_str(), source_path, key],
            )?;
            tx.execute(
                "DELETE FROM messages WHERE provider=?1 AND source_path=?2 AND source_key=?3",
                params![provider.as_str(), source_path, key],
            )?;
            tx.execute(
                "DELETE FROM source_items WHERE provider=?1 AND source_path=?2 AND source_key=?3",
                params![provider.as_str(), source_path, key],
            )?;
        }
        tx.commit()?;
        Ok(stale.len())
    }

    /// Insert a batch of parsed rows, applying streaming-snapshot dedup
    /// (`(session_id, message_id)` keeper, tool re-pointing). Returns
    /// `(messages_inserted, tool_calls_inserted)`.
    pub fn insert_messages(&self, rows: &[MessageRow]) -> Result<(usize, usize)> {
        if rows.is_empty() {
            return Ok((0, 0));
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Last index per (provider, session_id, message_id) within this batch.
        let mut last_idx: HashMap<(&str, &str, &str), usize> = HashMap::new();
        for (i, r) in rows.iter().enumerate() {
            if let Some(mid) = r.message_id.as_deref() {
                last_idx.insert((r.provider.as_str(), r.session_id.as_str(), mid), i);
            }
        }
        let keeper_uuid = |r: &MessageRow| -> String {
            match r.message_id.as_deref() {
                Some(mid) => rows[last_idx[&(r.provider.as_str(), r.session_id.as_str(), mid)]]
                    .uuid
                    .clone(),
                None => r.uuid.clone(),
            }
        };

        // Accumulate every sibling's tool calls onto the keeper (so parallel
        // tool_use blocks spread across snapshots survive).
        let mut tools_for: HashMap<String, Vec<&ToolCall>> = HashMap::new();
        for r in rows {
            let k = keeper_uuid(r);
            tools_for.entry(k).or_default().extend(r.tool_calls.iter());
        }

        let mut msg_n = 0usize;
        let mut tool_n = 0usize;
        let mut keepers: Vec<&MessageRow> = Vec::new();

        for (i, r) in rows.iter().enumerate() {
            let is_keeper = match r.message_id.as_deref() {
                Some(mid) => last_idx[&(r.provider.as_str(), r.session_id.as_str(), mid)] == i,
                None => true,
            };
            if !is_keeper {
                continue;
            }
            // Cross-batch eviction: an earlier scan pass may have stored an earlier
            // snapshot of this message under a different uuid. Re-point its tools
            // onto this keeper, then delete the superseded message row.
            if let Some(mid) = r.message_id.as_deref() {
                tx.execute(
                    "UPDATE tool_calls SET message_uuid=?1 WHERE message_uuid IN \
                     (SELECT uuid FROM messages WHERE provider=?2 AND session_id=?3 AND message_id=?4 AND uuid<>?1)",
                    params![r.uuid, r.provider.as_str(), r.session_id, mid],
                )?;
                tx.execute(
                    "DELETE FROM messages WHERE provider=?1 AND session_id=?2 AND message_id=?3 AND uuid<>?4",
                    params![r.provider.as_str(), r.session_id, mid, r.uuid],
                )?;
            }

            let prompt_chars = r.prompt_text.as_ref().map(|t| t.chars().count() as i64);
            tx.execute(
                "DELETE FROM tool_calls WHERE message_uuid=?1",
                params![r.uuid],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO messages \
                 (uuid,provider,parent_uuid,session_id,project_slug,cwd,git_branch,cc_version,entrypoint,type,\
                  is_sidechain,agent_id,timestamp,model,stop_reason,prompt_id,message_id,\
                  input_tokens,output_tokens,cache_read_tokens,cache_create_5m_tokens,cache_create_1h_tokens,\
                  usage_source,reported_cost_usd,cost_source,source_path,source_key,source_fingerprint,\
                  prompt_text,prompt_chars,tool_calls_json,attribution_skill) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32)",
                params![
                    r.uuid, r.provider.as_str(), r.parent_uuid, r.session_id, r.project_slug, r.cwd, r.git_branch,
                    r.cc_version, r.entrypoint, r.msg_type, r.is_sidechain as i64, r.agent_id,
                    r.timestamp, r.model, r.stop_reason, r.prompt_id, r.message_id,
                    r.usage.input_tokens, r.usage.output_tokens, r.usage.cache_read_tokens,
                    r.usage.cache_create_5m_tokens, r.usage.cache_create_1h_tokens,
                    r.usage_source.as_str(), r.reported_cost_usd, r.cost_source.as_str(),
                    r.source_path, r.source_key, r.source_fingerprint,
                    r.prompt_text, prompt_chars, brief_json(r), r.attribution_skill
                ],
            )?;
            msg_n += 1;
            keepers.push(r);
        }

        // Insert each keeper's accumulated tool calls, deduping repeated
        // `tool_use_id`s carried across snapshots.
        for r in &keepers {
            let mut seen: HashSet<&str> = HashSet::new();
            if let Some(tcs) = tools_for.get(&r.uuid) {
                for tc in tcs {
                    if let Some(id) = tc.tool_use_id.as_deref() {
                        if !seen.insert(id) {
                            continue;
                        }
                    }
                    tx.execute(
                        "INSERT INTO tool_calls \
                         (provider,message_uuid,session_id,project_slug,tool_name,target,result_tokens,is_error,timestamp,tool_use_id) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                        params![
                            r.provider.as_str(), r.uuid, r.session_id, r.project_slug, tc.tool_name, tc.target,
                            tc.result_tokens, tc.is_error as i64, r.timestamp, tc.tool_use_id
                        ],
                    )?;
                    tool_n += 1;
                }
            }
        }

        // Dedup tool rows sharing (message_uuid, tool_use_id), keeping the earliest
        // — covers the cross-batch re-point above. Scoped to THIS batch's keepers
        // so it never scans the whole (growing) table.
        for chunk in keepers.chunks(300) {
            let ph = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "DELETE FROM tool_calls WHERE tool_use_id IS NOT NULL AND message_uuid IN ({ph}) \
                 AND id NOT IN (SELECT MIN(id) FROM tool_calls \
                   WHERE tool_use_id IS NOT NULL AND message_uuid IN ({ph}) \
                   GROUP BY message_uuid, tool_use_id)"
            );
            let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() * 2);
            for r in chunk {
                p.push(&r.uuid);
            }
            for r in chunk {
                p.push(&r.uuid);
            }
            tx.execute(&sql, p.as_slice())?;
        }

        tx.commit()?;
        Ok((msg_n, tool_n))
    }

    // ---------- plan / settings ----------

    pub fn get_plan(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT v FROM plan WHERE k='plan'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap_or_else(|_| "api".to_string()))
    }

    pub fn set_plan(&self, plan: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO plan (k,v) VALUES ('plan',?1) ON CONFLICT(k) DO UPDATE SET v=?1",
            params![plan],
        )?;
        Ok(())
    }

    /// Read a key from the `settings` k/v table (used for integration tokens).
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let v = conn
            .query_row("SELECT v FROM settings WHERE k=?1", params![key], |r| {
                r.get::<_, String>(0)
            })
            .ok();
        Ok(v)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (k,v) VALUES (?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM settings WHERE k=?1", params![key])?;
        Ok(())
    }

    pub fn reset_provider_derived_rows(
        &self,
        provider: ProviderId,
        root: &std::path::Path,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let provider = provider.as_str();
        let root_prefix = root.to_string_lossy().to_string();
        tx.execute(
            "DELETE FROM tool_calls WHERE provider=?1",
            params![provider],
        )?;
        tx.execute("DELETE FROM messages WHERE provider=?1", params![provider])?;
        tx.execute(
            "DELETE FROM files WHERE path LIKE ?1",
            params![format!("{root_prefix}%")],
        )?;
        tx.execute(
            "DELETE FROM source_items WHERE provider=?1",
            params![provider],
        )?;
        tx.commit()?;
        Ok(())
    }

    // ---------- read queries ----------

    /// Per-model assistant usage in range (the basis for cost rollups).
    fn model_usage_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<ModelUsageRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let unbounded = since.is_none() && until.is_none();
        let sql = if unbounded {
            format!(
                "SELECT provider, model, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0), \
                 SUM(cache_create_5m_tokens), SUM(cache_create_1h_tokens) \
                 FROM messages INDEXED BY idx_messages_model_cover \
                 WHERE type='assistant' {provider_sql} GROUP BY provider, model"
            )
        } else {
            format!(
                "SELECT provider, model, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0), \
                 SUM(cache_create_5m_tokens), SUM(cache_create_1h_tokens) \
                 FROM messages INDEXED BY idx_messages_model_cover \
                 WHERE type='assistant' AND {TIME_BOUND} {provider_sql} GROUP BY provider, model"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let params = if unbounded {
            provider_only_params(&provider_params)
        } else {
            time_provider_params(&since, &until, &provider_params)
        };
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                    Usage {
                        input_tokens: r.get(3)?,
                        output_tokens: r.get(4)?,
                        cache_read_tokens: r.get(5)?,
                        cache_create_5m_tokens: r.get(6)?,
                        cache_create_1h_tokens: r.get(7)?,
                    },
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Overview data folded from one pass over `messages`. The older endpoint
    /// queries are still available for focused pages, but the dashboard bundle
    /// needs to avoid scanning a large local history once per tile/chart.
    pub fn overview_usage_bundle_for_providers(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
        project_limit: usize,
        session_limit: usize,
    ) -> Result<OverviewUsageBundle> {
        if std::env::var_os("HARNESS_LEGACY_OVERVIEW_BUNDLE").is_none() {
            let totals = self.overview_totals_for_providers(pricing, since, until, providers)?;
            let by_model = self.by_model_for_providers(pricing, since, until, providers)?;
            let providers_summary = self.provider_summaries(pricing, since, until, providers)?;
            let daily = self.daily_for_providers(since, until, providers)?;
            let activity = self.activity_buckets_for_providers(since, until, providers)?;
            let mut projects = if project_limit == 0 {
                Vec::new()
            } else {
                self.projects_for_providers(since, until, providers)?
            };
            projects.truncate(project_limit);
            let sessions = if session_limit == 0 {
                Vec::new()
            } else {
                self.recent_sessions_for_providers(
                    pricing,
                    session_limit.min(i64::MAX as usize) as i64,
                    since,
                    until,
                    providers,
                )?
            };

            return Ok(OverviewUsageBundle {
                totals,
                projects,
                sessions,
                daily,
                activity,
                providers: providers_summary,
                by_model,
            });
        }

        let conn = self.conn.lock().unwrap();
        let (repo_by_slug, repo_roots) = repo_lookup(&conn)?;
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let sql = format!(
            "SELECT provider, session_id, project_slug, cwd, type, timestamp, model, \
             CASE WHEN prompt_chars IS NOT NULL THEN 1 ELSE 0 END, \
             input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, \
             usage_source, cost_source, reported_cost_usd \
             FROM messages INDEXED BY idx_messages_bundle_scan_cover WHERE {TIME_BOUND} {provider_sql}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params = time_provider_params(&since, &until, &provider_params);

        let mut total_sessions: HashSet<(String, String)> = HashSet::new();
        let mut total_turns = 0;
        let mut total_tokens = TokenAcc::default();
        let mut total_reported_cost = None;

        let mut daily: BTreeMap<(String, String), DailyAcc> = BTreeMap::new();
        let mut activity: BTreeMap<(String, String, String), DailyAcc> = BTreeMap::new();
        let mut by_model: HashMap<(String, Option<String>), ModelAcc> = HashMap::new();
        let mut provider_totals: BTreeMap<String, ProviderAcc> = BTreeMap::new();
        let mut projects: HashMap<String, ProjectAcc> = HashMap::new();
        let mut repo_cache: RepoResolutionCache = HashMap::new();
        let mut sessions: HashMap<(String, String), SessionAcc> = HashMap::new();
        let include_breakdown = project_limit > 0 || session_limit > 0;

        let mut rows = stmt.query(params.as_slice())?;
        while let Some(r) = rows.next()? {
            let provider: String = r.get(0)?;
            let session_id: String = r.get(1)?;
            let project_slug: String = r.get(2)?;
            let cwd: Option<String> = r.get(3)?;
            let msg_type: String = r.get(4)?;
            let timestamp: String = r.get(5)?;
            let model: Option<String> = r.get(6)?;
            let has_prompt_text = r.get::<_, i64>(7)? != 0;
            let usage = Usage {
                input_tokens: r.get(8)?,
                output_tokens: r.get(9)?,
                cache_read_tokens: r.get(10)?,
                cache_create_5m_tokens: r.get(11)?,
                cache_create_1h_tokens: r.get(12)?,
            };
            let usage_source: String = r.get(13)?;
            let cost_source: String = r.get(14)?;
            let reported_cost: Option<f64> = r.get(15)?;

            let is_turn = msg_type == "user" && has_prompt_text;
            total_sessions.insert((provider.clone(), session_id.clone()));
            if is_turn {
                total_turns += 1;
            }
            total_tokens.add(usage);
            add_reported_cost(&mut total_reported_cost, reported_cost);

            if include_breakdown {
                let day = timestamp.get(0..10).unwrap_or("").to_string();
                if !day.is_empty() {
                    let d = daily.entry((provider.clone(), day.clone())).or_default();
                    d.sessions.insert(session_id.clone());
                    d.tokens.add(usage);

                    let hour = timestamp
                        .get(11..13)
                        .and_then(|h| h.parse::<i64>().ok())
                        .unwrap_or(0);
                    let half = if hour < 12 { "AM" } else { "PM" }.to_string();
                    let a = activity.entry((provider.clone(), day, half)).or_default();
                    a.sessions.insert(session_id.clone());
                    a.tokens.add(usage);
                }
            }

            let provider_acc = provider_totals.entry(provider.clone()).or_default();
            provider_acc.sessions.insert(session_id.clone());
            provider_acc.messages += 1;
            if is_turn {
                provider_acc.turns += 1;
            }
            provider_acc.tokens.add(usage);
            add_reported_cost(&mut provider_acc.reported_cost_usd, reported_cost);
            provider_acc.tokens_available |= usage_source != "unavailable";
            provider_acc.cost_available |= cost_source != "unavailable";

            if msg_type == "assistant" {
                let model_acc = by_model
                    .entry((provider.clone(), model.clone()))
                    .or_default();
                model_acc.turns += 1;
                model_acc.tokens.add(usage);
            }

            if include_breakdown {
                let repo_cache_key = (project_slug.clone(), cwd.clone());
                let (repo_key, repo_root) = if let Some(cached) = repo_cache.get(&repo_cache_key) {
                    cached.clone()
                } else {
                    let resolved =
                        repo_for_project(cwd.as_deref(), &project_slug, &repo_by_slug, &repo_roots);
                    repo_cache.insert(repo_cache_key, resolved.clone());
                    resolved
                };
                let project_key = repo_root
                    .as_deref()
                    .or(repo_key.as_deref())
                    .unwrap_or(&project_slug)
                    .to_ascii_lowercase();
                let project_acc = projects.entry(project_key).or_default();
                project_acc.providers.insert(provider.clone());
                if project_acc.project_slug.is_none() {
                    project_acc.project_slug = Some(
                        repo_key
                            .clone()
                            .or_else(|| repo_root.clone())
                            .unwrap_or_else(|| project_slug.clone()),
                    );
                }
                if project_acc.repo_key.is_none() {
                    project_acc.repo_key = repo_key;
                }
                if project_acc.repo_root.is_none() {
                    project_acc.repo_root = repo_root.clone();
                }
                project_acc
                    .sessions
                    .insert(format!("{provider}:{session_id}"));
                if project_acc.sample_cwd.is_none() {
                    project_acc.sample_cwd = repo_root.or_else(|| cwd.clone());
                }
                if is_turn {
                    project_acc.turns += 1;
                }
                project_acc.tokens.add(usage);

                let session_acc = sessions
                    .entry((provider.clone(), session_id.clone()))
                    .or_default();
                if session_acc.project_slug.is_none() {
                    session_acc.project_slug = Some(project_slug);
                }
                if session_acc.sample_cwd.is_none() {
                    session_acc.sample_cwd = cwd;
                }
                if session_acc
                    .started
                    .as_deref()
                    .is_none_or(|v| timestamp.as_str() < v)
                {
                    session_acc.started = Some(timestamp.clone());
                }
                if session_acc
                    .ended
                    .as_deref()
                    .is_none_or(|v| timestamp.as_str() > v)
                {
                    session_acc.ended = Some(timestamp.clone());
                }
                if is_turn {
                    session_acc.turns += 1;
                }
                session_acc.tokens.add(usage);
                add_reported_cost(&mut session_acc.reported_cost_usd, reported_cost);

                if msg_type == "assistant" {
                    session_acc.model_usage.entry(model).or_default().add(usage);
                }
            }
        }
        drop(rows);
        drop(stmt);
        drop(conn);

        let mut total_cost = 0.0;
        let mut any_total_cost = false;
        let mut total_cost_estimated = false;
        for ((provider, model), acc) in &by_model {
            let (usd, estimated) =
                priced_usage(pricing, provider, model.as_deref(), &acc.tokens.usage());
            if let Some(usd) = usd {
                total_cost += usd;
                any_total_cost = true;
                total_cost_estimated |= estimated;
            }
        }

        let totals = Totals {
            sessions: total_sessions.len() as i64,
            turns: total_turns,
            input_tokens: total_tokens.input_tokens,
            output_tokens: total_tokens.output_tokens,
            cache_read_tokens: total_tokens.cache_read_tokens,
            cache_create_5m_tokens: total_tokens.cache_create_5m_tokens,
            cache_create_1h_tokens: total_tokens.cache_create_1h_tokens,
            cost_usd: any_total_cost.then_some(total_cost),
            cost_estimated: total_cost_estimated,
            reported_cost_usd: total_reported_cost,
        };

        let mut model_rows: Vec<ModelRow> = by_model
            .into_iter()
            .map(|((provider, model), acc)| {
                let usage = acc.tokens.usage();
                let (cost_usd, cost_estimated) =
                    priced_usage(pricing, &provider, model.as_deref(), &usage);
                ModelRow {
                    provider,
                    model,
                    turns: acc.turns,
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    cache_read_tokens: usage.cache_read_tokens,
                    cost_usd,
                    cost_estimated,
                }
            })
            .collect();
        model_rows.sort_by(|a, b| {
            let at = a.input_tokens + a.output_tokens;
            let bt = b.input_tokens + b.output_tokens;
            bt.cmp(&at)
                .then_with(|| a.provider.cmp(&b.provider))
                .then_with(|| a.model.cmp(&b.model))
        });

        let provider_rows: Vec<ProviderSummary> = provider_totals
            .into_iter()
            .map(|(provider, acc)| {
                let cost_usd = model_rows
                    .iter()
                    .filter(|row| row.provider == provider)
                    .filter_map(|row| row.cost_usd)
                    .reduce(|a, b| a + b);
                let provider_id = provider.parse().unwrap_or(ProviderId::Claude);
                ProviderSummary {
                    provider: provider.clone(),
                    label: provider_id.label().to_string(),
                    sessions: acc.sessions.len() as i64,
                    messages: acc.messages,
                    turns: acc.turns,
                    input_tokens: acc.tokens.input_tokens,
                    output_tokens: acc.tokens.output_tokens,
                    cache_read_tokens: acc.tokens.cache_read_tokens,
                    cache_create_tokens: acc.tokens.cache_create_tokens(),
                    cost_usd,
                    reported_cost_usd: acc.reported_cost_usd,
                    tokens_available: acc.tokens_available,
                    cost_available: acc.cost_available,
                }
            })
            .collect();

        let mut project_rows: Vec<ProjectRow> = projects
            .into_values()
            .map(|acc| {
                let providers: Vec<String> = acc.providers.into_iter().collect();
                ProjectRow {
                    provider: providers
                        .first()
                        .cloned()
                        .unwrap_or_else(|| ProviderId::Claude.as_str().to_string()),
                    providers,
                    project_slug: acc.project_slug.unwrap_or_else(|| "unknown".to_string()),
                    repo_key: acc.repo_key,
                    repo_root: acc.repo_root,
                    sample_cwd: acc.sample_cwd,
                    sessions: acc.sessions.len() as i64,
                    turns: acc.turns,
                    input_tokens: acc.tokens.input_tokens,
                    output_tokens: acc.tokens.output_tokens,
                    billable_tokens: acc.tokens.billable_tokens(),
                    cache_read_tokens: acc.tokens.cache_read_tokens,
                }
            })
            .collect();
        project_rows.sort_by(|a, b| {
            b.sessions
                .cmp(&a.sessions)
                .then_with(|| b.turns.cmp(&a.turns))
                .then_with(|| a.provider.cmp(&b.provider))
                .then_with(|| a.project_slug.cmp(&b.project_slug))
        });
        project_rows.truncate(project_limit);

        let mut session_rows: Vec<SessionRow> = sessions
            .into_iter()
            .map(|((provider, session_id), acc)| {
                let mut cost_usd = 0.0;
                let mut any_cost = false;
                let mut cost_estimated = false;
                for (model, tokens) in acc.model_usage {
                    let (usd, estimated) =
                        priced_usage(pricing, &provider, model.as_deref(), &tokens.usage());
                    if let Some(usd) = usd {
                        cost_usd += usd;
                        any_cost = true;
                        cost_estimated |= estimated;
                    }
                }
                SessionRow {
                    provider,
                    session_id,
                    project_slug: acc.project_slug,
                    sample_cwd: acc.sample_cwd,
                    started: acc.started,
                    ended: acc.ended,
                    turns: acc.turns,
                    tokens: acc.tokens.total_tokens(),
                    cost_usd: any_cost.then_some(cost_usd),
                    cost_estimated,
                    reported_cost_usd: acc.reported_cost_usd,
                }
            })
            .collect();
        session_rows.sort_by(|a, b| {
            b.ended
                .cmp(&a.ended)
                .then_with(|| a.provider.cmp(&b.provider))
                .then_with(|| a.session_id.cmp(&b.session_id))
        });
        session_rows.truncate(session_limit);

        let daily_rows = daily
            .into_iter()
            .map(|((provider, day), acc)| DailyRow {
                provider,
                day,
                sessions: acc.sessions.len() as i64,
                input_tokens: acc.tokens.input_tokens,
                output_tokens: acc.tokens.output_tokens,
                cache_read_tokens: acc.tokens.cache_read_tokens,
                cache_create_tokens: acc.tokens.cache_create_tokens(),
            })
            .collect();

        let activity_rows = activity
            .into_iter()
            .map(|((provider, day, half), acc)| ActivityBucket {
                provider,
                key: format!("{day}:{half}"),
                day,
                half,
                sessions: acc.sessions.len() as i64,
                input_tokens: acc.tokens.input_tokens,
                output_tokens: acc.tokens.output_tokens,
                cache_create_tokens: acc.tokens.cache_create_tokens(),
            })
            .collect();

        Ok(OverviewUsageBundle {
            totals,
            projects: project_rows,
            sessions: session_rows,
            daily: daily_rows,
            activity: activity_rows,
            providers: provider_rows,
            by_model: model_rows,
        })
    }

    pub fn overview_totals(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Totals> {
        self.overview_totals_for_providers(pricing, since, until, &[])
    }

    pub fn overview_totals_for_providers(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Totals> {
        // Aggregate in SQL (one indexed scan) instead of streaming every in-range
        // message into Rust. The token sums / distinct-session / turn counts are exact
        // equivalents of the single-pass bundle; cost is the sum of per-model priced
        // costs (same as the bundle), via the already-tested by_model breakdown.
        let (sessions, turns, input_tokens, output_tokens, cache_read, c5, c1, reported) = {
            let conn = self.conn.lock().unwrap();
            let (provider_sql, provider_params) = provider_clause("provider", providers);
            let unbounded = since.is_none() && until.is_none();
            let sql = if unbounded {
                format!(
                    "SELECT COUNT(DISTINCT provider || ':' || session_id), \
                     COALESCE(SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END),0), \
                     COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                     COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_create_5m_tokens),0), \
                     COALESCE(SUM(cache_create_1h_tokens),0), SUM(reported_cost_usd) \
                     FROM messages INDEXED BY idx_messages_provider_summary_cover WHERE 1=1 {provider_sql}"
                )
            } else {
                format!(
                    "SELECT COUNT(DISTINCT provider || ':' || session_id), \
                     COALESCE(SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END),0), \
                     COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                     COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_create_5m_tokens),0), \
                     COALESCE(SUM(cache_create_1h_tokens),0), SUM(reported_cost_usd) \
                     FROM messages INDEXED BY idx_messages_provider_summary_cover WHERE {TIME_BOUND} {provider_sql}"
                )
            };
            let params = if unbounded {
                provider_only_params(&provider_params)
            } else {
                time_provider_params(&since, &until, &provider_params)
            };
            conn.query_row(&sql, params.as_slice(), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Option<f64>>(7)?,
                ))
            })?
        };

        let mut cost_usd = 0.0;
        let mut any_cost = false;
        let mut cost_estimated = false;
        for m in self.by_model_for_providers(pricing, since, until, providers)? {
            if let Some(usd) = m.cost_usd {
                cost_usd += usd;
                any_cost = true;
                cost_estimated |= m.cost_estimated;
            }
        }

        Ok(Totals {
            sessions,
            turns,
            input_tokens,
            output_tokens,
            cache_read_tokens: cache_read,
            cache_create_5m_tokens: c5,
            cache_create_1h_tokens: c1,
            cost_usd: any_cost.then_some(cost_usd),
            cost_estimated,
            reported_cost_usd: reported,
        })
    }

    pub fn by_model(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<ModelRow>> {
        self.by_model_for_providers(pricing, since, until, &[])
    }

    pub fn by_model_for_providers(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<ModelRow>> {
        let mut out = Vec::new();
        for (provider, model, turns, u) in
            self.model_usage_for_providers(since, until, providers)?
        {
            let provider_id = provider.parse().unwrap_or(ProviderId::Claude);
            let c = pricing.cost_for_provider(provider_id, model.as_deref(), &u);
            out.push(ModelRow {
                provider,
                model,
                turns,
                input_tokens: u.input_tokens,
                output_tokens: u.output_tokens,
                cache_read_tokens: u.cache_read_tokens,
                cost_usd: c.usd,
                cost_estimated: c.estimated,
            });
        }
        out.sort_by(|a, b| {
            let ba = a.input_tokens + a.output_tokens;
            let bb = b.input_tokens + b.output_tokens;
            bb.cmp(&ba)
        });
        Ok(out)
    }

    pub fn provider_summaries(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<ProviderSummary>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let unbounded = since.is_none() && until.is_none();
        let sql = if unbounded {
            format!(
                "SELECT provider, COUNT(DISTINCT session_id), COUNT(*), \
                 SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_read_tokens),0), \
                 COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0), \
                 SUM(reported_cost_usd), \
                 MAX(CASE WHEN usage_source<>'unavailable' THEN 1 ELSE 0 END) \
                 FROM messages INDEXED BY idx_messages_provider_summary_cover \
                 WHERE 1=1 {provider_sql} GROUP BY provider ORDER BY provider"
            )
        } else {
            format!(
                "SELECT provider, COUNT(DISTINCT session_id), COUNT(*), \
                 SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_read_tokens),0), \
                 COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0), \
                 SUM(reported_cost_usd), \
                 MAX(CASE WHEN usage_source<>'unavailable' THEN 1 ELSE 0 END) \
                 FROM messages INDEXED BY idx_messages_provider_summary_cover \
                 WHERE {TIME_BOUND} {provider_sql} GROUP BY provider ORDER BY provider"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let params = if unbounded {
            provider_only_params(&provider_params)
        } else {
            time_provider_params(&since, &until, &provider_params)
        };
        let mut rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, Option<f64>>(8)?,
                    r.get::<_, i64>(9)? != 0,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        drop(conn);

        let mut cost_by_provider: HashMap<String, (f64, bool)> = HashMap::new();
        for (provider, model, _turns, u) in
            self.model_usage_for_providers(since, until, providers)?
        {
            let provider_id = provider.parse().unwrap_or(ProviderId::Claude);
            let c = pricing.cost_for_provider(provider_id, model.as_deref(), &u);
            if let Some(v) = c.usd {
                let entry = cost_by_provider.entry(provider).or_insert((0.0, false));
                entry.0 += v;
                entry.1 = true;
            }
        }

        Ok(rows
            .drain(..)
            .map(
                |(
                    provider,
                    sessions,
                    messages,
                    turns,
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_create_tokens,
                    reported_cost_usd,
                    tokens_available,
                )| {
                    let provider_id = provider.parse().unwrap_or(ProviderId::Claude);
                    let cost = cost_by_provider.get(&provider).and_then(|(usd, any)| {
                        if *any {
                            Some(*usd)
                        } else {
                            None
                        }
                    });
                    ProviderSummary {
                        provider,
                        label: provider_id.label().to_string(),
                        sessions,
                        messages,
                        turns,
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_create_tokens,
                        cost_usd: cost,
                        reported_cost_usd,
                        tokens_available,
                        cost_available: cost.is_some() || reported_cost_usd.is_some(),
                    }
                },
            )
            .collect())
    }

    pub fn provider_observed_stats(&self) -> Result<HashMap<String, ProviderObservedStats>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT provider, COUNT(DISTINCT session_id), COUNT(*), \
             SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END), \
             MAX(CASE WHEN usage_source='exact' THEN 1 ELSE 0 END), \
             MAX(CASE WHEN usage_source='provider_reported' THEN 1 ELSE 0 END), \
             MAX(CASE WHEN usage_source='unavailable' THEN 1 ELSE 0 END), \
             MAX(CASE WHEN cost_source='api_estimate' THEN 1 ELSE 0 END), \
             MAX(CASE WHEN cost_source='provider_reported' OR reported_cost_usd IS NOT NULL THEN 1 ELSE 0 END), \
             MAX(CASE WHEN cost_source='unavailable' THEN 1 ELSE 0 END) \
             FROM messages GROUP BY provider",
        )?;
        let mut out = HashMap::new();
        let rows = stmt.query_map([], |r| {
            Ok(ProviderObservedStats {
                provider: r.get(0)?,
                sessions: r.get(1)?,
                messages: r.get(2)?,
                prompts: r.get(3)?,
                tools: 0,
                usage_exact: r.get::<_, i64>(4)? != 0,
                usage_reported: r.get::<_, i64>(5)? != 0,
                usage_unavailable: r.get::<_, i64>(6)? != 0,
                cost_estimated: r.get::<_, i64>(7)? != 0,
                cost_reported: r.get::<_, i64>(8)? != 0,
                cost_unavailable: r.get::<_, i64>(9)? != 0,
            })
        })?;
        for row in rows {
            let row = row?;
            out.insert(row.provider.clone(), row);
        }
        drop(stmt);

        let mut tool_stmt =
            conn.prepare("SELECT provider, COUNT(*) FROM tool_calls GROUP BY provider")?;
        let tool_rows =
            tool_stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in tool_rows {
            let (provider, tools) = row?;
            out.entry(provider.clone())
                .or_insert_with(|| ProviderObservedStats {
                    provider,
                    ..Default::default()
                })
                .tools = tools;
        }

        Ok(out)
    }

    pub fn daily(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<DailyRow>> {
        self.daily_for_providers(since, until, &[])
    }

    pub fn daily_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<DailyRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let unbounded = since.is_none() && until.is_none();
        let sql = if unbounded {
            format!(
                "SELECT provider, substr(timestamp,1,10) AS day, COUNT(DISTINCT session_id), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0) \
                 FROM messages INDEXED BY idx_messages_daily_cover \
                 WHERE 1=1 {provider_sql} GROUP BY provider, day ORDER BY day, provider"
            )
        } else {
            format!(
                "SELECT provider, substr(timestamp,1,10) AS day, COUNT(DISTINCT session_id), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0) \
                 FROM messages INDEXED BY idx_messages_daily_cover \
                 WHERE {TIME_BOUND} {provider_sql} GROUP BY provider, day ORDER BY day, provider"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let params = if unbounded {
            provider_only_params(&provider_params)
        } else {
            time_provider_params(&since, &until, &provider_params)
        };
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok(DailyRow {
                    provider: r.get(0)?,
                    day: r.get(1)?,
                    sessions: r.get(2)?,
                    input_tokens: r.get(3)?,
                    output_tokens: r.get(4)?,
                    cache_read_tokens: r.get(5)?,
                    cache_create_tokens: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Per-half-day (AM/PM) activity buckets — twice the columns of `daily`.
    pub fn activity_buckets(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<ActivityBucket>> {
        self.activity_buckets_for_providers(since, until, &[])
    }

    pub fn activity_buckets_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<ActivityBucket>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        // ISO timestamps: chars 12-13 are the hour, zero-padded, so a string
        // compare against '12' cleanly splits the day into AM (00-11) / PM (12-23).
        let unbounded = since.is_none() && until.is_none();
        let sql = if unbounded {
            format!(
                "SELECT provider, substr(timestamp,1,10) AS day, \
                 CASE WHEN substr(timestamp,12,2) < '12' THEN 'AM' ELSE 'PM' END AS half, \
                 COUNT(DISTINCT session_id), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0) \
                 FROM messages INDEXED BY idx_messages_daily_cover \
                 WHERE 1=1 {provider_sql} GROUP BY provider, day, half ORDER BY day, half, provider"
            )
        } else {
            format!(
                "SELECT provider, substr(timestamp,1,10) AS day, \
                 CASE WHEN substr(timestamp,12,2) < '12' THEN 'AM' ELSE 'PM' END AS half, \
                 COUNT(DISTINCT session_id), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0) \
                 FROM messages INDEXED BY idx_messages_daily_cover \
                 WHERE {TIME_BOUND} {provider_sql} GROUP BY provider, day, half ORDER BY day, half, provider"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let params = if unbounded {
            provider_only_params(&provider_params)
        } else {
            time_provider_params(&since, &until, &provider_params)
        };
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                let provider: String = r.get(0)?;
                let day: String = r.get(1)?;
                let half: String = r.get(2)?;
                Ok(ActivityBucket {
                    provider: provider.clone(),
                    key: format!("{provider}:{day} {half}"),
                    day,
                    half,
                    sessions: r.get(3)?,
                    input_tokens: r.get(4)?,
                    output_tokens: r.get(5)?,
                    cache_create_tokens: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn projects(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<ProjectRow>> {
        self.projects_for_providers(since, until, &[])
    }

    pub fn projects_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let (repo_by_slug, repo_roots) = repo_lookup(&conn)?;
        let unbounded = since.is_none() && until.is_none();
        let sql = if unbounded {
            format!(
                "SELECT provider, project_slug, cwd, session_id, \
                 SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0), \
                 COALESCE(SUM(cache_read_tokens),0) \
                 FROM messages INDEXED BY idx_messages_project_rollup_cover \
                 WHERE 1=1 {provider_sql} \
                 GROUP BY provider, project_slug, cwd, session_id"
            )
        } else {
            format!(
                "SELECT provider, project_slug, cwd, session_id, \
                 SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END), \
                 COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
                 COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0), \
                 COALESCE(SUM(cache_read_tokens),0) \
                 FROM messages WHERE {TIME_BOUND} {provider_sql} \
                 GROUP BY provider, project_slug, cwd, session_id"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let params = if unbounded {
            provider_only_params(&provider_params)
        } else {
            time_provider_params(&since, &until, &provider_params)
        };
        let mut repo_cache: RepoResolutionCache = HashMap::new();
        let grouped = stmt
            .query_map(params.as_slice(), |r| {
                let project_slug: String = r.get(1)?;
                let sample_cwd: Option<String> = r.get(2)?;
                let session_id: String = r.get(3)?;
                let cache_key = (project_slug.clone(), sample_cwd.clone());
                let (repo_key, repo_root) = if let Some(cached) = repo_cache.get(&cache_key) {
                    cached.clone()
                } else {
                    let resolved = repo_for_project(
                        sample_cwd.as_deref(),
                        &project_slug,
                        &repo_by_slug,
                        &repo_roots,
                    );
                    repo_cache.insert(cache_key, resolved.clone());
                    resolved
                };
                Ok((
                    r.get::<_, String>(0)?,
                    project_slug,
                    repo_key,
                    repo_root,
                    sample_cwd,
                    session_id,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, i64>(8)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut accs: HashMap<String, ProjectAcc> = HashMap::new();
        for (
            provider,
            project_slug,
            repo_key,
            repo_root,
            sample_cwd,
            session_id,
            turns,
            input_tokens,
            output_tokens,
            cache_create_tokens,
            cache_read_tokens,
        ) in grouped
        {
            let normalized_cwd = sample_cwd.as_deref().map(normalize_path_key);
            let key = repo_root
                .as_deref()
                .or(repo_key.as_deref())
                .or(normalized_cwd.as_deref())
                .unwrap_or(&project_slug)
                .to_ascii_lowercase();
            let acc = accs.entry(key).or_default();
            acc.providers.insert(provider.clone());
            if acc.project_slug.is_none() {
                acc.project_slug = Some(
                    repo_key
                        .clone()
                        .or_else(|| repo_root.clone())
                        .unwrap_or(project_slug),
                );
            }
            if acc.repo_key.is_none() {
                acc.repo_key = repo_key;
            }
            if acc.repo_root.is_none() {
                acc.repo_root = repo_root.clone();
            }
            if acc.sample_cwd.is_none() {
                acc.sample_cwd = repo_root.or(sample_cwd);
            }
            acc.sessions.insert(format!("{provider}:{session_id}"));
            acc.turns += turns;
            acc.tokens.input_tokens += input_tokens;
            acc.tokens.output_tokens += output_tokens;
            acc.tokens.cache_read_tokens += cache_read_tokens;
            acc.tokens.cache_create_5m_tokens += cache_create_tokens.max(0);
        }

        let mut rows: Vec<ProjectRow> = accs
            .into_values()
            .map(|acc| {
                let providers: Vec<String> = acc.providers.into_iter().collect();
                ProjectRow {
                    provider: providers
                        .first()
                        .cloned()
                        .unwrap_or_else(|| ProviderId::Claude.as_str().to_string()),
                    providers,
                    project_slug: acc.project_slug.unwrap_or_else(|| "unknown".to_string()),
                    repo_key: acc.repo_key,
                    repo_root: acc.repo_root,
                    sample_cwd: acc.sample_cwd,
                    sessions: acc.sessions.len() as i64,
                    turns: acc.turns,
                    input_tokens: acc.tokens.input_tokens,
                    output_tokens: acc.tokens.output_tokens,
                    billable_tokens: acc.tokens.billable_tokens(),
                    cache_read_tokens: acc.tokens.cache_read_tokens,
                }
            })
            .collect();
        rows.sort_by(|a, b| {
            b.billable_tokens
                .cmp(&a.billable_tokens)
                .then_with(|| b.sessions.cmp(&a.sessions))
                .then_with(|| a.project_slug.cmp(&b.project_slug))
        });
        Ok(rows)
    }

    pub fn tools(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<ToolRow>> {
        self.tools_for_providers(since, until, &[])
    }

    pub fn tools_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<ToolRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let sql = format!(
            "SELECT provider, tool_name, COUNT(*), 0 \
             FROM tool_calls \
             WHERE tool_name<>'_tool_result' \
               AND timestamp >= COALESCE(?, '') AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') \
               {provider_sql} \
             GROUP BY provider, tool_name ORDER BY 3 DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params = time_provider_params(&since, &until, &provider_params);
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok(ToolRow {
                    provider: r.get(0)?,
                    tool_name: r.get(1)?,
                    calls: r.get(2)?,
                    result_tokens: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn recent_sessions(
        &self,
        pricing: &Pricing,
        limit: i64,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<SessionRow>> {
        self.recent_sessions_for_providers(pricing, limit, since, until, &[])
    }

    /// Total distinct sessions in range — the `total` for server-side pagination of
    /// the sessions list. Distinct on (provider, session_id), matching the list.
    pub fn count_sessions_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let sql = format!(
            "SELECT COUNT(DISTINCT provider || ':' || session_id) \
             FROM messages WHERE {TIME_BOUND} {provider_sql}"
        );
        let params = time_provider_params(&since, &until, &provider_params);
        Ok(conn.query_row(&sql, params.as_slice(), |r| r.get(0))?)
    }

    /// Total prompts (user turns with text) in range — the `total` for server-side
    /// pagination of the expensive-prompts list.
    pub fn count_expensive_prompts_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let sql = format!(
            "SELECT COUNT(*) FROM messages \
             WHERE type='user' AND prompt_text IS NOT NULL AND {TIME_BOUND} {provider_sql}"
        );
        let params = time_provider_params(&since, &until, &provider_params);
        Ok(conn.query_row(&sql, params.as_slice(), |r| r.get(0))?)
    }

    pub fn recent_sessions_for_providers(
        &self,
        pricing: &Pricing,
        limit: i64,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<SessionRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let scan_limit = (limit.max(1) * 500).clamp(1_000, 250_000);
        let recent_sql = format!(
            "SELECT provider, session_id FROM messages \
             WHERE {TIME_BOUND} {provider_sql} ORDER BY timestamp DESC LIMIT ?"
        );
        let mut recent_stmt = conn.prepare(&recent_sql)?;
        let mut recent_params = time_provider_params(&since, &until, &provider_params);
        recent_params.push(&scan_limit);
        let mut seen = HashSet::new();
        let mut ids: Vec<(String, String)> = Vec::new();
        let recent_rows = recent_stmt.query_map(recent_params.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in recent_rows {
            let (provider, session_id) = row?;
            if seen.insert(format!("{provider}:{session_id}")) {
                ids.push((provider, session_id));
                if ids.len() >= limit as usize {
                    break;
                }
            }
        }
        drop(recent_stmt);
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let base_sql = format!(
            "SELECT provider, session_id, MAX(project_slug), MAX(cwd), MIN(timestamp), MAX(timestamp), \
             SUM(CASE WHEN type='user' AND prompt_chars IS NOT NULL THEN 1 ELSE 0 END), \
             COALESCE(SUM(input_tokens+output_tokens),0), SUM(reported_cost_usd) \
             FROM messages \
             WHERE provider=?1 AND session_id=?2 AND {TIME_BOUND} \
             GROUP BY provider, session_id"
        );
        let mut stmt = conn.prepare(&base_sql)?;
        let mut sessions = Vec::with_capacity(ids.len());
        for (provider, session_id) in &ids {
            let mut rows = stmt.query_map(
                params![provider.as_str(), session_id.as_str(), since, until],
                |r| {
                    Ok(SessionRow {
                        provider: r.get(0)?,
                        session_id: r.get(1)?,
                        project_slug: r.get(2)?,
                        sample_cwd: r.get(3)?,
                        started: r.get(4)?,
                        ended: r.get(5)?,
                        turns: r.get(6)?,
                        tokens: r.get(7)?,
                        cost_usd: None,
                        cost_estimated: false,
                        reported_cost_usd: r.get(8)?,
                    })
                },
            )?;
            if let Some(row) = rows.next() {
                sessions.push(row?);
            }
        }

        let _ = pricing;
        sessions.sort_by(|a, b| {
            b.ended
                .cmp(&a.ended)
                .then_with(|| a.provider.cmp(&b.provider))
                .then_with(|| a.session_id.cmp(&b.session_id))
        });
        Ok(sessions)
    }

    pub fn session_detail(&self, session_id: &str) -> Result<Vec<MessageDetail>> {
        self.session_detail_for_provider(session_id, Some(ProviderId::Claude))
    }

    pub fn session_detail_for_provider(
        &self,
        session_id: &str,
        provider: Option<ProviderId>,
    ) -> Result<Vec<MessageDetail>> {
        let conn = self.conn.lock().unwrap();
        let provider_sql = if provider.is_some() {
            " AND provider=?2"
        } else {
            ""
        };
        let sql = format!(
            "SELECT provider,uuid,parent_uuid,type,timestamp,model,is_sidechain,agent_id,\
             input_tokens,output_tokens,cache_read_tokens,cache_create_5m_tokens,cache_create_1h_tokens,\
             usage_source,reported_cost_usd,cost_source,prompt_text,prompt_chars,tool_calls_json,project_slug,cwd \
             FROM messages WHERE session_id=?1{provider_sql} ORDER BY timestamp"
        );
        let mut stmt = conn.prepare(&sql)?;
        let map_row = |r: &rusqlite::Row<'_>| {
            Ok(MessageDetail {
                provider: r.get(0)?,
                uuid: r.get(1)?,
                parent_uuid: r.get(2)?,
                msg_type: r.get(3)?,
                timestamp: r.get(4)?,
                model: r.get(5)?,
                is_sidechain: r.get::<_, i64>(6)? != 0,
                agent_id: r.get(7)?,
                input_tokens: r.get(8)?,
                output_tokens: r.get(9)?,
                cache_read_tokens: r.get(10)?,
                cache_create_5m_tokens: r.get(11)?,
                cache_create_1h_tokens: r.get(12)?,
                usage_source: r.get(13)?,
                reported_cost_usd: r.get(14)?,
                cost_source: r.get(15)?,
                prompt_text: r.get(16)?,
                prompt_chars: r.get(17)?,
                tool_calls_json: r.get(18)?,
                project_slug: r.get(19)?,
                cwd: r.get(20)?,
            })
        };
        let rows = if let Some(provider) = provider.map(|p| p.as_str()) {
            stmt.query_map(params![session_id, provider], map_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(params![session_id], map_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(rows)
    }

    /// Expensive user prompts: main-thread assistant work in the window between a
    /// prompt and the next prompt in the same session (INV-4).
    pub fn expensive_prompts(
        &self,
        pricing: &Pricing,
        limit: i64,
        sort: &str,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<PromptRow>> {
        self.expensive_prompts_for_providers(pricing, limit, sort, since, until, &[])
    }

    pub fn expensive_prompts_for_providers(
        &self,
        pricing: &Pricing,
        limit: i64,
        sort: &str,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<PromptRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let unbounded = since.is_none() && until.is_none();
        let sql = if unbounded {
            format!(
                "SELECT provider, uuid, session_id, project_slug, cwd, type, timestamp, prompt_chars, model, \
                        input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, \
                        reported_cost_usd, is_sidechain \
                 FROM messages INDEXED BY idx_messages_prompt_scan_cover \
                 WHERE (type='user' OR type='assistant') {provider_sql} \
                 ORDER BY provider, session_id, timestamp"
            )
        } else {
            format!(
                "SELECT provider, uuid, session_id, project_slug, cwd, type, timestamp, prompt_chars, model, \
                        input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, \
                        reported_cost_usd, is_sidechain \
                 FROM messages \
                 WHERE {TIME_BOUND} {provider_sql} AND (type='user' OR type='assistant') \
                 ORDER BY provider, session_id, timestamp"
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let params = if unbounded {
            provider_only_params(&provider_params)
        } else {
            time_provider_params(&since, &until, &provider_params)
        };

        #[derive(Default)]
        struct PromptAcc {
            provider: String,
            uuid: String,
            session_id: String,
            project_slug: String,
            sample_cwd: Option<String>,
            timestamp: String,
            prompt_chars: Option<i64>,
            model: Option<String>,
            tokens: TokenAcc,
            reported_cost_usd: Option<f64>,
        }

        let mut active: HashMap<(String, String), PromptAcc> = HashMap::new();
        let mut prompts = Vec::new();
        let mut rows = stmt.query(params.as_slice())?;
        while let Some(r) = rows.next()? {
            let provider: String = r.get(0)?;
            let uuid: String = r.get(1)?;
            let session_id: String = r.get(2)?;
            let project_slug: String = r.get(3)?;
            let cwd: Option<String> = r.get(4)?;
            let msg_type: String = r.get(5)?;
            let timestamp: String = r.get(6)?;
            let prompt_chars: Option<i64> = r.get(7)?;
            let model: Option<String> = r.get(8)?;
            let usage = Usage {
                input_tokens: r.get(9)?,
                output_tokens: r.get(10)?,
                cache_read_tokens: r.get(11)?,
                cache_create_5m_tokens: r.get(12)?,
                cache_create_1h_tokens: r.get(13)?,
            };
            let reported_cost: Option<f64> = r.get(14)?;
            let is_sidechain = r.get::<_, i64>(15)? != 0;
            let key = (provider.clone(), session_id.clone());

            if msg_type == "user" && prompt_chars.is_some() {
                if let Some(prev) = active.remove(&key) {
                    prompts.push(prev);
                }
                active.insert(
                    key,
                    PromptAcc {
                        provider,
                        uuid,
                        session_id,
                        project_slug,
                        sample_cwd: cwd,
                        timestamp,
                        prompt_chars,
                        ..Default::default()
                    },
                );
            } else if msg_type == "assistant" && !is_sidechain {
                if let Some(acc) = active.get_mut(&key) {
                    if acc.sample_cwd.is_none() {
                        acc.sample_cwd = cwd;
                    }
                    if acc.model.is_none() {
                        acc.model = model;
                    }
                    acc.tokens.add(usage);
                    add_reported_cost(&mut acc.reported_cost_usd, reported_cost);
                }
            }
        }
        prompts.extend(active.into_values());
        drop(rows);
        drop(stmt);

        if sort == "recent" {
            prompts.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        } else {
            prompts.sort_by(|a, b| {
                b.tokens
                    .billable_tokens()
                    .cmp(&a.tokens.billable_tokens())
                    .then_with(|| b.timestamp.cmp(&a.timestamp))
            });
        }
        prompts.truncate(limit.max(0) as usize);

        let mut prompt_texts = HashMap::new();
        if !prompts.is_empty() {
            let placeholders = vec!["?"; prompts.len()].join(",");
            let sql =
                format!("SELECT uuid, prompt_text FROM messages WHERE uuid IN ({placeholders})");
            let params: Vec<&dyn ToSql> = prompts
                .iter()
                .map(|prompt| &prompt.uuid as &dyn ToSql)
                .collect();
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params.as_slice(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })?;
            for row in rows {
                let (uuid, text) = row?;
                prompt_texts.insert(uuid, text);
            }
        }

        Ok(prompts
            .into_iter()
            .map(|acc| {
                let usage = acc.tokens.usage();
                let provider_id = acc.provider.parse().unwrap_or(ProviderId::Claude);
                let c = pricing.cost_for_provider(provider_id, acc.model.as_deref(), &usage);
                let prompt_text = prompt_texts.remove(&acc.uuid).flatten();
                PromptRow {
                    provider: acc.provider,
                    user_uuid: acc.uuid,
                    session_id: acc.session_id,
                    project_slug: acc.project_slug,
                    sample_cwd: acc.sample_cwd,
                    timestamp: acc.timestamp,
                    prompt_text,
                    prompt_chars: acc.prompt_chars,
                    model: acc.model,
                    billable_tokens: acc.tokens.billable_tokens(),
                    cache_read_tokens: acc.tokens.cache_read_tokens,
                    estimated_cost_usd: c.usd,
                    cost_estimated: c.estimated,
                    reported_cost_usd: acc.reported_cost_usd,
                }
            })
            .collect())
    }
}

#[derive(Debug, Serialize)]
pub struct SkillRow {
    pub skill: String,
    pub manual_sessions: i64,
    pub tool_invocations: i64,
    pub sessions: i64,
    pub last_used: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentGroupRow {
    pub group: String,
    pub model: Option<String>,
    pub messages: i64,
    pub sessions: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
}

impl Db {
    /// Per-skill split of slash-command (manual) vs Skill-tool (Claude-invoked) use.
    pub fn skill_breakdown(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<SkillRow>> {
        self.skill_breakdown_for_providers(since, until, &[])
    }

    pub fn skill_breakdown_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<SkillRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let sql = format!(
            "SELECT target AS skill, \
             COUNT(DISTINCT CASE WHEN tool_use_id IS NULL THEN session_id END), \
             COALESCE(SUM(CASE WHEN tool_use_id IS NOT NULL THEN 1 ELSE 0 END), 0), \
             COUNT(DISTINCT session_id), MAX(timestamp) \
             FROM tool_calls WHERE tool_name='Skill' AND target IS NOT NULL \
               AND timestamp >= COALESCE(?, '') AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') \
               {provider_sql} \
             GROUP BY target ORDER BY COUNT(DISTINCT session_id) DESC, 3 DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params = time_provider_params(&since, &until, &provider_params);
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok(SkillRow {
                    skill: r.get(0)?,
                    manual_sessions: r.get(1)?,
                    tool_invocations: r.get(2)?,
                    sessions: r.get(3)?,
                    last_used: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Assistant token usage grouped by an internal SQL expression (kind / entrypoint).
    /// `group_expr` is a caller-controlled constant, never user input.
    fn agent_groups(
        &self,
        pricing: &Pricing,
        group_expr: &str,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<AgentGroupRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("provider", providers);
        let sql = format!(
            "SELECT {group_expr} AS grp, model, COUNT(*), COUNT(DISTINCT session_id), \
             COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0), \
             COALESCE(SUM(cache_create_5m_tokens),0), COALESCE(SUM(cache_create_1h_tokens),0) \
             FROM messages WHERE type='assistant' AND {TIME_BOUND} {provider_sql} \
             GROUP BY grp, model \
             ORDER BY COALESCE(SUM(input_tokens),0)+COALESCE(SUM(output_tokens),0) DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params = time_provider_params(&since, &until, &provider_params);
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                let u = Usage {
                    input_tokens: r.get(4)?,
                    output_tokens: r.get(5)?,
                    cache_read_tokens: r.get(6)?,
                    cache_create_5m_tokens: r.get(7)?,
                    cache_create_1h_tokens: r.get(8)?,
                };
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    u,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .map(|(group, model, messages, sessions, u)| {
                let c = pricing.cost_for(model.as_deref(), &u);
                AgentGroupRow {
                    group,
                    model,
                    messages,
                    sessions,
                    input_tokens: u.input_tokens,
                    output_tokens: u.output_tokens,
                    cache_read_tokens: u.cache_read_tokens,
                    cost_usd: c.usd,
                    cost_estimated: c.estimated,
                }
            })
            .collect())
    }

    /// Spend split by agent kind: main thread / auto-compaction / subagent.
    pub fn subagents_by_kind(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<AgentGroupRow>> {
        self.subagents_by_kind_for_providers(pricing, since, until, &[])
    }

    pub fn subagents_by_kind_for_providers(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<AgentGroupRow>> {
        self.agent_groups(
            pricing,
            "CASE WHEN is_sidechain=0 THEN 'main' WHEN agent_id LIKE 'acompact%' THEN 'compact' ELSE 'subagent' END",
            since,
            until,
            providers,
        )
    }

    /// Spend split by client entrypoint (cli / vscode / sdk-* / unknown).
    pub fn subagents_by_entrypoint(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<AgentGroupRow>> {
        self.subagents_by_entrypoint_for_providers(pricing, since, until, &[])
    }

    pub fn subagents_by_entrypoint_for_providers(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<AgentGroupRow>> {
        self.agent_groups(
            pricing,
            "COALESCE(entrypoint,'unknown')",
            since,
            until,
            providers,
        )
    }
}

#[derive(Debug, Serialize)]
pub struct WorkspaceRow {
    pub workspace: String,
    pub sample_cwd: Option<String>,
    pub calls: i64,
    pub files: i64,
}

#[derive(Debug, Serialize)]
pub struct Tip {
    pub key: String,
    pub category: String,
    pub severity: String,
    pub title: String,
    pub body: String,
}

const FILE_TOOLS: &str = "('Read','Edit','Write','NotebookEdit')";

impl Db {
    /// File-editing tool activity grouped by the workspace it ran in.
    pub fn workspaces(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<WorkspaceRow>> {
        self.workspaces_for_providers(since, until, &[])
    }

    pub fn workspaces_for_providers(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        providers: &[ProviderId],
    ) -> Result<Vec<WorkspaceRow>> {
        let conn = self.conn.lock().unwrap();
        let (provider_sql, provider_params) = provider_clause("t.provider", providers);
        let sql = format!(
            "SELECT t.project_slug, COUNT(*), COUNT(DISTINCT t.target), \
               (SELECT m.cwd FROM messages m WHERE m.project_slug=t.project_slug AND m.cwd IS NOT NULL LIMIT 1) \
             FROM tool_calls t WHERE t.tool_name IN {FILE_TOOLS} AND t.target IS NOT NULL AND {TIME_BOUND} \
             {provider_sql} \
             GROUP BY t.project_slug ORDER BY 2 DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params = time_provider_params(&since, &until, &provider_params);
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok(WorkspaceRow {
                    workspace: r.get(0)?,
                    calls: r.get(1)?,
                    files: r.get(2)?,
                    sample_cwd: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Rule-based suggestions derived from the data in range.
    pub fn tips(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<Tip>> {
        let conn = self.conn.lock().unwrap();
        let mut out = Vec::new();

        // Rule 1 — cache discipline: low cache reuse relative to fresh input.
        let cache_sql = format!(
            "SELECT COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(input_tokens),0), \
             COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0) \
             FROM messages WHERE {TIME_BOUND}"
        );
        let (cr, inp, cc): (i64, i64, i64) =
            conn.query_row(&cache_sql, params![since, until], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?;
        let denom = cr + inp + cc;
        if denom > 200_000 {
            let rate = cr as f64 / denom as f64;
            if rate < 0.5 {
                out.push(Tip {
                    key: "cache-discipline".into(),
                    category: "cache".into(),
                    severity: "cost".into(),
                    title: "Low cache reuse".into(),
                    body: format!(
                        "Only {:.0}% of your input tokens came from cache. Keeping context stable within a session reuses the prompt cache and cuts input cost.",
                        rate * 100.0
                    ),
                });
            }
        }

        // Rule 2 — repeatedly read files.
        let read_sql = format!(
            "SELECT target, COUNT(*) FROM tool_calls \
             WHERE tool_name='Read' AND target IS NOT NULL AND {TIME_BOUND} \
             GROUP BY target HAVING COUNT(*) >= 10 ORDER BY COUNT(*) DESC LIMIT 5"
        );
        let mut stmt = conn.prepare(&read_sql)?;
        let reads: Vec<(String, i64)> = stmt
            .query_map(params![since, until], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        for (target, count) in reads {
            out.push(Tip {
                key: format!("repeat-read:{target}"),
                category: "repeat-file".into(),
                severity: "info".into(),
                title: "Repeatedly read file".into(),
                body: format!(
                    "{target} was read {count} times. If it's stable, read it once or use a targeted Grep to avoid re-reading the whole file."
                ),
            });
        }

        Ok(out)
    }
}
