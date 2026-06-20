"use client";

import { formatInt, formatTokens } from "@/lib/format";
import { dayTokens, dotScale } from "@/lib/heatmap";
import type { DailyRow } from "@/lib/types";

/**
 * Booking-sources-style dot density: one column per day, two stacked colored
 * series (tokens at the base, sessions above). Each dot is a quantum so both
 * scales stay legible; the legend states the per-dot value.
 */
export function ActivityHeatmap({ data }: { data: DailyRow[] }) {
  const { columns, sessionsPerDot, tokensPerDot } = dotScale(data);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden />1 dot ={" "}
          {formatInt(sessionsPerDot)} session{sessionsPerDot > 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-sky-500" aria-hidden />1 dot ={" "}
          {formatTokens(tokensPerDot)} tokens
        </span>
      </div>

      <div className="flex h-48 items-end gap-[3px] overflow-x-auto overflow-y-hidden pb-1">
        {columns.map((c, i) => {
          const r = data[i];
          if (!r) return null;
          return (
            <div
              key={c.day}
              className="flex flex-col-reverse items-center gap-[2px]"
              title={`${c.day} · ${formatInt(r.sessions)} sessions · ${formatTokens(dayTokens(r))} tokens`}
            >
              {Array.from({ length: c.tokenDots }).map((_, d) => (
                <span key={`t${d}`} className="size-[5px] shrink-0 rounded-full bg-sky-500" />
              ))}
              {Array.from({ length: c.sessionDots }).map((_, d) => (
                <span key={`s${d}`} className="size-[5px] shrink-0 rounded-full bg-primary" />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
