//! harness-core — Claude Code transcript scanning, cost analytics, and persistence.
//!
//! Pure and synchronous (no HTTP server, no async runtime) so the scanner, dedup
//! logic, cost engine, and read queries can be exercised directly with `cargo test`.
//! The `harness-server` crate is a thin axum layer over the APIs exposed here.

pub mod db;
pub mod error;
pub mod jsonl;
pub mod model;
pub mod paths;
pub mod pricing;
pub mod scan;

pub use error::{CoreError, Result};

/// Crate version, surfaced by the server's CLI and `/api/*` responses.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
