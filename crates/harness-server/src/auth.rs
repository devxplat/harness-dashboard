//! Local HTTP authentication for the dashboard API.
//!
//! The app is local-first, but the API can expose private prompts, repository
//! metadata, integration tokens, and endpoints that run local CLIs. A generated
//! per-install API key gives the browser a minimal bearer credential while still
//! keeping first-run setup automatic on loopback.

use crate::AppState;
use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, ORIGIN};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use harness_core::db::Db;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

const API_KEY_SETTING: &str = "server_api_key";
const API_KEY_HASH_SETTING: &str = "server_api_key_sha256";
const API_KEY_MIN_LEN: usize = 24;
const ALLOWED_BROWSER_ORIGIN_PORTS: &[u16] = &[3000, 4173, 8080];

#[derive(Clone, Debug)]
pub struct ApiAuth {
    key_hash: Arc<String>,
    bootstrap_key: Arc<String>,
}

impl ApiAuth {
    fn new(key: String) -> anyhow::Result<Self> {
        validate_api_key(&key)?;
        Ok(Self {
            key_hash: Arc::new(sha256_hex(&key)),
            bootstrap_key: Arc::new(key),
        })
    }

    pub fn verify(&self, candidate: &str) -> bool {
        let hash = sha256_hex(candidate.trim());
        constant_time_eq(hash.as_bytes(), self.key_hash.as_bytes())
    }

    fn bootstrap_key(&self) -> &str {
        &self.bootstrap_key
    }

    fn key_hash(&self) -> &str {
        &self.key_hash
    }
}

/// Load the configured API key, or create a random one on first run.
///
/// `HARNESS_API_KEY` can override the persisted key for automation. Otherwise the
/// generated key is encrypted in the same local secret store used for integration
/// tokens, and only its SHA-256 hash is used for request verification.
pub fn load_or_create(db: &Db) -> anyhow::Result<ApiAuth> {
    if let Ok(key) = std::env::var("HARNESS_API_KEY") {
        return ApiAuth::new(key.trim().to_string());
    }

    if let Some(enc) = db.get_setting(API_KEY_SETTING)? {
        match harness_core::secrets::decrypt(&enc) {
            Ok(key) => {
                let auth = ApiAuth::new(key)?;
                db.set_setting(API_KEY_HASH_SETTING, auth.key_hash())?;
                return Ok(auth);
            }
            Err(e) => {
                tracing::warn!("stored API key could not be decrypted, rotating it: {e}");
            }
        }
    }

    let key = generate_api_key()?;
    db.set_setting(API_KEY_SETTING, &harness_core::secrets::encrypt(&key)?)?;
    let auth = ApiAuth::new(key)?;
    db.set_setting(API_KEY_HASH_SETTING, auth.key_hash())?;
    Ok(auth)
}

#[derive(Debug, Deserialize)]
pub struct BootstrapParams {
    #[serde(default)]
    pub format: Option<String>,
}

/// First-party browser bootstrap. This is intentionally unauthenticated, but only
/// works from loopback clients and local browser origins, so a random internet page
/// cannot silently mint a credential for this server.
pub async fn bootstrap(
    State(s): State<AppState>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<BootstrapParams>,
) -> Response {
    let remote_ok = remote_addr.ip().is_loopback();
    let origin_ok = headers
        .get(ORIGIN)
        .map(is_allowed_browser_origin)
        .unwrap_or(true);

    if !remote_ok || !origin_ok {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "local loopback bootstrap required" })),
        )
            .into_response();
    }

    let key = s.api_auth.bootstrap_key();
    if q.format.as_deref() == Some("text") {
        let mut res = key.to_string().into_response();
        no_store(res.headers_mut());
        return res;
    }

    let mut res = Json(json!({
        "api_key": key,
        "header": "Authorization",
        "scheme": "Bearer"
    }))
    .into_response();
    no_store(res.headers_mut());
    res
}

