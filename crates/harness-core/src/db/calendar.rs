//! Calendar event storage and meeting-impact queries (Phase 3). All times are
//! RFC3339 "…Z" UTC, so events compare directly with commits/messages for overlap.

use super::Db;
use crate::error::Result;
use crate::model::CalendarEventRow;
use rusqlite::params;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MeetingDay {
    pub day: String,
    pub count: i64,
    pub minutes: i64,
}

/// Coding output during vs free of (busy) meetings — the core meeting-impact split.
#[derive(Debug, Serialize)]
pub struct MeetingImpact {
    pub during_commits: i64,
    pub free_commits: i64,
    pub during_messages: i64,
    pub free_messages: i64,
}

/// `<col>` falls inside some busy calendar event window. A correlated EXISTS — the
/// `<col>` placeholder is an internal column name, never user input.
fn busy_overlap(col: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM calendar_events e WHERE e.is_busy=1 \
           AND e.start_utc IS NOT NULL AND e.end_utc IS NOT NULL \
           AND e.start_utc <= {col} AND e.end_utc > {col})"
    )
}

impl Db {
    /// Upsert calendar events; `is_meeting` is derived (more than one attendee).
    pub fn insert_calendar_events(&self, events: &[CalendarEventRow]) -> Result<usize> {
        if events.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO calendar_events \
                 (event_id, calendar_id, start_utc, end_utc, title, attendee_count, is_busy, is_meeting, updated_at_utc) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            )?;
            for e in events {
                let is_meeting = (e.attendee_count > 1) as i64;
                stmt.execute(params![
                    e.event_id,
                    e.calendar_id,
                    e.start_utc,
                    e.end_utc,
                    e.title,
                    e.attendee_count,
                    e.is_busy as i64,
                    is_meeting,
                    e.updated_at_utc
                ])?;
            }
        }
        tx.commit()?;
        Ok(events.len())
    }

    /// Per-day busy-meeting count + total minutes (for the calendar overlay).
    pub fn meetings_daily(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<Vec<MeetingDay>> {
        let conn = self.conn.lock().unwrap();
        let sql = "SELECT substr(start_utc,1,10) AS day, COUNT(*), \
             CAST(ROUND(COALESCE(SUM((julianday(end_utc)-julianday(start_utc))*1440.0),0)) AS INTEGER) \
             FROM calendar_events \
             WHERE is_busy=1 AND start_utc IS NOT NULL AND end_utc IS NOT NULL \
               AND start_utc >= COALESCE(?, '') AND start_utc < COALESCE(?, '9999-12-31T99:99:99Z') \
             GROUP BY day ORDER BY day";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(MeetingDay {
                    day: r.get(0)?,
                    count: r.get(1)?,
                    minutes: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Commits and assistant messages that fall inside a busy meeting vs outside.
    pub fn meeting_impact(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<MeetingImpact> {
        let conn = self.conn.lock().unwrap();

        let csql = format!(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN {} THEN 1 ELSE 0 END),0) \
             FROM commits c \
             WHERE c.authored_at_utc >= COALESCE(?, '') AND c.authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z')",
            busy_overlap("c.authored_at_utc")
        );
        let (commit_total, commit_during): (i64, i64) =
            conn.query_row(&csql, params![since, until], |r| Ok((r.get(0)?, r.get(1)?)))?;

        let msql = format!(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN {} THEN 1 ELSE 0 END),0) \
             FROM messages m \
             WHERE m.type='assistant' \
               AND m.timestamp >= COALESCE(?, '') AND m.timestamp < COALESCE(?, '9999-12-31T99:99:99Z')",
            busy_overlap("m.timestamp")
        );
        let (msg_total, msg_during): (i64, i64) =
            conn.query_row(&msql, params![since, until], |r| Ok((r.get(0)?, r.get(1)?)))?;

        Ok(MeetingImpact {
            during_commits: commit_during,
            free_commits: commit_total - commit_during,
            during_messages: msg_during,
            free_messages: msg_total - msg_during,
        })
    }
}
