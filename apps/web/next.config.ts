import type { NextConfig } from "next";

// Client-rendered static export: the Rust server embeds `out/` and serves the
// API on the same origin. No server-only Next features (see the v0.1 spec).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // Allow LAN devices to reach the dev server's HMR/_next resources (used by
  // `pnpm dev:lan`). Wildcards cover any host on a private subnet; add yours if
  // it differs. No effect in the packaged build.
  allowedDevOrigins: ["192.168.0.*", "192.168.1.*", "192.168.128.*", "10.0.0.*"],
};

export default nextConfig;
