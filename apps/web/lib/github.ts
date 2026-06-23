// Pure helpers for the GitHub integration UI (rate-budget formatting, backfill
// labels, sync progress, auto-sync timing, org grouping). Framework-free so the
// branchy formatting logic is unit-tested without rendering.

import type { GithubProgress, GithubRepoItem, GithubRepoOrg } from "./types";

export interface RateBudget {
  remaining: number | null;
  limit: number | null;
  reset_utc: string | null;
}

/** "4,870 / 5,000" — or "—" when the budget is unknown. */
export function rateBudgetLabel(rate: RateBudget | null | undefined): string {
  if (!rate || rate.remaining == null || rate.limit == null) return "—";
  return `${rate.remaining.toLocaleString("en-US")} / ${rate.limit.toLocaleString("en-US")}`;
}

export type RateTone = "ok" | "warn" | "danger";

/** Colour band for the remaining rate budget. */
export function rateBudgetTone(
  remaining: number | null | undefined,
  limit: number | null | undefined,
): RateTone {
  if (remaining == null || limit == null || limit <= 0) return "ok";
  const frac = remaining / limit;
  if (remaining < 100 || frac < 0.1) return "danger";
  if (frac < 0.25) return "warn";
  return "ok";
}

/** Human label for the backfill window setting. */
export function backfillSummary(value: number, unit: string): string {
  if (unit === "all") return "All history";
  if (unit === "recent") return "Recent only";
  const n = Math.max(1, Math.round(value));
  const u = n === 1 ? unit.replace(/s$/, "") : unit;
  return `${n} ${u}`;
}

/** 0..100 progress from a sync snapshot (0 when total unknown). */
export function progressPercent(p: GithubProgress | null | undefined): number {
  if (!p || p.repo_total <= 0) return 0;
  return Math.min(100, Math.round((p.repo_index / p.repo_total) * 100));
}

/** "due now" / "in 42m" / "in 2h 5m" for the next auto-sync, or null when off /
 * never synced. `now`/`lastSync` are epoch ms; `intervalMin` minutes. */
export function nextAutoSyncLabel(
  lastSyncMs: number | null,
  intervalMin: number,
  nowMs: number,
): string {
  if (lastSyncMs == null) return "due now";
  const dueMs = lastSyncMs + intervalMin * 60_000;
  const deltaMin = Math.round((dueMs - nowMs) / 60_000);
  if (deltaMin <= 0) return "due now";
  if (deltaMin < 60) return `in ${deltaMin}m`;
  const h = Math.floor(deltaMin / 60);
  const m = deltaMin % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

/** Group a flat repo list by owner (org), sorted, with per-org enabled counts.
 * The server can pre-group, but this keeps the UI robust to a flat payload. */
export function groupReposByOrg(repos: GithubRepoItem[]): GithubRepoOrg[] {
  const byOwner = new Map<string, GithubRepoItem[]>();
  for (const r of repos) {
    const list = byOwner.get(r.owner) ?? [];
    list.push(r);
    byOwner.set(r.owner, list);
  }
  return [...byOwner.entries()]
    .map(([owner, list]) => ({
      owner,
      repos: [...list].sort((a, b) => a.repo.localeCompare(b.repo)),
      enabled_count: list.filter((r) => r.enabled).length,
      total: list.length,
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner));
}
