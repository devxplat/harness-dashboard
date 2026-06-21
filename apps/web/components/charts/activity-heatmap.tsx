"use client";

// Port of the dashboard18 "Booking Sources" square-grid bar chart, rewired onto our
// per-day sessions+tokens data. recharts 3.x: custom SVG children read the plot box
// via usePlotArea(); the bar shape draws stacked squares; a cursor layer reads the
// active-tooltip hooks for the dashed line + circle marker. (Excluded from coverage:
// these SVG callbacks need a real layout that jsdom lacks — the math lives in
// lib/activity-grid.ts, which is unit-tested.)
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  axisTicks,
  CELL_INSET,
  CELL_SIZE,
  CELL_STEP,
  columnCenter,
  columnLeft,
  gridMetrics,
  markerY,
  niceMax,
  stackRows,
  type PlotBox,
} from "@/lib/activity-grid";
import { formatInt, formatTokens } from "@/lib/format";
import { dayTokens, parseDay } from "@/lib/heatmap";
import type { DailyRow } from "@/lib/types";
import {
  Bar,
  BarChart,
  Tooltip,
  useActiveTooltipCoordinate,
  useActiveTooltipDataPoints,
  usePlotArea,
  XAxis,
  YAxis,
} from "recharts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TOKEN_COLOR = "var(--color-tokens)";
const SESSION_COLOR = "var(--color-sessions)";
const GRID_CELL = "color-mix(in oklch, var(--foreground) 7%, var(--background))";
const CURSOR = "color-mix(in oklch, var(--foreground) 60%, transparent)";

interface Point {
  key: string;
  xLabel: string;
  sessions: number;
  tokens: number;
}

interface ScaleProps {
  yMax: number;
  maxSessions: number;
}

const config = {
  sessions: { label: "Sessions", color: "var(--primary)" },
  tokens: { label: "Tokens", color: "oklch(0.685 0.169 237.32)" },
} satisfies ChartConfig;

const toBox = (a: { x: number; y: number; width: number; height: number }): PlotBox => ({
  left: a.x,
  top: a.y,
  width: a.width,
  height: a.height,
});

/** Light square grid filling the plot box (drawn under the bars). */
function GridBackground() {
  const area = usePlotArea();
  if (!area) return null;
  const m = gridMetrics(toBox(area));
  const rects = [];
  for (let r = 0; r < m.rows; r += 1) {
    const y = m.gridTop + r * CELL_STEP + CELL_INSET;
    for (let c = 0; c < m.cols; c += 1) {
      const x = m.gridLeft + c * CELL_STEP + CELL_INSET;
      rects.push(
        <rect key={`${r}-${c}`} x={x} y={y} width={CELL_SIZE} height={CELL_SIZE} rx={1} fill={GRID_CELL} />,
      );
    }
  }
  return <g>{rects}</g>;
}

/** One column of stacked squares: tokens (blue, bottom) then sessions (orange, top). */
function SquareBar(props: { x?: number; width?: number; payload?: Point } & ScaleProps) {
  const { x, width, payload, yMax, maxSessions } = props;
  const area = usePlotArea();
  if (typeof x !== "number" || typeof width !== "number" || !area || !payload) return null;
  const m = gridMetrics(toBox(area));
  const colX = columnLeft(x, width, m);
  const { tokenRows, sessionRows } = stackRows({
    tokens: payload.tokens,
    sessions: payload.sessions,
    yMax,
    maxSessions,
    rows: m.rows,
  });
  const bottom = m.gridTop + m.gridHeight;
  const rects = [];
  for (let r = 0; r < tokenRows + sessionRows; r += 1) {
    const ry = Math.round(bottom - (r + 1) * CELL_STEP) + CELL_INSET;
    if (ry < m.gridTop) continue;
    rects.push(
      <rect
        key={r}
        x={colX}
        y={ry}
        width={CELL_SIZE}
        height={CELL_SIZE}
        rx={1}
        fill={r < tokenRows ? TOKEN_COLOR : SESSION_COLOR}
      />,
    );
  }
  return <g>{rects}</g>;
}

