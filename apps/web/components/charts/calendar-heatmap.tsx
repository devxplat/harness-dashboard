"use client";

// Port of the dashboard18 availability calendar (status cells, spacing, legend),
// driven by our per-day activity intensity with a sessions/tokens metric toggle.
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
import type { DailyRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVELS = 4;

const RAMP: Record<HeatMetric, string[]> = {
  sessions: ["bg-primary/15", "bg-primary/35", "bg-primary/65", "bg-primary"],
  tokens: ["bg-sky-500/15", "bg-sky-500/35", "bg-sky-500/65", "bg-sky-500"],
};

function cellClass(level: number, metric: HeatMetric): string {
  if (level <= 0) return "border border-border/60 bg-background text-foreground/85";
  return cn(RAMP[metric][level - 1], level >= 3 ? "text-white" : "text-foreground");
}

export function CalendarHeatmap({ data }: { data: DailyRow[] }) {
  const [metric, setMetric] = useState<HeatMetric>("sessions");
  const lastRow = data.at(-1);
  const last = lastRow ? parseDay(lastRow.day) : new Date();
  const [view, setView] = useState({ year: last.getFullYear(), month: last.getMonth() });
  const [selected, setSelected] = useState<Date>(last);
  const [hovered, setHovered] = useState<Date | null>(null);

  const map = dayMap(data);
  const max = maxValue(data, metric);
  const cells = monthCells(view.year, view.month);
  const today = new Date();
  const monthLabel = new Date(view.year, view.month).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const valueAt = (d: Date) => {
    const r = map.get(isoDay(d));
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

  return (
    <div className="mx-auto flex h-full w-full max-w-[240px] flex-col">
      <div className="flex items-center gap-2">
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
          {HEAT_METRICS.map((m) => (
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

      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col pt-4">
        <div className="space-y-3">
          <div className="grid grid-cols-7 text-center text-[10px] font-medium tracking-[0.04em] text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5" onMouseLeave={() => setHovered(null)}>
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
                    "relative flex aspect-square items-center justify-center rounded-[10px] text-[11px] font-medium tabular-nums transition-colors",
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
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-6 text-[11px] text-muted-foreground">
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
          </span>
        </div>
      </div>
    </div>
  );
}
