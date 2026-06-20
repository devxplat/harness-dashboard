//! Serve the embedded Next.js export (release-embed feature only).
//!
//! Resolution: exact path → `path/index.html` (trailing-slash export) →
//! root `index.html`. Unknown `/api/*` never reaches here (the API routes match
//! first); anything else falls back to the SPA shell.

use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../apps/web/out"]
struct Assets;

fn serve(path: &str) -> Option<Response> {
    let asset = Assets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let body = asset.data.into_owned();
    Some(([(header::CONTENT_TYPE, mime.as_ref().to_string())], body).into_response())
}

pub async fn handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let exact = if path.is_empty() { "index.html" } else { path };
    if let Some(r) = serve(exact) {
        return r;
    }
    if let Some(r) = serve(&format!("{}/index.html", path.trim_end_matches('/'))) {
        return r;
    }
    if let Some(r) = serve("index.html") {
        return r;
    }
    (StatusCode::NOT_FOUND, "not found").into_response()
}
