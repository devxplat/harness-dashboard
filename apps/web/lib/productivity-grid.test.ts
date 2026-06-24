import {
  aiTotals,
  buildMatrix,
  cellValue,
  hourLabel,
  hourTotals,
  intensity,
  matrixMax,
  peakBucket,
} from "@/lib/productivity-grid";
import type { AiSplitRow, ProductiveHourRow } from "@/lib/types";
import { describe, expect, it } from "vitest";

const hr = (dow: number, hour: number, commits: number, messages: number): ProductiveHourRow => ({
  dow,
  hour,
  commits,
  messages,
});

describe("cellValue", () => {
  it("selects the metric (and sums for 'both')", () => {
    const row = hr(1, 9, 3, 10);
    expect(cellValue(row, "commits")).toBe(3);
    expect(cellValue(row, "messages")).toBe(10);
    expect(cellValue(row, "both")).toBe(13);
  });
});

describe("buildMatrix", () => {
  it("places values at [dow][hour] and ignores out-of-range rows", () => {
    const grid = buildMatrix(
      [hr(2, 14, 5, 0), hr(7, 0, 9, 9), hr(0, 24, 9, 9), hr(0, -1, 9, 9)],
      "commits",
    );
    expect(grid.length).toBe(7);
    expect(grid[0]?.length).toBe(24);
    expect(grid[2]?.[14]).toBe(5);
    // dow 7, hour 24, hour -1 are all dropped → grid stays otherwise zero.
    expect(matrixMax(grid)).toBe(5);
  });

  it("accumulates repeated buckets", () => {
    const grid = buildMatrix([hr(1, 9, 2, 0), hr(1, 9, 3, 0)], "commits");
    expect(grid[1]?.[9]).toBe(5);
  });
});

describe("intensity", () => {
  it("returns 0 for non-positive value or max", () => {
    expect(intensity(0, 10)).toBe(0);
    expect(intensity(5, 0)).toBe(0);
  });
  it("buckets by share of max, min 1 for any positive value", () => {
    expect(intensity(1, 100)).toBe(1);
    expect(intensity(100, 100)).toBe(4);
    expect(intensity(60, 100)).toBe(3);
  });
});

describe("matrixMax", () => {
  it("is 0 for an all-zero grid", () => {
    expect(matrixMax(buildMatrix([], "both"))).toBe(0);
  });
});

describe("hourTotals", () => {
  it("sums commits and messages across buckets", () => {
    expect(hourTotals([hr(1, 9, 2, 5), hr(2, 10, 3, 7)])).toEqual({ commits: 5, messages: 12 });
  });
});

describe("peakBucket", () => {
  it("returns null when every bucket is empty", () => {
    expect(peakBucket(buildMatrix([], "commits"))).toBeNull();
  });
  it("finds the most active bucket", () => {
    const grid = buildMatrix([hr(1, 9, 2, 0), hr(3, 22, 8, 0), hr(5, 14, 4, 0)], "commits");
    expect(peakBucket(grid)).toEqual({ dow: 3, hour: 22, value: 8 });
  });
});

describe("hourLabel", () => {
  it("formats 12-hour am/pm ticks", () => {
    expect(hourLabel(0)).toBe("12a");
    expect(hourLabel(9)).toBe("9a");
    expect(hourLabel(12)).toBe("12p");
    expect(hourLabel(17)).toBe("5p");
  });
});

describe("aiTotals", () => {
  it("sums and computes the AI fraction", () => {
    const rows: AiSplitRow[] = [
      { key: "2026-06-20", ai_commits: 3, human_commits: 1 },
      { key: "2026-06-21", ai_commits: 1, human_commits: 0 },
    ];
    expect(aiTotals(rows)).toEqual({ ai: 4, human: 1, total: 5, pct: 0.8 });
  });
  it("is 0% when there are no commits", () => {
    expect(aiTotals([])).toEqual({ ai: 0, human: 0, total: 0, pct: 0 });
  });
});
