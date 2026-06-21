// Pure geometry/scaling for the recharts "Activity" square-grid chart (template:
// dashboard18 booking-sources). One contiguous column per day; the column step is
// plotWidth/dayCount, so the component constrains the plot width to keep the step
// (and squares) small like the template. Framework-free so it's unit-tested without
// a real recharts layout (jsdom gives charts zero size).

/** Gap between cells (template uses an 8px cell on a 12px step). */
export const GAP = 4;
/**
 * Max drawn square size. With only ~30 day-columns the raw column width would make
 * huge squares; capping keeps the small-tile template look and (via the smaller
 * vertical pitch it implies) frees up enough rows to split AM/PM within a day.
 */
export const SQUARE_MAX = 13;
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
  /** Horizontal column slot width (one day per slot). */
  step: number;
  /** Drawn square size (`step - GAP`, capped at SQUARE_MAX). */
  square: number;
  /** Vertical cell pitch (`square + GAP`) — decoupled from `step` so capped
   * squares still yield enough rows to stack AM over PM within a day. */
  vStep: number;
  gridLeft: number;
  gridTop: number;
  gridHeight: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A square grid: `cols` day-columns spanning the width, rows stacked by `vStep`. */
export function gridMetrics(box: PlotBox, cols: number): GridMetrics {
  const c = Math.max(1, cols);
  const step = box.width > 0 ? box.width / c : 0;
  const square = step > 0 ? clamp(step - GAP, 2, SQUARE_MAX) : 0;
  const vStep = square > 0 ? square + GAP : 0;
  const rows = vStep > 0 ? Math.max(0, Math.floor(box.height / vStep)) : 0;
  const gridHeight = rows * vStep;
  return {
    cols: c,
    rows,
    step,
    square,
    vStep,
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
  return m.gridTop + m.gridHeight - (rowFromBottom + 1) * m.vStep + (m.vStep - m.square) / 2;
}

/** Day-column index nearest a slot center-x (clamped to the grid). */
export function columnIndexAt(centerX: number, m: GridMetrics): number {
  if (m.step <= 0) return 0;
  return clamp(Math.round((centerX - m.gridLeft) / m.step - 0.5), 0, m.cols - 1);
}

/** Rows of a day column, bottom→top: AM tokens, a separator gap, PM tokens, then a
 * relative session cap. Both token halves share the Y-axis (tokens) scale; the gap
 * appears only when both halves actually draw, so it reads as the AM/PM divider. */
export interface DayStack {
  amTokenRows: number;
  pmTokenRows: number;
  gapRows: number;
  sessionRows: number;
}

export function dayStack(opts: {
  amTokens: number;
  pmTokens: number;
  sessions: number;
  yMax: number;
  maxSessions: number;
  rows: number;
}): DayStack {
  const { amTokens, pmTokens, sessions, yMax, maxSessions, rows } = opts;
  const toRows = (t: number, cap: number) =>
    yMax > 0 ? clamp(Math.round((t / yMax) * rows), 0, cap) : 0;
  // Provisional (gap-free) heights decide whether a divider is even needed.
  const am0 = toRows(amTokens, rows);
  const pm0 = toRows(pmTokens, rows - am0);
  const gapRows = am0 > 0 && pm0 > 0 ? 1 : 0;
  const amTokenRows = clamp(am0, 0, Math.max(0, rows - gapRows));
  const pmTokenRows = clamp(pm0, 0, Math.max(0, rows - gapRows - amTokenRows));
  const used = amTokenRows + gapRows + pmTokenRows;
  const sessionFrac = maxSessions > 0 ? sessions / maxSessions : 0;
  const sessionRows = clamp(
    Math.round(sessionFrac * rows * SESSION_BAND),
    0,
    Math.max(0, rows - used),
  );
  return { amTokenRows, pmTokenRows, gapRows, sessionRows };
}

/** Total filled height of a day stack (top of the orange cap, gap included). */
export function stackHeight(s: DayStack): number {
  return s.amTokenRows + s.gapRows + s.pmTokenRows + s.sessionRows;
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
  if (filledRows <= 0 || m.vStep <= 0) return null;
  return m.gridTop + m.gridHeight - filledRows * m.vStep + m.vStep / 2;
}
