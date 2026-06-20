import type { NextConfig } from "next";

// Client-rendered static export: the Rust server embeds `out/` and serves the
// API on the same origin. No server-only Next features (see the v0.1 spec).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
