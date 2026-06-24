"use client";

// Port of the dashboard18 availability calendar (status cells, spacing, legend),
// driven by our per-day activity intensity with a sessions/tokens metric toggle —
// plus an optional "commits" metric overlaid from the local-git data source.
import { Button } from "@/components/ui/button";
import { formatInt, formatTokens } from "@/lib/format";
import {
  dayMap,
  dayTokens,
  dayValue,
  HEAT_METRICS,
  intensity,
  isoDay,
  maxValue,
  monthCells,
  parseDay,
  type HeatMetric,
} from "@/lib/heatmap";
import type { CommitDailyRow, DailyRow, MeetingDay } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

/** The calendar's own metric union — the shared usage metrics plus commits/meetings. */
type CalMetric = HeatMetric | "commits" | "meetings";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVELS = 4;

const RAMP: Record<CalMetric, string[]> = {
  sessions: ["bg-primary/15", "bg-primary/35", "bg-primary/65", "bg-primary"],
  tokens: ["bg-sky-500/15", "bg-sky-500/35", "bg-sky-500/65", "bg-sky-500"],
  commits: ["bg-emerald-500/15", "bg-emerald-500/35", "bg-emerald-500/65", "bg-emerald-500"],
  meetings: ["bg-amber-500/15", "bg-amber-500/35", "bg-amber-500/65", "bg-amber-500"],
};

function cellClass(level: number, metric: CalMetric): string {
  if (level <= 0) return "border border-border/60 bg-background text-foreground/85";
  return cn(RAMP[metric][level - 1], level >= 3 ? "text-white" : "text-foreground");
}

export function CalendarHeatmap({
  data,
  commits,
  meetings,
}: {
  data: DailyRow[];
  commits?: CommitDailyRow[];
  meetings?: MeetingDay[];
}) {
  const [metric, setMetric] = useState<CalMetric>("sessions");
  // Commits / meetings are opt-in metrics; only offer each when its data is present.
  const metrics: CalMetric[] = [
    ...HEAT_METRICS,
    ...(commits ? (["commits"] as const) : []),
    ...(meetings ? (["meetings"] as const) : []),
  ];
  const commitMap = useMemo(
    () => new Map((commits ?? []).map((c) => [c.day, c.commits])),
    [commits],
  );
  const meetingMap = useMemo(
    () => new Map((meetings ?? []).map((m) => [m.day, m.minutes])),
    [meetings],
  );
  const lastRow = data.at(-1);
  const last = lastRow ? parseDay(lastRow.day) : new Date();
  const [view, setView] = useState({ year: last.getFullYear(), month: last.getMonth() });
  const [selected, setSelected] = useState<Date>(last);
  const [hovered, setHovered] = useState<Date | null>(null);

  const map = dayMap(data);
  const commitMax = (commits ?? []).reduce((m, c) => Math.max(m, c.commits), 0);
  const meetingMax = (meetings ?? []).reduce((m, c) => Math.max(m, c.minutes), 0);
  const max =
    metric === "commits"
      ? commitMax
      : metric === "meetings"
        ? meetingMax
        : maxValue(data, metric);
  const cells = monthCells(view.year, view.month);
  const today = new Date();
  const monthLabel = new Date(view.year, view.month).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const valueAt = (d: Date) => {
    const key = isoDay(d);
    if (metric === "commits") return commitMap.get(key) ?? 0;
    if (metric === "meetings") return meetingMap.get(key) ?? 0;
    const r = map.get(key);
    return r ? dayValue(r, metric) : 0;
  };

  const shift = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(d);
  };

  // The footer summary reflects the hovered day (so the count appears on hover),
  // falling back to the selected day. It always shows both metrics.
  const active = hovered ?? selected;
  const activeRow = map.get(isoDay(active));
  const activeSessions = activeRow?.sessions ?? 0;
  const activeTokens = activeRow ? dayTokens(activeRow) : 0;
  const activeCommits = commitMap.get(isoDay(active)) ?? 0;
  const activeMeetingMin = meetingMap.get(isoDay(active)) ?? 0;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-muted/35 px-2 py-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
            className="flex size-6 items-center justify-center rounded-md border border-border/80 bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="flex-1 text-center text-sm font-medium text-foreground/85">{monthLabel}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shift(1)}
            className="flex size-6 items-center justify-center rounded-md border border-border/80 bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
        <div className="flex gap-1" role="group" aria-label="Heatmap metric">
          {metrics.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={m === metric ? "default" : "outline"}
              aria-pressed={m === metric}
              onClick={() => setMetric(m)}
              className="capitalize"
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col pt-3">
        <div className="grid shrink-0 grid-cols-7 text-center text-[10px] font-medium tracking-[0.04em] text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
        </div>

        <div
          className="mt-2 grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-2"
          onMouseLeave={() => setHovered(null)}
        >
          {cells.map(({ date, inMonth }) => {
            const key = isoDay(date);
            const value = inMonth ? valueAt(date) : 0;
            const level = inMonth ? intensity(value, max, LEVELS) : 0;
            const isSelected = isoDay(selected) === key;
            const isToday = isoDay(today) === key;
            return (
              <button
                key={key}
                type="button"
                onMouseEnter={() => setHovered(date)}
                onFocus={() => setHovered(date)}
                onClick={() => {
                  if (date.getMonth() !== view.month)
                    setView({ year: date.getFullYear(), month: date.getMonth() });
                  setSelected(date);
                }}
                className={cn(
                  "relative flex min-h-0 items-center justify-center rounded-[10px] text-[11px] font-medium tabular-nums transition-colors",
                  inMonth ? cellClass(level, metric) : "bg-muted/20 text-muted-foreground/35",
                  isSelected && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
                  isToday && !isSelected && "ring-1 ring-primary/30",
                )}
              >
                <span>{date.getDate()}</span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 pt-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={cn("size-2.5 rounded-[4px]", cellClass(l, metric))} aria-hidden />
            ))}
            <span>More</span>
          </div>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground/80">
            <span className="font-medium text-foreground/85">
              {active.getDate()} {MONTHS3[active.getMonth()]}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              {formatInt(activeSessions)}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-sky-500" aria-hidden />
              {formatTokens(activeTokens)}
            </span>
            {commits ? (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                {formatInt(activeCommits)}
              </span>
            ) : null}
            {meetings ? (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                {formatInt(activeMeetingMin)}m
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
