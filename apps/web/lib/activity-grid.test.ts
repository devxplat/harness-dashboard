import { describe, expect, it } from "vitest";
import {
  axisTicks,
  CELL_SIZE,
  CELL_STEP,
  columnCenter,
  columnLeft,
  gridMetrics,
  markerY,
  niceMax,
  stackRows,
} from "./activity-grid";

describe("gridMetrics", () => {
  it("centers a whole-cell grid inside the plot box", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 100, height: 50 });
    expect(m.cols).toBe(Math.floor(100 / CELL_STEP)); // 8
    expect(m.rows).toBe(Math.floor(50 / CELL_STEP)); // 4
    expect(m.gridWidth).toBe(m.cols * CELL_STEP);
    expect(m.gridHeight).toBe(m.rows * CELL_STEP);
    // centered: leftover width split in half
    expect(m.gridLeft).toBe(Math.round((100 - m.gridWidth) / 2));
    expect(m.gridTop).toBe(Math.round((50 - m.gridHeight) / 2));
  });

  it("clamps to zero for an unmeasured box", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 0, height: 0 });
    expect(m).toMatchObject({ cols: 0, rows: 0, gridWidth: 0, gridHeight: 0 });
  });
});

describe("columnCenter / columnLeft", () => {
  const m = gridMetrics({ left: 0, top: 0, width: 120, height: 120 }); // 10x10, gridLeft 0
  it("snaps a slot to its nearest column center and left", () => {
    // First column center = gridLeft + 0 + INSET + SIZE/2.
    const center = columnCenter(0, CELL_STEP, m);
    expect(center).toBe(columnLeft(0, CELL_STEP, m) + CELL_SIZE / 2);
    expect(center).toBeGreaterThanOrEqual(m.gridLeft);
  });
  it("clamps columns to the grid range", () => {
    const far = columnCenter(10_000, CELL_STEP, m);
    const lastCol = m.gridLeft + (m.cols - 1) * CELL_STEP + 2 + CELL_SIZE / 2;
    expect(far).toBe(Math.round(lastCol));
  });
});

describe("stackRows", () => {
  it("scales tokens to the y-axis and caps sessions on top", () => {
    const r = stackRows({ tokens: 50, sessions: 10, yMax: 100, maxSessions: 10, rows: 20 });
    expect(r.tokenRows).toBe(10); // 50/100 * 20
    // sessions: 10/10 * 20 * 0.3 = 6, capped to remaining 10
    expect(r.sessionRows).toBe(6);
  });
  it("never exceeds the available rows", () => {
    const r = stackRows({ tokens: 1000, sessions: 1000, yMax: 100, maxSessions: 1000, rows: 12 });
    expect(r.tokenRows).toBe(12);
    expect(r.sessionRows).toBe(0);
    expect(r.tokenRows + r.sessionRows).toBeLessThanOrEqual(12);
  });
  it("handles zero maxes without NaN", () => {
    const r = stackRows({ tokens: 0, sessions: 5, yMax: 0, maxSessions: 0, rows: 10 });
    expect(r).toEqual({ tokenRows: 0, sessionRows: 0 });
  });
});

describe("niceMax / axisTicks", () => {
  it("rounds up with headroom to a 1/2/5 ceiling", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(30_000_000)).toBe(50_000_000); // 30M/0.75=40M -> 50M
    expect(niceMax(7)).toBe(10); // 7/0.75=9.33 -> 10
    expect(niceMax(120)).toBe(200); // 160 -> 200
  });
  it("produces five evenly spaced ticks", () => {
    expect(axisTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("markerY", () => {
  const m = gridMetrics({ left: 0, top: 0, width: 120, height: 120 });
  it("returns null for an empty stack and a coordinate otherwise", () => {
    expect(markerY(0, m)).toBeNull();
    const y = markerY(5, m);
    expect(typeof y).toBe("number");
    // marker sits above the bottom of the grid
    expect(y!).toBeLessThan(m.gridTop + m.gridHeight);
  });
});
