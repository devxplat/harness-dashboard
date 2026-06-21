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
  cellX,
  cellY,
  columnIndexAt,
  gridMetrics,
  markerY,
  niceMax,
  stackRows,
  type GridMetrics,
  type PlotBox,
} from "@/lib/activity-grid";
import { formatInt, formatTokens } from "@/lib/format";
import { dayTokens, parseDay } from "@/lib/heatmap";
import type { ActivityBucket, DailyRow } from "@/lib/types";
import { Bar, BarChart, Tooltip, useActiveTooltipCoordinate, usePlotArea, XAxis, YAxis } from "recharts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TOKEN_COLOR = "var(--color-tokens)";
const SESSION_COLOR = "var(--color-sessions)";
const GRID_CELL = "color-mix(in oklch, var(--foreground) 7%, var(--background))";
const CURSOR = "color-mix(in oklch, var(--foreground) 60%, transparent)";

interface Point {
  key: string;
  sessions: number;
  tokens: number;
}

/** Date part of a column key ("2026-06-20" or "2026-06-20 AM"). */
const keyDate = (key: string) => parseDay(key.slice(0, 10));
const keyHalf = (key: string) => (key.length > 10 ? key.slice(11) : "");

function bucketLabel(key: string): string {
  const d = keyDate(key);
  const half = keyHalf(key);
  return `${MONTHS[d.getMonth()] ?? ""} ${d.getDate()}${half ? ` ${half}` : ""}`;
}

interface ScaleProps {
  yMax: number;
  maxSessions: number;
  cols: number;
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

/** Light square grid filling the plot box (one column per day, drawn under bars). */
function GridBackground({ cols }: { cols: number }) {
  const area = usePlotArea();
  if (!area) return null;
  const m = gridMetrics(toBox(area), cols);
  const rects = [];
  for (let r = 0; r < m.rows; r += 1) {
    for (let c = 0; c < m.cols; c += 1) {
      rects.push(
        <rect
          key={`${r}-${c}`}
          x={cellX(c, m)}
          y={cellY(r, m)}
          width={m.square}
          height={m.square}
          rx={1}
          fill={GRID_CELL}
        />,
      );
    }
  }
  return <g>{rects}</g>;
}

/** One day-column of stacked squares: tokens (blue, bottom) then sessions (orange, top). */
function SquareBar(props: { x?: number; width?: number; payload?: Point } & ScaleProps) {
  const { x, width, payload, yMax, maxSessions, cols } = props;
  const area = usePlotArea();
  if (typeof x !== "number" || typeof width !== "number" || !area || !payload) return null;
  const m = gridMetrics(toBox(area), cols);
  const col = columnIndexAt(x + width / 2, m);
  const { tokenRows, sessionRows } = stackRows({
    tokens: payload.tokens,
    sessions: payload.sessions,
    yMax,
    maxSessions,
    rows: m.rows,
  });
  const rects = [];
  for (let r = 0; r < tokenRows + sessionRows; r += 1) {
    rects.push(
      <rect
        key={r}
        x={cellX(col, m)}
        y={cellY(r, m)}
        width={m.square}
        height={m.square}
        rx={1}
        fill={r < tokenRows ? TOKEN_COLOR : SESSION_COLOR}
      />,
    );
  }
  return <g>{rects}</g>;
}

/**
 * Dashed vertical line + white circle marker at the hovered day's stack top.
 * Rendered as a sibling AFTER <Bar> so it sits ON TOP of the squares (the Tooltip
 * `cursor` slot draws behind the data). Reads the active-tooltip hooks, which share
 * the tooltip's active state, so the line/marker stay in sync with the card.
 */
function CursorLayer({
  yMax,
  maxSessions,
  points,
}: {
  yMax: number;
  maxSessions: number;
  points: Point[];
}) {
  const area = usePlotArea();
  const coordinate = useActiveTooltipCoordinate();
  if (!area || !coordinate) return null;
  const m: GridMetrics = gridMetrics(toBox(area), points.length);
  const cx = coordinate.x; // active category center = day-column center
  // Derive the active column from the cursor x (robust: don't depend on a second
  // hook that can lag/return empty, which would render the line but no marker).
  const active = points[columnIndexAt(cx, m)];
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
  const label = bucketLabel(row.key);
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

export function ActivityHeatmap({
  data,
  granular,
}: {
  data: DailyRow[];
  granular?: ActivityBucket[];
}) {
  // Dense per-half-day buckets give enough columns for small contiguous squares
  // like the template; fall back to per-day if no granular data is available.
  const dailyPoints: Point[] = data.map((d) => ({
    key: d.day,
    sessions: d.sessions,
    tokens: dayTokens(d),
  }));
  const densePoints: Point[] = (granular ?? []).map((b) => ({
    key: b.key,
    sessions: b.sessions,
    tokens: b.input_tokens + b.output_tokens + b.cache_create_tokens,
  }));
  const points = densePoints.length ? densePoints : dailyPoints;

  const totalSessions = data.reduce((a, d) => a + d.sessions, 0);
  const totalTokens = data.reduce((a, d) => a + dayTokens(d), 0);
  const maxTokens = points.reduce((m, p) => Math.max(m, p.tokens), 0);
  const maxSessions = points.reduce((m, p) => Math.max(m, p.sessions), 0);
  const yMax = niceMax(maxTokens);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Activity
          </p>
          <div className="flex flex-wrap items-end gap-3 pt-1.5">
            <span className="text-4xl leading-none font-semibold text-foreground tabular-nums">
              {formatTokens(totalTokens)}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">tokens</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground lg:justify-end">
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

      <div className="h-[150px] w-full sm:h-[170px]">
        <ChartContainer
          config={config}
          className="h-full w-full [&_.recharts-cartesian-axis-line]:stroke-transparent [&_.recharts-cartesian-axis-tick_line]:stroke-transparent"
        >
          <BarChart data={points} barCategoryGap={0} margin={{ top: 8, right: 8, left: -4, bottom: 6 }}>
            <GridBackground cols={points.length} />
            <XAxis
              dataKey="key"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={{ fontSize: 11, fontWeight: 500 }}
              dy={6}
              tickFormatter={(value: string, index: number) => {
                const d = keyDate(value);
                // One label per month — for half-day keys only on the AM bucket.
                const showable = keyHalf(value) === "" || keyHalf(value) === "AM";
                return index === 0 || (d.getDate() === 1 && showable) ? MONTHS[d.getMonth()] ?? "" : "";
              }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11 }}
              domain={[0, yMax]}
              ticks={axisTicks(yMax)}
              tickFormatter={(v: number) => formatTokens(v)}
              width={40}
            />
            <Tooltip content={<ActivityTooltip />} cursor={false} />
            <Bar
              dataKey="tokens"
              fill={TOKEN_COLOR}
              radius={0}
              shape={(p: { x?: number; width?: number; payload?: Point }) => (
                <SquareBar {...p} yMax={yMax} maxSessions={maxSessions} cols={points.length} />
              )}
            />
            <CursorLayer yMax={yMax} maxSessions={maxSessions} points={points} />
          </BarChart>
        </ChartContainer>
      </div>

      <p className="shrink-0 text-[11px] text-muted-foreground">
        Blue squares = tokens (left axis); orange caps = relative session volume.
      </p>
    </div>
  );
}
