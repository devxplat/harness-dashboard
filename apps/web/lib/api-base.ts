// Empty in packaged builds (same-origin); set to http://127.0.0.1:8080 in dev
// via apps/web/.env.local. Inlined at build time, so release builds must build
// with this UNSET.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
