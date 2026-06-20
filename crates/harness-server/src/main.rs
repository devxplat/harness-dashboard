//! `harness-dashboard` — local-first Claude Code usage dashboard.
//!
//! The HTTP server, SSE stream, background scan loop, and embedded frontend are
//! layered on top of `harness-core` across the v0.1 build. This entrypoint is a
//! placeholder that will grow a `clap` CLI (`--port`, `--host`, `--db`,
//! `--projects-dir`, `--dev`, `--no-open`).

fn main() {
    println!("harness-dashboard {}", harness_core::VERSION);
}
