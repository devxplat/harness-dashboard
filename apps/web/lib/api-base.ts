// Where the client reaches the Rust API.
// - Packaged build (NODE_ENV=production): same-origin "" — the single binary
//   serves the embedded UI and the API together, so release builds must build
//   with NEXT_PUBLIC_API_BASE UNSET.
// - Dev (`next dev`): the API runs on :8080 of whatever host served this page,
//   so opening the dashboard at http://<lan-ip>:3000 reaches the API at
//   http://<lan-ip>:8080 — localhost and LAN both work without hardcoding an IP.
// NEXT_PUBLIC_API_BASE overrides both when explicitly set.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `http://${window.location.hostname}:8080`
    : "");