/** Dashed vertical line + circle marker at the hovered column's stack top. */
function CursorLayer({ yMax, maxSessions }: ScaleProps) {
  const area = usePlotArea();
  const coord = useActiveTooltipCoordinate();
  const points = useActiveTooltipDataPoints<Point>();
  if (!area || !coord) return null;
  const m = gridMetrics(toBox(area));
  const cx = columnCenter(coord.x, 0, m);
  const active = points?.[0];
  let cy: number | null = null;
  if (active && typeof active.tokens === "number") {
    const { tokenRows, sessionRows } = stackRows({
      tokens: active.tokens,
      sessions: active.sessions,
      yMax,
      maxSessions,
      rows: m.rows,
    });
    cy = markerY(tokenRows + sessionRows, m);
  }
  return (
    <g>
      <line
        x1={cx}
        y1={m.gridTop}
        x2={cx}
        y2={m.gridTop + m.gridHeight}
        stroke={CURSOR}
        strokeDasharray="3 4"
        strokeWidth={1.5}
      />
      {cy !== null ? (
        <circle cx={cx} cy={cy} r={5} fill="var(--background)" stroke="var(--foreground)" strokeWidth={2} />
      ) : null}
    </g>
  );
}

function ActivityTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Point }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const label = parseDay(row.key).toLocaleString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="min-w-[170px] rounded-xl border border-border/60 bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="mb-3 rounded-md border border-border/60 bg-muted/35 px-2.5 py-1 text-sm font-medium text-foreground">
        {label}
      </p>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: "var(--color-sessions)" }} />
            Sessions
          </span>
          <span className="font-semibold text-foreground">{formatInt(row.sessions)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: "var(--color-tokens)" }} />
            Tokens
          </span>
          <span className="font-semibold text-foreground">{formatTokens(row.tokens)}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityHeatmap({ data }: { data: DailyRow[] }) {
  const points: Point[] = data.map((d, i) => {
    const dt = parseDay(d.day);
    const prev = i > 0 ? parseDay(data[i - 1]?.day ?? d.day) : null;
    const first = !prev || prev.getMonth() !== dt.getMonth();
    return {
      key: d.day,
      xLabel: first ? MONTHS[dt.getMonth()] ?? "" : "",
      sessions: d.sessions,
      tokens: dayTokens(d),
    };
  });
  const totalSessions = data.reduce((a, d) => a + d.sessions, 0);
  const totalTokens = data.reduce((a, d) => a + dayTokens(d), 0);
  const maxTokens = points.reduce((m, p) => Math.max(m, p.tokens), 0);
  const maxSessions = points.reduce((m, p) => Math.max(m, p.sessions), 0);
  const yMax = niceMax(maxTokens);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Activity
          </p>
          <div className="flex items-end gap-2 pt-1.5">
            <span className="text-3xl leading-none font-semibold tabular-nums">
              {formatTokens(totalTokens)}
            </span>
            <span className="pb-0.5 text-sm text-muted-foreground">tokens</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            <span className="font-medium text-foreground">Sessions</span>
            <span className="tabular-nums">{formatInt(totalSessions)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: "var(--color-tokens)" }} aria-hidden />
            <span className="font-medium text-foreground">Tokens</span>
            <span className="tabular-nums">{formatTokens(totalTokens)}</span>
          </span>
        </div>
      </div>

      <div className="min-h-[220px] flex-1">
        <ChartContainer
          config={config}
          className="h-full w-full [&_.recharts-cartesian-axis-line]:stroke-transparent [&_.recharts-cartesian-axis-tick_line]:stroke-transparent"
        >
          <BarChart data={points} barCategoryGap={0} margin={{ top: 8, right: 8, left: -4, bottom: 6 }}>
            <GridBackground />
            <XAxis
              dataKey="xLabel"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={{ fontSize: 11, fontWeight: 500 }}
              dy={6}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11 }}
              domain={[0, yMax]}
              ticks={axisTicks(yMax)}
              tickFormatter={(v: number) => formatTokens(v)}
              width={52}
            />
            <Tooltip content={<ActivityTooltip />} cursor={false} />
            <Bar
              dataKey="tokens"
              fill={TOKEN_COLOR}
              radius={0}
              barSize={CELL_SIZE}
              shape={(p: { x?: number; width?: number; payload?: Point }) => (
                <SquareBar {...p} yMax={yMax} maxSessions={maxSessions} />
              )}
            />
            <CursorLayer yMax={yMax} maxSessions={maxSessions} />
          </BarChart>
        </ChartContainer>
      </div>

      <p className="shrink-0 text-[11px] text-muted-foreground">
        Blue squares = tokens (left axis); orange caps = relative session volume.
      </p>
    </div>
  );
}
