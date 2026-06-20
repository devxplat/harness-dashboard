"use client";

import { Button } from "@/components/ui/button";
import { formatInt, formatTokens } from "@/lib/format";
import {
  dayMap,
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
const LEVELS = 4;

const RAMP: Record<HeatMetric, string[]> = {
  sessions: ["bg-primary/15", "bg-primary/35", "bg-primary/65", "bg-primary"],
  tokens: ["bg-sky-500/15", "bg-sky-500/35", "bg-sky-500/65", "bg-sky-500"],
};

function cellClass(level: number, metric: HeatMetric): string {
  if (level === 0) return "border border-border/60 bg-background text-foreground/80";
  return cn(RAMP[metric][level - 1], level >= 3 ? "text-white" : "text-foreground");
}

export function CalendarHeatmap({ data }: { data: DailyRow[] }) {
  const [metric, setMetric] = useState<HeatMetric>("sessions");
  const lastRow = data.at(-1);
  const last = lastRow ? parseDay(lastRow.day) : new Date();
  const [view, setView] = useState({ year: last.getFullYear(), month: last.getMonth() });

  const map = dayMap(data);
  const max = maxValue(data, metric);
  const cells = monthCells(view.year, view.month);
  const monthLabel = new Date(view.year, view.month).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const shift = (delta: number) => {
    const d = new Date(view.year, view.month + delta);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-muted/40 px-2 py-1.5">
          <Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="flex-1 text-center text-sm font-medium">{monthLabel}</span>
          <Button size="icon-sm" variant="outline" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight className="size-3.5" />
          </Button>
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

      <div className="grid grid-cols-7 text-center text-[0.7rem] font-medium tracking-wide text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map(({ date, inMonth }) => {
          const key = isoDay(date);
          const r = map.get(key);
          const value = r ? dayValue(r, metric) : 0;
          const level = inMonth ? intensity(value, max, LEVELS) : 0;
          const label =
            metric === "sessions" ? `${formatInt(value)} sessions` : `${formatTokens(value)} tokens`;
          return (
            <div
              key={key}
              title={`${key} · ${label}`}
              className={cn(
                "flex aspect-square items-center justify-center rounded-[10px] text-[11px] font-medium tabular-nums transition-colors",
                inMonth ? cellClass(level, metric) : "bg-muted/20 text-muted-foreground/35",
              )}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-1.5 pt-1 text-[0.7rem] text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={cn("size-3 rounded-sm", cellClass(l, metric))} aria-hidden />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
