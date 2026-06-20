// Pure helpers for the overview heatmaps (calendar intensity + dot-density columns).
// Kept framework-free so the math is unit-tested without rendering.

import type { DailyRow } from "./types";

export type HeatMetric = "sessions" | "tokens";
export const HEAT_METRICS: HeatMetric[] = ["sessions", "tokens"];

/** Billable-ish token total for a day (fresh input + output + cache writes). */
export function dayTokens(d: DailyRow): number {
  return d.input_tokens + d.output_tokens + d.cache_create_tokens;
}

export function dayValue(d: DailyRow, metric: HeatMetric): number {
  return metric === "sessions" ? d.sessions : dayTokens(d);
}

/** Bucket a value into 0..levels by its share of `max` (any positive value is ≥1). */
export function intensity(value: number, max: number, levels = 4): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(levels, Math.max(1, Math.ceil((value / max) * levels)));
}

/** Local "YYYY-MM-DD" key, matching the backend's per-day grouping string. */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parse a "YYYY-MM-DD" key into a local Date. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Weeks (Sunday-first) covering a month; leading/trailing pad cells are null. */
export function monthGrid(year: number, month: number): (Date | null)[][] {
  const startDow = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function dayMap(rows: DailyRow[]): Map<string, DailyRow> {
  return new Map(rows.map((r) => [r.day, r]));
}

export interface MonthCell {
  date: Date;
  inMonth: boolean;
}

/**
 * A full calendar grid (5 or 6 weeks) for a month, including the spillover days
 * from the adjacent months so the grid is always rectangular — like the
 * dashboard18 availability calendar.
 */
export function monthCells(year: number, month: number): MonthCell[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = firstDow + daysInMonth <= 35 ? 35 : 42;
  const cells: MonthCell[] = [];
  for (let i = 0; i < total; i += 1) {
    // JS Date normalizes day numbers <=0 and >daysInMonth into adjacent months.
    const date = new Date(year, month, i - firstDow + 1);
    cells.push({ date, inMonth: date.getMonth() === month });
  }
  return cells;
}

export function maxValue(rows: DailyRow[], metric: HeatMetric): number {
  return rows.reduce((m, r) => Math.max(m, dayValue(r, metric)), 0);
}

export interface DotColumn {
  day: string;
  sessionDots: number;
  tokenDots: number;
}
export interface DotScale {
  columns: DotColumn[];
  sessionsPerDot: number;
  tokensPerDot: number;
}

/**
 * Convert daily rows into stacked dot counts. Sessions and tokens live on wildly
 * different scales, so each gets its own per-dot quantum sized so the busiest day
 * is ~`targetDots` tall — both series stay legible in one column.
 */
export function dotScale(rows: DailyRow[], targetDots = 16): DotScale {
  const maxSessions = rows.reduce((m, r) => Math.max(m, r.sessions), 0);
  const maxTokens = rows.reduce((m, r) => Math.max(m, dayTokens(r)), 0);
  const sessionsPerDot = Math.max(1, Math.ceil(maxSessions / targetDots));
  const tokensPerDot = Math.max(1, Math.ceil(maxTokens / targetDots));
  const columns = rows.map((r) => ({
    day: r.day,
    sessionDots: Math.ceil(r.sessions / sessionsPerDot),
    tokenDots: Math.ceil(dayTokens(r) / tokensPerDot),
  }));
  return { columns, sessionsPerDot, tokensPerDot };
}
