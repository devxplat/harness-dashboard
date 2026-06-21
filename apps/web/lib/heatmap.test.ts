import { describe, expect, it } from "vitest";
import {
  dayMap,
  dayTokens,
  dayValue,
  intensity,
  isoDay,
  maxValue,
  monthCells,
  monthGrid,
  parseDay,
} from "./heatmap";
import type { DailyRow } from "./types";

function row(day: string, sessions: number, input = 0, output = 0, cacheCreate = 0): DailyRow {
  return {
    day,
    sessions,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: 0,
    cache_create_tokens: cacheCreate,
  };
}

describe("dayTokens / dayValue", () => {
  it("sums input+output+cache writes and selects by metric", () => {
    const r = row("2026-06-01", 3, 100, 50, 25);
    expect(dayTokens(r)).toBe(175);
    expect(dayValue(r, "sessions")).toBe(3);
    expect(dayValue(r, "tokens")).toBe(175);
  });
});

describe("intensity", () => {
  it("returns 0 for non-positive and buckets the rest", () => {
    expect(intensity(0, 100)).toBe(0);
    expect(intensity(50, 0)).toBe(0);
    expect(intensity(1, 100, 4)).toBe(1);
    expect(intensity(100, 100, 4)).toBe(4);
    expect(intensity(60, 100, 4)).toBe(3);
    expect(intensity(999, 100, 4)).toBe(4); // clamped
  });
});

describe("isoDay / parseDay", () => {
  it("round-trips a local date", () => {
    expect(isoDay(new Date(2026, 5, 7))).toBe("2026-06-07");
    const d = parseDay("2026-06-07");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 7]);
  });
});

describe("monthGrid", () => {
  it("pads to whole weeks and contains every day", () => {
    const weeks = monthGrid(2026, 5); // June 2026, starts on a Monday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const days = weeks.flat().filter(Boolean) as Date[];
    expect(days.length).toBe(30);
    expect(weeks[0]?.[0]).toBeNull(); // Sunday pad before Mon Jun 1
  });
});

describe("monthCells", () => {
  it("returns full weeks with adjacent-month spillover flagged", () => {
    const cells = monthCells(2026, 5); // June 2026
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBeGreaterThanOrEqual(35);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth.length).toBe(30);
    // The very first cell is a May spillover day (June 1 2026 is a Monday).
    expect(cells[0]?.inMonth).toBe(false);
    expect(cells[0]?.date.getMonth()).toBe(4); // May
  });
});

describe("dayMap / maxValue", () => {
  it("indexes by day and finds the metric max", () => {
    const rows = [row("2026-06-01", 2, 10), row("2026-06-02", 5, 1000)];
    const m = dayMap(rows);
    expect(m.get("2026-06-02")?.sessions).toBe(5);
    expect(maxValue(rows, "sessions")).toBe(5);
    expect(maxValue(rows, "tokens")).toBe(1000);
    expect(maxValue([], "sessions")).toBe(0);
  });
});
