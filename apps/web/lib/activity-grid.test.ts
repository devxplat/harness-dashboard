import { describe, expect, it } from "vitest";
import {
  axisTicks,
  cellX,
  cellY,
  columnIndexAt,
  gridMetrics,
  markerY,
  niceMax,
  stackRows,
} from "./activity-grid";

describe("gridMetrics", () => {
  it("makes one column per day spanning the width, with square cells", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 100, height: 50 }, 10);
    expect(m.cols).toBe(10);
    expect(m.step).toBe(10); // 100 / 10 days
    expect(m.size).toBe(7); // step - GAP(3)
    expect(m.rows).toBe(5); // floor(50 / 10)
    expect(m.gridHeight).toBe(50);
    expect(m.gridLeft).toBe(0);
  });

  it("clamps to safe values for an unmeasured box", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 0, height: 0 }, 30);
    expect(m).toMatchObject({ cols: 30, step: 0, rows: 0, gridHeight: 0 });
  });
});

describe("cellX / cellY / columnIndexAt", () => {
  const m = gridMetrics({ left: 0, top: 0, width: 100, height: 50 }, 10); // step 10, size 7
  it("places squares centered in their column slot, bottom-up", () => {
    expect(cellX(0, m)).toBe(1.5); // 0 + 0 + (10-7)/2
    expect(cellX(2, m)).toBe(21.5);
    // bottom row (rowFromBottom 0): top y = gridTop + gridHeight - step + inset
    expect(cellY(0, m)).toBe(0 + 50 - 10 + 1.5);
  });
  it("maps a slot center to its day-column index, clamped", () => {
    expect(columnIndexAt(5, m)).toBe(0); // first column center
    expect(columnIndexAt(25, m)).toBe(2);
    expect(columnIndexAt(10_000, m)).toBe(9); // clamped to last
  });
});

describe("stackRows", () => {
  it("scales tokens to the y-axis and caps sessions on top", () => {
    const r = stackRows({ tokens: 50, sessions: 10, yMax: 100, maxSessions: 10, rows: 20 });
    expect(r.tokenRows).toBe(10); // 50/100 * 20
    expect(r.sessionRows).toBe(6); // 10/10 * 20 * 0.3
  });
  it("never exceeds the available rows", () => {
    const r = stackRows({ tokens: 1000, sessions: 1000, yMax: 100, maxSessions: 1000, rows: 12 });
    expect(r.tokenRows).toBe(12);
    expect(r.sessionRows).toBe(0);
  });
  it("handles zero maxes without NaN", () => {
    expect(stackRows({ tokens: 0, sessions: 5, yMax: 0, maxSessions: 0, rows: 10 })).toEqual({
      tokenRows: 0,
      sessionRows: 0,
    });
  });
});

describe("niceMax / axisTicks", () => {
  it("rounds up with headroom to a 1/2/5 ceiling", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(30_000_000)).toBe(50_000_000);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(120)).toBe(200);
  });
  it("produces five evenly spaced ticks", () => {
    expect(axisTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("markerY", () => {
  const m = gridMetrics({ left: 0, top: 0, width: 100, height: 50 }, 10);
  it("returns null for an empty stack and a coordinate above the floor otherwise", () => {
    expect(markerY(0, m)).toBeNull();
    const y = markerY(3, m);
    expect(typeof y).toBe("number");
    expect(y!).toBeLessThan(m.gridTop + m.gridHeight);
  });
});
