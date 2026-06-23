//! Pure parser from Google Calendar API event JSON into an insertable row.
//!
//! The OAuth flow and event fetch live in `harness-server` (async, opt-in); this is
//! the offline half — timezone normalization and field extraction — so it is fully
//! `cargo test`-able without any network.

use crate::model::CalendarEventRow;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;

/// Normalize a Calendar `start`/`end` object to a UTC RFC3339 "…Z" instant.
/// Timed events carry `dateTime` (with an offset); all-day events carry `date`.
fn to_utc(slot: &Value) -> Option<String> {
    if let Some(dt) = slot.get("dateTime").and_then(Value::as_str) {
        return DateTime::parse_from_rfc3339(dt).ok().map(|d| {
            d.with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true)
        });
    }
    slot.get("date")
        .and_then(Value::as_str)
        .map(|d| format!("{d}T00:00:00Z"))
}

/// Parse one event from `GET /calendars/{id}/events`. Cancelled events return
/// `None`. `is_meeting` is derived later (attendee_count > 1) at insert time.
pub fn parse_event(v: &Value) -> Option<CalendarEventRow> {
    if v.get("status").and_then(Value::as_str) == Some("cancelled") {
        return None;
    }
    let event_id = v.get("id").and_then(Value::as_str)?.to_string();
    let attendee_count = v
        .get("attendees")
        .and_then(Value::as_array)
        .map(|a| a.len() as i64)
        .unwrap_or(0);
    // "transparent" means the event does not block time (free); default is busy.
    let is_busy = v.get("transparency").and_then(Value::as_str) != Some("transparent");
    Some(CalendarEventRow {
        event_id,
        calendar_id: v
            .get("organizer")
            .and_then(|o| o.get("email"))
            .and_then(Value::as_str)
            .map(str::to_string),
        start_utc: v.get("start").and_then(to_utc),
        end_utc: v.get("end").and_then(to_utc),
        title: v.get("summary").and_then(Value::as_str).map(str::to_string),
        attendee_count,
        is_busy,
        updated_at_utc: v.get("updated").and_then(Value::as_str).map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_a_timed_meeting_to_utc() {
        let ev = parse_event(&json!({
            "id": "abc",
            "summary": "Standup",
            "start": { "dateTime": "2026-06-20T07:00:00-03:00" },
            "end": { "dateTime": "2026-06-20T07:30:00-03:00" },
            "attendees": [ { "email": "a@x.com" }, { "email": "b@x.com" } ],
            "updated": "2026-06-19T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(ev.start_utc.as_deref(), Some("2026-06-20T10:00:00Z"));
        assert_eq!(ev.attendee_count, 2);
        assert!(ev.is_busy);
    }

    #[test]
    fn all_day_event_uses_date() {
        let ev = parse_event(&json!({
            "id": "d1", "summary": "Holiday",
            "start": { "date": "2026-06-20" }, "end": { "date": "2026-06-21" },
            "transparency": "transparent"
        }))
        .unwrap();
        assert_eq!(ev.start_utc.as_deref(), Some("2026-06-20T00:00:00Z"));
        assert!(!ev.is_busy);
        assert_eq!(ev.attendee_count, 0);
    }

    #[test]
    fn cancelled_and_idless_are_dropped() {
        assert!(parse_event(&json!({ "id": "x", "status": "cancelled" })).is_none());
        assert!(parse_event(&json!({ "summary": "no id" })).is_none());
    }
}
