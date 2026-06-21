import { describe, expect, it } from "vitest";
import {
  axisTicks,
  cellX,
  cellY,
  columnIndexAt,
  dayStack,
  GAP,
  gridMetrics,
  markerY,
  niceMax,
  SQUARE_MAX,
  stackHeight,
} from "./activity-grid";

describe("gridMetrics", () => {
  it("makes one contiguous column per day with square cells", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 100, height: 50 }, 10);
    expect(m.cols).toBe(10);
    expect(m.step).toBe(10); // 100 / 10 days
    expect(m.square).toBe(10 - GAP); // step - GAP (below the cap)
    expect(m.vStep).toBe(10); // square + GAP
    expect(m.rows).toBe(5); // floor(50 / 10)
    expect(m.gridHeight).toBe(50);
    expect(m.gridLeft).toBe(0);
  });

  it("caps the square for wide columns and gets rows from the smaller vertical pitch", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 600, height: 130 }, 20);
    expect(m.step).toBe(30); // 600 / 20 days (wide)
    expect(m.square).toBe(SQUARE_MAX); // 30 - GAP would be 26, capped to 13
    expect(m.vStep).toBe(SQUARE_MAX + GAP); // 17
    expect(m.rows).toBe(7); // floor(130 / 17)
    expect(m.gridHeight).toBe(119); // 7 * 17
    expect(m.gridTop).toBe(11); // bottom-anchored: 130 - 119
  });

  it("clamps to safe values for an unmeasured box", () => {
    const m = gridMetrics({ left: 0, top: 0, width: 0, height: 0 }, 30);
    expect(m).toMatchObject({ cols: 30, step: 0, square: 0, vStep: 0, rows: 0, gridHeight: 0 });
  });
});

describe("cellX / cellY / columnIndexAt", () => {
  const m = gridMetrics({ left: 0, top: 0, width: 100, height: 50 }, 10); // step 10, square 6
  it("places squares centered in their column slot, bottom-up", () => {
    expect(cellX(0, m)).toBe((m.step - m.square) / 2);
    expect(cellX(2, m)).toBe(2 * m.step + (m.step - m.square) / 2);
    expect(cellY(0, m)).toBe(m.gridTop + m.gridHeight - m.step + (m.step - m.square) / 2);
  });
  it("maps a slot center to its day-column index, clamped", () => {
    expect(columnIndexAt(5, m)).toBe(0);
    expect(columnIndexAt(25, m)).toBe(2);
    expect(columnIndexAt(10_000, m)).toBe(9);
  });
});

describe("dayStack", () => {
  it("splits AM (bottom) and PM (top) with a divider gap, capping sessions on top", () => {
    const s = dayStack({
      amTokens: 30,
      pmTokens: 30,
      sessions: 5,
      yMax: 100,
      maxSessions: 10,
      rows: 12,
    });
    // 30/100*12 -> 4 rows each; both halves present -> 1 gap row; sessions 0.5*12*0.3 -> 2.
    expect(s).toEqual({ amTokenRows: 4, pmTokenRows: 4, gapRows: 1, sessionRows: 2 });
    expect(stackHeight(s)).toBe(11); // 4 + 1 + 4 + 2
  });

  it("omits the divider when only one half has tokens", () => {
    const s = dayStack({
      amTokens: 50,
      pmTokens: 0,
      sessions: 0,
      yMax: 100,
      maxSessions: 10,
      rows: 12,
    });
    expect(s).toEqual({ amTokenRows: 6, pmTokenRows: 0, gapRows: 0, sessionRows: 0 });
  });

  it("never exceeds the available rows", () => {
    const s = dayStack({
      amTokens: 1000,
      pmTokens: 1000,
      sessions: 1000,
      yMax: 100,
      maxSessions: 1000,
      rows: 10,
    });
    expect(stackHeight(s)).toBeLessThanOrEqual(10);
    expect(s.amTokenRows).toBe(10);
  });

  it("handles zero maxes without NaN", () => {
    expect(
      dayStack({ amTokens: 0, pmTokens: 0, sessions: 5, yMax: 0, maxSessions: 0, rows: 10 }),
    ).toEqual({ amTokenRows: 0, pmTokenRows: 0, gapRows: 0, sessionRows: 0 });
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