pub async fn require_api_key(State(s): State<AppState>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if is_unauthenticated_api_path(path) {
        return next.run(req).await;
    }

    if request_has_valid_key(&s, req.headers(), req.uri()) {
        return next.run(req).await;
    }

    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "missing or invalid API key" })),
    )
        .into_response()
}

fn is_unauthenticated_api_path(path: &str) -> bool {
    matches!(
        path,
        "/api/auth/bootstrap" | "/api/integrations/google/callback"
    )
}

fn request_has_valid_key(s: &AppState, headers: &HeaderMap, uri: &Uri) -> bool {
    bearer_token(headers)
        .as_deref()
        .or_else(|| header_token(headers))
        .map(|token| s.api_auth.verify(token))
        .unwrap_or_else(|| {
            (uri.path() == "/api/stream")
                .then(|| query_api_key(uri))
                .flatten()
                .as_deref()
                .map(|token| s.api_auth.verify(token))
                .unwrap_or(false)
        })
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?.trim();
    value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .map(|s| s.trim().to_string())
}

fn header_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("x-harness-api-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn query_api_key(uri: &Uri) -> Option<String> {
    let query = uri.query()?;
    for part in query.split('&') {
        let (name, value) = part.split_once('=')?;
        if name == "api_key" {
            return urlencoding::decode(value).ok().map(|v| v.into_owned());
        }
    }
    None
}

pub fn is_allowed_browser_origin(origin: &HeaderValue) -> bool {
    origin
        .to_str()
        .ok()
        .and_then(origin_parts)
        .map(|(host, port)| {
            is_loopback_host(&host)
                && port
                    .map(|p| ALLOWED_BROWSER_ORIGIN_PORTS.contains(&p))
                    .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn origin_parts(origin: &str) -> Option<(String, Option<u16>)> {
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))?;
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, port) = if authority.starts_with('[') {
        let (host, rest) = authority.split_once(']')?;
        let port = rest.strip_prefix(':').and_then(|p| p.parse::<u16>().ok());
        (host.trim_start_matches('[').to_string(), port)
    } else {
        let (host, port) = authority
            .split_once(':')
            .map(|(host, port)| (host, port.parse::<u16>().ok()))
            .unwrap_or((authority, None));
        (host.to_string(), port)
    };
    Some((host.to_ascii_lowercase(), port))
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost")
        || host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

fn generate_api_key() -> anyhow::Result<String> {
    let mut raw = [0u8; 32];
    getrandom::getrandom(&mut raw).map_err(|e| anyhow::anyhow!("rng error: {e}"))?;
    Ok(B64URL.encode(raw))
}

fn validate_api_key(key: &str) -> anyhow::Result<()> {
    if key.len() < API_KEY_MIN_LEN {
        anyhow::bail!("HARNESS_API_KEY must be at least {API_KEY_MIN_LEN} characters");
    }
    Ok(())
}

fn sha256_hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn no_store(headers: &mut HeaderMap) {
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate, private"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_key_verifies_and_rejects_wrong_values() {
        let key = generate_api_key().unwrap();
        let auth = ApiAuth::new(key.clone()).unwrap();
        assert!(auth.verify(&key));
        assert!(!auth.verify("wrong-key-with-enough-characters"));
    }

    #[test]
    fn browser_origin_must_be_loopback() {
        assert!(is_allowed_browser_origin(&HeaderValue::from_static(
            "http://localhost:3000"
        )));
        assert!(is_allowed_browser_origin(&HeaderValue::from_static(
            "http://127.0.0.1:3000"
        )));
        assert!(is_allowed_browser_origin(&HeaderValue::from_static(
            "http://[::1]:8080"
        )));
        assert!(!is_allowed_browser_origin(&HeaderValue::from_static(
            "http://127.0.0.1:5173"
        )));
        assert!(!is_allowed_browser_origin(&HeaderValue::from_static(
            "https://example.com"
        )));
    }
}
