//! Google Calendar OAuth (loopback + PKCE) and event fetch — the network half of
//! the Phase-3 integration. Token storage/refresh orchestration lives in the API
//! handlers (they own the DB + at-rest encryption); this module is the HTTP +
//! crypto helpers. Event parsing is in `harness_core::calendar` (pure, tested).

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use harness_core::model::CalendarEventRow;
use serde::Deserialize;
use serde_json::Value;

pub const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_BASE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const EVENTS_URL: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
}

fn b64(bytes: &[u8]) -> String {
    B64URL.encode(bytes)
}

/// A PKCE `(verifier, S256 challenge)` pair.
pub fn pkce_pair() -> (String, String) {
    let mut raw = [0u8; 64];
    let _ = getrandom::getrandom(&mut raw);
    let verifier = b64(&raw);
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = b64(&hasher.finalize());
    (verifier, challenge)
}

/// The consent URL the user opens to grant calendar access.
pub fn build_auth_url(client_id: &str, redirect_uri: &str, challenge: &str) -> String {
    let enc = urlencoding::encode;
    format!(
        "{AUTH_BASE}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256",
        enc(client_id),
        enc(redirect_uri),
        enc(SCOPE),
        enc(challenge),
    )
}

/// Exchange an auth code for tokens (completes the PKCE flow).
pub async fn exchange_code(
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> anyhow::Result<TokenResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("token exchange failed: {}", resp.status());
    }
    Ok(resp.json().await?)
}

/// Mint a fresh access token from a stored refresh token.
pub async fn refresh_access(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> anyhow::Result<TokenResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("token refresh failed: {}", resp.status());
    }
    Ok(resp.json().await?)
}

/// Fetch primary-calendar events in a window around now (−90d … +30d), parsed into
/// insertable rows.
pub async fn fetch_events(access_token: &str) -> anyhow::Result<Vec<CalendarEventRow>> {
    let now = chrono::Utc::now();
    let time_min = (now - chrono::Duration::days(90)).to_rfc3339();
    let time_max = (now + chrono::Duration::days(30)).to_rfc3339();
    let url = format!(
        "{EVENTS_URL}?singleEvents=true&maxResults=2500&orderBy=startTime&timeMin={}&timeMax={}",
        urlencoding::encode(&time_min),
        urlencoding::encode(&time_max),
    );
    let client = reqwest::Client::new();
    let resp = client.get(&url).bearer_auth(access_token).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("calendar fetch failed: {}", resp.status());
    }
    let body: Value = resp.json().await?;
    let events = body
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(harness_core::calendar::parse_event)
                .collect()
        })
        .unwrap_or_default();
    Ok(events)
}
