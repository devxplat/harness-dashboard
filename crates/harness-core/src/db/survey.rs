//! Local DevEx self-survey (P3 #11). A voluntary self-pulse stored locally — no
//! telemetry — whose Likert answers are correlated (daily) with the hard metrics
//! (commits / AI commits / assistant messages). Correlations are descriptive only
//! and gated on n ≥ 3; the UI labels them "directional, not causal".

use super::ai_impact::pearson;
use super::Db;
use crate::error::Result;
use rusqlite::params;
use serde::Serialize;
use std::collections::BTreeMap;

const SUBMITTED_BOUND: &str =
    " submitted_at_utc >= COALESCE(?, '') AND submitted_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') ";
const AI_PREDICATE: &str = "(ai_session_overlap=1 OR ai_coauthor_trailer=1)";

#[derive(Debug, Serialize)]
pub struct SurveyResponseRow {
    pub id: i64,
    pub submitted_at_utc: String,
    pub flow: Option<i64>,
    pub productivity: Option<i64>,
    pub ai_helpful: Option<i64>,
    pub satisfaction: Option<i64>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct SurveyTrendRow {
    pub period: String,
    pub responses: i64,
    pub avg_flow: Option<f64>,
    pub avg_productivity: Option<f64>,
    pub avg_ai_helpful: Option<f64>,
    pub avg_satisfaction: Option<f64>,
    pub commits: i64,
    pub ai_commits: i64,
    pub messages: i64,
}

#[derive(Debug, Serialize)]
pub struct SurveyCorrelationRow {
    pub sentiment: String,
    pub metric: String,
    pub r: Option<f64>,
    pub n: i64,
}

#[derive(Debug, Serialize)]
pub struct SurveyCorrelationBundle {
    pub trend: Vec<SurveyTrendRow>,
    pub correlations: Vec<SurveyCorrelationRow>,
    pub responses: Vec<SurveyResponseRow>,
}

#[derive(Default)]
struct DayAcc {
    // sums + counts for the four Likert sentiments (NULLs skipped)
    flow: (f64, i64),
    productivity: (f64, i64),
    ai_helpful: (f64, i64),
    satisfaction: (f64, i64),
    responses: i64,
    commits: i64,
    ai_commits: i64,
    messages: i64,
}

fn mean(sum_count: (f64, i64)) -> Option<f64> {
    (sum_count.1 > 0).then(|| sum_count.0 / sum_count.1 as f64)
}

/// Accessors for the sentiment × metric correlation loop.
type SentimentGetter = fn(&SurveyTrendRow) -> Option<f64>;
type MetricGetter = fn(&SurveyTrendRow) -> f64;

impl Db {
    /// Append a self-pulse. Likert values should already be clamped to 1..=5 (or None).
    #[allow(clippy::too_many_arguments)]
    pub fn insert_survey_response(
        &self,
        submitted_at_utc: &str,
        flow: Option<i64>,
        productivity: Option<i64>,
        ai_helpful: Option<i64>,
        satisfaction: Option<i64>,
        note: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO survey_responses \
             (submitted_at_utc, flow, productivity, ai_helpful, satisfaction, note) \
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                submitted_at_utc,
                flow,
                productivity,
                ai_helpful,
                satisfaction,
                note
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Recent survey responses (newest first) in range.
    pub fn survey_responses(
        &self,
        since: Option<&str>,
        until: Option<&str>,
        limit: i64,
    ) -> Result<Vec<SurveyResponseRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT id, submitted_at_utc, flow, productivity, ai_helpful, satisfaction, note \
             FROM survey_responses WHERE {SUBMITTED_BOUND} ORDER BY submitted_at_utc DESC LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![since, until, limit], |r| {
                Ok(SurveyResponseRow {
                    id: r.get(0)?,
                    submitted_at_utc: r.get(1)?,
                    flow: r.get(2)?,
                    productivity: r.get(3)?,
                    ai_helpful: r.get(4)?,
                    satisfaction: r.get(5)?,
                    note: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Daily sentiment trend joined to commits/messages, plus Pearson correlations
    /// (sentiment × metric) over the aligned daily series (n ≥ 3 gated).
    pub fn survey_correlation(
        &self,
        since: Option<&str>,
        until: Option<&str>,
    ) -> Result<SurveyCorrelationBundle> {
        let mut map: BTreeMap<String, DayAcc> = BTreeMap::new();
        {
            let conn = self.conn.lock().unwrap();

            let ssql = format!(
                "SELECT substr(submitted_at_utc,1,10) AS day, COUNT(*), \
                 AVG(flow), AVG(productivity), AVG(ai_helpful), AVG(satisfaction) \
                 FROM survey_responses WHERE {SUBMITTED_BOUND} GROUP BY day"
            );
            let mut stmt = conn.prepare(&ssql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                    r.get::<_, Option<f64>>(3)?,
                    r.get::<_, Option<f64>>(4)?,
                    r.get::<_, Option<f64>>(5)?,
                ))
            })?;
            for row in rows {
                let (day, n, flow, prod, ai_help, sat) = row?;
                let e = map.entry(day).or_default();
                e.responses = n;
                // store the daily averages directly as (sum,count)=(avg,1) so `mean` works
                if let Some(v) = flow {
                    e.flow = (v, 1);
                }
                if let Some(v) = prod {
                    e.productivity = (v, 1);
                }
                if let Some(v) = ai_help {
                    e.ai_helpful = (v, 1);
                }
                if let Some(v) = sat {
                    e.satisfaction = (v, 1);
                }
            }

            let csql = format!(
                "SELECT substr(authored_at_utc,1,10) AS day, COUNT(*), \
                 COALESCE(SUM(CASE WHEN {AI_PREDICATE} THEN 1 ELSE 0 END),0) \
                 FROM commits WHERE authored_at_utc >= COALESCE(?, '') \
                   AND authored_at_utc < COALESCE(?, '9999-12-31T99:99:99Z') GROUP BY day"
            );
            let mut stmt = conn.prepare(&csql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (day, commits, ai_commits) = row?;
                let e = map.entry(day).or_default();
                e.commits = commits;
                e.ai_commits = ai_commits;
            }

            let msql = "SELECT substr(timestamp,1,10) AS day, COUNT(*) FROM messages \
                 WHERE type='assistant' AND timestamp >= COALESCE(?, '') \
                   AND timestamp < COALESCE(?, '9999-12-31T99:99:99Z') GROUP BY day";
            let mut stmt = conn.prepare(msql)?;
            let rows = stmt.query_map(params![since, until], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?;
            for row in rows {
                let (day, messages) = row?;
                map.entry(day).or_default().messages = messages;
            }
        }

        let trend: Vec<SurveyTrendRow> = map
            .iter()
            .map(|(day, a)| SurveyTrendRow {
                period: day.clone(),
                responses: a.responses,
                avg_flow: mean(a.flow),
                avg_productivity: mean(a.productivity),
                avg_ai_helpful: mean(a.ai_helpful),
                avg_satisfaction: mean(a.satisfaction),
                commits: a.commits,
                ai_commits: a.ai_commits,
                messages: a.messages,
            })
            .collect();

        // Pearson per (sentiment, metric) over days where the sentiment is present.
        let sentiments: [(&str, SentimentGetter); 4] = [
            ("flow", |t| t.avg_flow),
            ("productivity", |t| t.avg_productivity),
            ("ai_helpful", |t| t.avg_ai_helpful),
            ("satisfaction", |t| t.avg_satisfaction),
        ];
        let metrics: [(&str, MetricGetter); 3] = [
            ("commits", |t| t.commits as f64),
            ("ai_commits", |t| t.ai_commits as f64),
            ("messages", |t| t.messages as f64),
        ];
        let mut correlations = Vec::new();
        for (sname, sget) in sentiments {
            for (mname, mget) in metrics {
                let mut xs = Vec::new();
                let mut ys = Vec::new();
                for t in &trend {
                    if let Some(v) = sget(t) {
                        xs.push(v);
                        ys.push(mget(t));
                    }
                }
                let n = xs.len() as i64;
                correlations.push(SurveyCorrelationRow {
                    sentiment: sname.to_string(),
                    metric: mname.to_string(),
                    r: if n >= 3 { pearson(&xs, &ys) } else { None },
                    n,
                });
            }
        }

        let responses = self.survey_responses(since, until, 100)?;
        Ok(SurveyCorrelationBundle {
            trend,
            correlations,
            responses,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn survey_insert_list_and_correlation() {
        let db = Db::open_in_memory().unwrap();
        db.insert_survey_response(
            "2026-01-01T18:00:00Z",
            Some(4),
            Some(5),
            Some(4),
            Some(5),
            Some("good"),
        )
        .unwrap();
        db.insert_survey_response(
            "2026-01-02T18:00:00Z",
            Some(2),
            Some(2),
            None,
            Some(3),
            None,
        )
        .unwrap();

        let list = db.survey_responses(None, None, 10).unwrap();
        assert_eq!(list.len(), 2);
        // newest first
        assert_eq!(list[0].submitted_at_utc, "2026-01-02T18:00:00Z");
        assert_eq!(list[0].ai_helpful, None);

        let bundle = db.survey_correlation(None, None).unwrap();
        assert_eq!(bundle.trend.len(), 2);
        assert_eq!(bundle.trend[0].avg_flow, Some(4.0));
        // 12 sentiment×metric correlation cells, all n<3 here → r None.
        assert_eq!(bundle.correlations.len(), 12);
        assert!(bundle.correlations.iter().all(|c| c.r.is_none()));
    }
}
