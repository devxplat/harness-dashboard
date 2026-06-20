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
  monthGrid,
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
  sessions: ["bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"],
  tokens: ["bg-sky-500/25", "bg-sky-500/45", "bg-sky-500/70", "bg-sky-500"],
};

function cellClass(level: number, metric: HeatMetric): string {
  if (level === 0) return "bg-muted/40 text-muted-foreground/70";
  return cn(RAMP[metric][level - 1], level >= 3 ? "text-white" : "text-foreground");
}

export function CalendarHeatmap({ data }: { data: DailyRow[] }) {
  const [metric, setMetric] = useState<HeatMetric>("sessions");
  const lastRow = data.at(-1);
  const last = lastRow ? parseDay(lastRow.day) : new Date();
  const [view, setView] = useState({ year: last.getFullYear(), month: last.getMonth() });

  const map = dayMap(data);
  const max = maxValue(data, metric);
  const weeks = monthGrid(view.year, view.month);
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
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight className="size-4" />
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

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[0.7rem] font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {weeks.flat().map((date, i) => {
          if (!date) return <div key={`pad-${i}`} aria-hidden />;
          const key = isoDay(date);
          const r = map.get(key);
          const value = r ? dayValue(r, metric) : 0;
          const level = intensity(value, max, LEVELS);
          const label =
            metric === "sessions"
              ? `${formatInt(value)} sessions`
              : `${formatTokens(value)} tokens`;
          return (
            <div
              key={key}
              title={`${key} · ${label}`}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                cellClass(level, metric),
              )}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[0.7rem] text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={cn("size-3 rounded-sm", cellClass(l, metric))} aria-hidden />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
