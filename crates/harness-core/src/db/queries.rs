//! Write path (scan ingestion with snapshot dedup) and the read queries backing
//! the `/api/*` surface. All user-derived values are bound, never interpolated.

use super::Db;
use crate::error::Result;
use crate::model::{MessageRow, ToolCall, Usage};
use crate::pricing::Pricing;
use rusqlite::params;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// `timestamp >= since AND timestamp < until`, with NULL bounds meaning unbounded.
/// Bind `since` then `until` (both `Option<&str>`) wherever this fragment appears.
const TIME_BOUND: &str =
    " timestamp >= COALESCE(?, '') AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') ";

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
}

#[derive(Debug, Serialize)]
pub struct DailyRow {
    pub day: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_create_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct ModelRow {
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
    pub project_slug: String,
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
    pub tool_name: String,
    pub calls: i64,
    pub result_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct SessionRow {
    pub session_id: String,
    pub project_slug: Option<String>,
    pub sample_cwd: Option<String>,
    pub started: Option<String>,
    pub ended: Option<String>,
    pub turns: i64,
    pub tokens: i64,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
}

#[derive(Debug, Serialize)]
pub struct MessageDetail {
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
    pub prompt_text: Option<String>,
    pub prompt_chars: Option<i64>,
    pub tool_calls_json: Option<String>,
    pub project_slug: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PromptRow {
    pub user_uuid: String,
    pub session_id: String,
    pub project_slug: String,
    pub timestamp: String,
    pub prompt_text: Option<String>,
    pub prompt_chars: Option<i64>,
    pub model: Option<String>,
    pub billable_tokens: i64,
    pub cache_read_tokens: i64,
    pub estimated_cost_usd: Option<f64>,
    pub cost_estimated: bool,
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

    /// Insert a batch of parsed rows, applying streaming-snapshot dedup
    /// (`(session_id, message_id)` keeper, tool re-pointing). Returns
    /// `(messages_inserted, tool_calls_inserted)`.
    pub fn insert_messages(&self, rows: &[MessageRow]) -> Result<(usize, usize)> {
        if rows.is_empty() {
            return Ok((0, 0));
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Last index per (session_id, message_id) within this batch.
        let mut last_idx: HashMap<(&str, &str), usize> = HashMap::new();
        for (i, r) in rows.iter().enumerate() {
            if let Some(mid) = r.message_id.as_deref() {
                last_idx.insert((r.session_id.as_str(), mid), i);
            }
        }
        let keeper_uuid = |r: &MessageRow| -> String {
            match r.message_id.as_deref() {
                Some(mid) => rows[last_idx[&(r.session_id.as_str(), mid)]].uuid.clone(),
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
                Some(mid) => last_idx[&(r.session_id.as_str(), mid)] == i,
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
                     (SELECT uuid FROM messages WHERE session_id=?2 AND message_id=?3 AND uuid<>?1)",
                    params![r.uuid, r.session_id, mid],
                )?;
                tx.execute(
                    "DELETE FROM messages WHERE session_id=?1 AND message_id=?2 AND uuid<>?3",
                    params![r.session_id, mid, r.uuid],
                )?;
            }

            let prompt_chars = r.prompt_text.as_ref().map(|t| t.chars().count() as i64);
            tx.execute(
                "INSERT OR REPLACE INTO messages \
                 (uuid,parent_uuid,session_id,project_slug,cwd,git_branch,cc_version,entrypoint,type,\
                  is_sidechain,agent_id,timestamp,model,stop_reason,prompt_id,message_id,\
                  input_tokens,output_tokens,cache_read_tokens,cache_create_5m_tokens,cache_create_1h_tokens,\
                  prompt_text,prompt_chars,tool_calls_json,attribution_skill) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
                params![
                    r.uuid, r.parent_uuid, r.session_id, r.project_slug, r.cwd, r.git_branch,
                    r.cc_version, r.entrypoint, r.msg_type, r.is_sidechain as i64, r.agent_id,
                    r.timestamp, r.model, r.stop_reason, r.prompt_id, r.message_id,
                    r.usage.input_tokens, r.usage.output_tokens, r.usage.cache_read_tokens,
                    r.usage.cache_create_5m_tokens, r.usage.cache_create_1h_tokens,
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
                         (message_uuid,session_id,project_slug,tool_name,target,result_tokens,is_error,timestamp,tool_use_id) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                        params![
                            r.uuid, r.session_id, r.project_slug, tc.tool_name, tc.target,
                            tc.result_tokens, tc.is_error as i64, r.timestamp, tc.tool_use_id
                        ],
                    )?;
                    tool_n += 1;
                }
            }
        }

        // Global dedup of tool rows that share (message_uuid, tool_use_id) — keeps
        // the earliest, covering the cross-batch re-point above.
        tx.execute(
            "DELETE FROM tool_calls WHERE tool_use_id IS NOT NULL AND id NOT IN \
             (SELECT MIN(id) FROM tool_calls WHERE tool_use_id IS NOT NULL GROUP BY message_uuid, tool_use_id)",
            [],
        )?;

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

    // ---------- read queries ----------

    /// Per-model assistant usage in range (the basis for cost rollups).
    fn model_usage(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<(Option<String>, i64, Usage)>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT model, COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), \
             SUM(cache_create_5m_tokens), SUM(cache_create_1h_tokens) \
             FROM messages WHERE type='assistant' AND {TIME_BOUND} GROUP BY model"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, i64>(1)?,
                    Usage {
                        input_tokens: r.get(2)?,
                        output_tokens: r.get(3)?,
                        cache_read_tokens: r.get(4)?,
                        cache_create_5m_tokens: r.get(5)?,
                        cache_create_1h_tokens: r.get(6)?,
                    },
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn overview_totals(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Totals> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT COUNT(DISTINCT session_id), \
             SUM(CASE WHEN type='user' AND prompt_text IS NOT NULL THEN 1 ELSE 0 END), \
             COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0), \
             COALESCE(SUM(cache_create_5m_tokens),0), COALESCE(SUM(cache_create_1h_tokens),0) \
             FROM messages WHERE {TIME_BOUND}"
        );
        let (sessions, turns, input, output, cr, c5, c1) =
            conn.query_row(&sql, params![since, until], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            })?;
        drop(conn);

        let mut cost = 0.0;
        let mut any = false;
        let mut estimated = false;
        for (model, _turns, u) in self.model_usage(since, until)? {
            let c = pricing.cost_for(model.as_deref(), &u);
            if let Some(v) = c.usd {
                cost += v;
                any = true;
                estimated |= c.estimated;
            }
        }
        Ok(Totals {
            sessions,
            turns,
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cr,
            cache_create_5m_tokens: c5,
            cache_create_1h_tokens: c1,
            cost_usd: if any { Some(cost) } else { None },
            cost_estimated: estimated,
        })
    }

