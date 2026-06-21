// Pure geometry/scaling for the recharts "Activity" square-grid chart (ported from
// the dashboard18 booking-sources chart). Kept framework-free so the math is
// unit-tested without a real recharts layout (jsdom gives charts zero size, so the
// SVG-drawing callbacks in activity-heatmap.tsx can't run under unit tests).

export const CELL_STEP = 12;
export const CELL_SIZE = 8;
export const CELL_INSET = 2;
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
  gridLeft: number;
  gridTop: number;
  gridWidth: number;
  gridHeight: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A centered whole-cell grid that fits inside the plot box. */
export function gridMetrics(box: PlotBox): GridMetrics {
  const cols = Math.max(0, Math.floor(box.width / CELL_STEP));
  const rows = Math.max(0, Math.floor(box.height / CELL_STEP));
  const gridWidth = cols * CELL_STEP;
  const gridHeight = rows * CELL_STEP;
  const gridLeft = Math.round(box.left + (box.width - gridWidth) / 2);
  const gridTop = Math.round(box.top + (box.height - gridHeight) / 2);
  return { cols, rows, gridLeft, gridTop, gridWidth, gridHeight };
}

/** Snap a bar's slot (x + width) to the center-x of its nearest grid column. */
export function columnCenter(x: number, width: number, m: GridMetrics): number {
  const centerX = x + width / 2;
  const snapped = Math.round((centerX - m.gridLeft - CELL_STEP / 2) / CELL_STEP);
  const col = clamp(snapped, 0, Math.max(0, m.cols - 1));
  return Math.round(m.gridLeft + col * CELL_STEP + CELL_INSET + CELL_SIZE / 2);
}

export function columnLeft(x: number, width: number, m: GridMetrics): number {
  return Math.round(columnCenter(x, width, m) - CELL_SIZE / 2);
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
  const sessionRows = clamp(
    Math.round(sessionFrac * rows * SESSION_BAND),
    0,
    rows - tokenRows,
  );
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

/** Y of the cursor circle (top of a column's filled stack), or null when empty. */
export function markerY(filledRows: number, m: GridMetrics): number | null {
  if (filledRows <= 0) return null;
  const bottom = m.gridTop + m.gridHeight;
  const topCellY = Math.round(bottom - filledRows * CELL_STEP) + CELL_INSET;
  return topCellY + CELL_SIZE / 2;
}
