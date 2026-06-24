// Pure helpers for the Performance page: the productive-hours matrix (local
// weekday × hour) and the AI-vs-human commit split. Framework-free so the math is
// unit-tested without rendering (the grid is the analogue of lib/heatmap.ts).

import type { AiSplitRow, ProductiveHourRow } from "./types";

export type ProductivityMetric = "commits" | "messages" | "both";
export const PRODUCTIVITY_METRICS: ProductivityMetric[] = ["commits", "messages", "both"];

/** 0=Sunday..6=Saturday, matching the backend's `authored_dow` / strftime('%w'). */
export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The chosen metric's value for one bucket. */
export function cellValue(row: ProductiveHourRow, metric: ProductivityMetric): number {
  if (metric === "commits") return row.commits;
  if (metric === "messages") return row.messages;
  return row.commits + row.messages;
}

/** Dense 7×24 matrix `[dow][hour]` of the chosen metric, from API rows that may be
 * sparse, unordered, or out of range. */
export function buildMatrix(rows: ProductiveHourRow[], metric: ProductivityMetric): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) {
    const row = grid[r.dow];
    if (row && r.hour >= 0 && r.hour < 24) {
      row[r.hour] = (row[r.hour] ?? 0) + cellValue(r, metric);
    }
  }
  return grid;
}

export function matrixMax(grid: number[][]): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

/** Bucket a value into 0..levels by its share of `max` (mirrors lib/heatmap). */
export function intensity(value: number, max: number, levels = 4): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(levels, Math.max(1, Math.ceil((value / max) * levels)));
}

/** Grand totals across every bucket (for the header summary). */
export function hourTotals(rows: ProductiveHourRow[]): { commits: number; messages: number } {
  let commits = 0;
  let messages = 0;
  for (const r of rows) {
    commits += r.commits;
    messages += r.messages;
  }
  return { commits, messages };
}

/** The single most active bucket for a built matrix, or null when all-zero. */
export function peakBucket(grid: number[][]): { dow: number; hour: number; value: number } | null {
  let best: { dow: number; hour: number; value: number } | null = null;
  for (let d = 0; d < grid.length; d += 1) {
    const row = grid[d];
    if (!row) continue;
    for (let h = 0; h < row.length; h += 1) {
      const v = row[h] ?? 0;
      if (v > 0 && (best === null || v > best.value)) best = { dow: d, hour: h, value: v };
    }
  }
  return best;
}

/** Short hour label for axis ticks: 0→"12a", 9→"9a", 12→"12p", 17→"5p". */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? "a" : "p";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${period}`;
}

/** AI vs human totals and the AI fraction (0..1) for an AiSplitRow set. */
export function aiTotals(rows: AiSplitRow[]): { ai: number; human: number; total: number; pct: number } {
  let ai = 0;
  let human = 0;
  for (const r of rows) {
    ai += r.ai_commits;
    human += r.human_commits;
  }
  const total = ai + human;
  return { ai, human, total, pct: total > 0 ? ai / total : 0 };
}
