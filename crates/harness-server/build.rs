fn main() {
    // When embedding the frontend, fail early with a clear message if the export
    // is missing — it must be built first (`pnpm --filter @harness/web build`).
    if std::env::var_os("CARGO_FEATURE_RELEASE_EMBED").is_some() {
        let index = std::path::Path::new("../../apps/web/out/index.html");
        if !index.exists() {
            panic!(
                "release-embed is enabled but ../../apps/web/out/index.html is missing.\n\
                 Build the frontend first: pnpm --filter @harness/web build"
            );
        }
        println!("cargo:rerun-if-changed=../../apps/web/out");
    }
}
