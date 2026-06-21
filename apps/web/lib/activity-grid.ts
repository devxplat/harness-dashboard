// Pure geometry/scaling for the recharts "Activity" square-grid chart (template:
// dashboard18 booking-sources). One contiguous column per day; the column step is
// plotWidth/dayCount, so the component constrains the plot width to keep the step
// (and squares) small like the template. Framework-free so it's unit-tested without
// a real recharts layout (jsdom gives charts zero size).

/** Gap between cells (template uses an 8px cell on a 12px step). */
export const GAP = 4;
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
  /** Cell slot (square cells stepped by this both ways). */
  step: number;
  /** Drawn square size (step - GAP). */
  square: number;
  gridLeft: number;
  gridTop: number;
  gridHeight: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A contiguous square grid: `cols` day-columns spanning the width, rows filling height. */
export function gridMetrics(box: PlotBox, cols: number): GridMetrics {
  const c = Math.max(1, cols);
  const step = box.width > 0 ? box.width / c : 0;
  const square = step > 0 ? Math.max(2, step - GAP) : 0;
  const rows = step > 0 ? Math.max(0, Math.floor(box.height / step)) : 0;
  const gridHeight = rows * step;
  return {
    cols: c,
    rows,
    step,
    square,
    gridLeft: box.left,
    gridTop: box.top + (box.height - gridHeight), // bottom-anchored
    gridHeight,
  };
}

/** Left x of the square in day-column `index` (centered in its slot). */
export function cellX(index: number, m: GridMetrics): number {
  return m.gridLeft + index * m.step + (m.step - m.square) / 2;
}

/** Top y of the square `rowFromBottom` rows up from the grid floor. */
export function cellY(rowFromBottom: number, m: GridMetrics): number {
  return m.gridTop + m.gridHeight - (rowFromBottom + 1) * m.step + (m.step - m.square) / 2;
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
