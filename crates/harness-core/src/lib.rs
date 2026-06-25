//! harness-core — local AI coding data scanning, cost analytics, metrics, and persistence.
//!
//! Pure and synchronous (no HTTP server, no async runtime) so the scanner, dedup
//! logic, cost engine, and read queries can be exercised directly with `cargo test`.
//! The `harness-server` crate is a thin axum layer over the APIs exposed here.

pub mod calendar;
pub mod db;
pub mod error;
pub mod git;
pub mod github;
pub mod jsonl;
pub mod model;
pub mod paths;
pub mod pricing;
pub mod provider_adapters;
pub mod scan;
pub mod secrets;

pub use error::{CoreError, Result};

/// Crate version, surfaced by the server's CLI and `/api/*` responses.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
