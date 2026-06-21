// Pure geometry/scaling for the recharts "Activity" square-grid chart. One grid
// COLUMN per day: the column step is derived from the plot width / day count so the
// matrix is contiguous and fills the tile. Kept framework-free so the math is
// unit-tested without a real recharts layout (jsdom gives charts zero size).

export const GAP = 3;
/** Fraction of the grid height the (off-axis) session cap may occupy. */
export const SESSION_BAND = 0.3;

/** The plot rectangle (recharts `usePlotArea()` gives `{x,y,width,height}`). */
export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridMetrics {
  cols: number;
  rows: number;
  /** Width/height of one cell slot (square cells stepped by this both ways). */
  step: number;
  /** Drawn square size (step minus the gap). */
  size: number;
  gridLeft: number;
  gridTop: number;
  gridHeight: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A grid with exactly `cols` day-columns spanning the plot width, square cells. */
export function gridMetrics(box: PlotBox, cols: number): GridMetrics {
  const c = Math.max(1, cols);
  const step = box.width > 0 ? box.width / c : 0;
  const size = Math.max(2, step - GAP);
  const rows = step > 0 ? Math.max(0, Math.floor(box.height / step)) : 0;
  const gridHeight = rows * step;
  return {
    cols: c,
    rows,
    step,
    size,
    gridLeft: box.left,
    gridTop: box.top + (box.height - gridHeight), // bottom-anchored
    gridHeight,
  };
}

/** Left x of the square in day-column `index`. */
export function cellX(index: number, m: GridMetrics): number {
  return m.gridLeft + index * m.step + (m.step - m.size) / 2;
}

/** Top y of the square `rowFromBottom` rows up from the grid floor. */
export function cellY(rowFromBottom: number, m: GridMetrics): number {
  return m.gridTop + m.gridHeight - (rowFromBottom + 1) * m.step + (m.step - m.size) / 2;
}

/** Day-column index nearest a slot center-x (clamped to the grid). */
export function columnIndexAt(centerX: number, m: GridMetrics): number {
  if (m.step <= 0) return 0;
  return clamp(Math.round((centerX - m.gridLeft) / m.step - 0.5), 0, m.cols - 1);
}

/**
 * Split a day into stacked grid rows: tokens to the Y-axis scale (blue, bottom),
 * sessions as a relative cap on top (orange, off-axis — capped to SESSION_BAND of
 * the grid and the remaining rows).
 */
export function stackRows(opts: {
  tokens: number;
  sessions: number;
  yMax: number;
  maxSessions: number;
  rows: number;
}): { tokenRows: number; sessionRows: number } {
  const { tokens, sessions, yMax, maxSessions, rows } = opts;
  const tokenRows = yMax > 0 ? clamp(Math.round((tokens / yMax) * rows), 0, rows) : 0;
  const sessionFrac = maxSessions > 0 ? sessions / maxSessions : 0;
  const sessionRows = clamp(Math.round(sessionFrac * rows * SESSION_BAND), 0, rows - tokenRows);
  return { tokenRows, sessionRows };
}

/** Round a max up to a "nice" axis ceiling (1/2/5·10ⁿ) with headroom for the cap. */
export function niceMax(max: number): number {
  const target = max / 0.75;
  if (target <= 0) return 1;
  const exp = Math.floor(Math.log10(target));
  const base = 10 ** exp;
  const frac = target / base;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * base;
}

/** Five evenly spaced ticks from 0 to yMax. */
export function axisTicks(yMax: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
}

/** Y of the cursor circle (center of a column's top filled cell), or null when empty. */
export function markerY(filledRows: number, m: GridMetrics): number | null {
  if (filledRows <= 0 || m.step <= 0) return null;
  return m.gridTop + m.gridHeight - filledRows * m.step + m.step / 2;
}