    pub fn by_model(
        &self,
        pricing: &Pricing,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<ModelRow>> {
        let mut out = Vec::new();
        for (model, turns, u) in self.model_usage(since, until)? {
            let c = pricing.cost_for(model.as_deref(), &u);
            out.push(ModelRow {
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

    pub fn daily(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<DailyRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT substr(timestamp,1,10) AS day, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
             COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_create_5m_tokens+cache_create_1h_tokens),0) \
             FROM messages WHERE {TIME_BOUND} GROUP BY day ORDER BY day"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(DailyRow {
                    day: r.get(0)?,
                    input_tokens: r.get(1)?,
                    output_tokens: r.get(2)?,
                    cache_read_tokens: r.get(3)?,
                    cache_create_tokens: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn projects(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT project_slug, MAX(cwd), COUNT(DISTINCT session_id), \
             SUM(CASE WHEN type='user' AND prompt_text IS NOT NULL THEN 1 ELSE 0 END), \
             COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
             COALESCE(SUM(input_tokens+output_tokens+cache_create_5m_tokens+cache_create_1h_tokens),0), \
             COALESCE(SUM(cache_read_tokens),0) \
             FROM messages WHERE {TIME_BOUND} GROUP BY project_slug ORDER BY 7 DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(ProjectRow {
                    project_slug: r.get(0)?,
                    sample_cwd: r.get(1)?,
                    sessions: r.get(2)?,
                    turns: r.get(3)?,
                    input_tokens: r.get(4)?,
                    output_tokens: r.get(5)?,
                    billable_tokens: r.get(6)?,
                    cache_read_tokens: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn tools(&self, since: Option<&str>, until: Option<&str>) -> Result<Vec<ToolRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT tu.tool_name, COUNT(DISTINCT tu.id), COALESCE(SUM(tr.result_tokens),0) \
             FROM tool_calls tu \
             LEFT JOIN tool_calls tr ON tr.tool_name='_tool_result' AND tr.tool_use_id=tu.tool_use_id \
             WHERE tu.tool_name<>'_tool_result' \
               AND tu.timestamp >= COALESCE(?, '') AND tu.timestamp < COALESCE(?, '9999-12-31T99:99:99Z') \
             GROUP BY tu.tool_name ORDER BY 2 DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(ToolRow {
                    tool_name: r.get(0)?,
                    calls: r.get(1)?,
                    result_tokens: r.get(2)?,
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
        let conn = self.conn.lock().unwrap();
        let base_sql = format!(
            "SELECT session_id, MAX(project_slug), MAX(cwd), MIN(timestamp), MAX(timestamp), \
             SUM(CASE WHEN type='user' AND prompt_text IS NOT NULL THEN 1 ELSE 0 END), \
             COALESCE(SUM(input_tokens+output_tokens),0) \
             FROM messages WHERE {TIME_BOUND} GROUP BY session_id ORDER BY MAX(timestamp) DESC LIMIT ?"
        );
        let mut stmt = conn.prepare(&base_sql)?;
        let mut sessions: Vec<SessionRow> = stmt
            .query_map(params![since, until, limit], |r| {
                Ok(SessionRow {
                    session_id: r.get(0)?,
                    project_slug: r.get(1)?,
                    sample_cwd: r.get(2)?,
                    started: r.get(3)?,
                    ended: r.get(4)?,
                    turns: r.get(5)?,
                    tokens: r.get(6)?,
                    cost_usd: None,
                    cost_estimated: false,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        if sessions.is_empty() {
            return Ok(sessions);
        }

        // Per-(session, model) usage for exact mixed-model session cost.
        let ids: Vec<&str> = sessions.iter().map(|s| s.session_id.as_str()).collect();
        let placeholders = vec!["?"; ids.len()].join(",");
        let cost_sql = format!(
            "SELECT session_id, model, SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), \
             SUM(cache_create_5m_tokens), SUM(cache_create_1h_tokens) \
             FROM messages WHERE type='assistant' AND session_id IN ({placeholders}) GROUP BY session_id, model"
        );
        let mut cstmt = conn.prepare(&cost_sql)?;
        let id_params: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut cost_by_session: HashMap<String, (f64, bool, bool)> = HashMap::new();
        let rows = cstmt.query_map(id_params.as_slice(), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                Usage {
                    input_tokens: r.get(2)?,
                    output_tokens: r.get(3)?,
                    cache_read_tokens: r.get(4)?,
                    cache_create_5m_tokens: r.get(5)?,
                    cache_create_1h_tokens: r.get(6)?,
                },
            ))
        })?;
        for row in rows {
            let (sid, model, u) = row?;
            let c = pricing.cost_for(model.as_deref(), &u);
            let entry = cost_by_session.entry(sid).or_insert((0.0, false, false));
            if let Some(v) = c.usd {
                entry.0 += v;
                entry.1 = true;
                entry.2 |= c.estimated;
            }
        }
        for s in &mut sessions {
            if let Some((usd, any, est)) = cost_by_session.get(&s.session_id) {
                s.cost_usd = if *any { Some(*usd) } else { None };
                s.cost_estimated = *est;
            }
        }
        Ok(sessions)
    }

    pub fn session_detail(&self, session_id: &str) -> Result<Vec<MessageDetail>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT uuid,parent_uuid,type,timestamp,model,is_sidechain,agent_id,\
             input_tokens,output_tokens,cache_read_tokens,cache_create_5m_tokens,cache_create_1h_tokens,\
             prompt_text,prompt_chars,tool_calls_json,project_slug,cwd \
             FROM messages WHERE session_id=?1 ORDER BY timestamp",
        )?;
        let rows = stmt
            .query_map(params![session_id], |r| {
                Ok(MessageDetail {
                    uuid: r.get(0)?,
                    parent_uuid: r.get(1)?,
                    msg_type: r.get(2)?,
                    timestamp: r.get(3)?,
                    model: r.get(4)?,
                    is_sidechain: r.get::<_, i64>(5)? != 0,
                    agent_id: r.get(6)?,
                    input_tokens: r.get(7)?,
                    output_tokens: r.get(8)?,
                    cache_read_tokens: r.get(9)?,
                    cache_create_5m_tokens: r.get(10)?,
                    cache_create_1h_tokens: r.get(11)?,
                    prompt_text: r.get(12)?,
                    prompt_chars: r.get(13)?,
                    tool_calls_json: r.get(14)?,
                    project_slug: r.get(15)?,
                    cwd: r.get(16)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Expensive user prompts: main-thread assistant work in the window between a
    /// prompt and the next prompt in the same session (INV-4).
    pub fn expensive_prompts(
        &self,
        pricing: &Pricing,
        limit: i64,
        sort: &str,
    ) -> Result<Vec<PromptRow>> {
        let order = if sort == "recent" {
            "p.timestamp DESC"
        } else {
            "billable DESC"
        };
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "WITH prompts AS ( \
               SELECT uuid, session_id, project_slug, timestamp, prompt_text, prompt_chars, \
                      LEAD(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp) AS next_ts \
               FROM messages WHERE type='user' AND prompt_text IS NOT NULL \
             ) \
             SELECT p.uuid, p.session_id, p.project_slug, p.timestamp, p.prompt_text, p.prompt_chars, \
               (SELECT a.model FROM messages a WHERE a.session_id=p.session_id AND a.type='assistant' \
                  AND a.is_sidechain=0 AND a.model IS NOT NULL AND a.timestamp>=p.timestamp \
                  AND (p.next_ts IS NULL OR a.timestamp<p.next_ts) ORDER BY a.timestamp LIMIT 1) AS model, \
               COALESCE(SUM(a.input_tokens),0), COALESCE(SUM(a.output_tokens),0), \
               COALESCE(SUM(a.cache_read_tokens),0), COALESCE(SUM(a.cache_create_5m_tokens),0), \
               COALESCE(SUM(a.cache_create_1h_tokens),0), \
               (COALESCE(SUM(a.input_tokens),0)+COALESCE(SUM(a.output_tokens),0)\
                +COALESCE(SUM(a.cache_create_5m_tokens),0)+COALESCE(SUM(a.cache_create_1h_tokens),0)) AS billable \
             FROM prompts p \
             LEFT JOIN messages a ON a.session_id=p.session_id AND a.type='assistant' AND a.is_sidechain=0 \
               AND a.timestamp>=p.timestamp AND (p.next_ts IS NULL OR a.timestamp<p.next_ts) \
             GROUP BY p.uuid ORDER BY {order} LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![limit], |r| {
                let model: Option<String> = r.get(6)?;
                let u = Usage {
                    input_tokens: r.get(7)?,
                    output_tokens: r.get(8)?,
                    cache_read_tokens: r.get(9)?,
                    cache_create_5m_tokens: r.get(10)?,
                    cache_create_1h_tokens: r.get(11)?,
                };
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    model,
                    u,
                    r.get::<_, i64>(12)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(rows
            .into_iter()
            .map(|(uuid, sid, proj, ts, text, chars, model, u, billable)| {
                let c = pricing.cost_for(model.as_deref(), &u);
                PromptRow {
                    user_uuid: uuid,
                    session_id: sid,
                    project_slug: proj,
                    timestamp: ts,
                    prompt_text: text,
                    prompt_chars: chars,
                    model,
                    billable_tokens: billable,
                    cache_read_tokens: u.cache_read_tokens,
                    estimated_cost_usd: c.usd,
                    cost_estimated: c.estimated,
                }
            })
            .collect())
    }
}
