"use client";

import { formatInt, formatTokens } from "@/lib/format";
import { dayTokens, dotScale, parseDay } from "@/lib/heatmap";
import type { DailyRow } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Per-series dot target; the two stacks combine to ~2x this at the busiest day.
const TARGET = 8;

/**
 * Booking-sources-style dot matrix: one column per day over a light square grid,
 * filled bottom-up with two stacked series — tokens (sky) then sessions (orange).
 * Each square is a quantum (stated in the legend) so the two very different scales
 * stay legible in one chart.
 */
export function ActivityHeatmap({ data }: { data: DailyRow[] }) {
  const { columns, sessionsPerDot, tokensPerDot } = dotScale(data, TARGET);
  const rows = Math.max(1, ...columns.map((c) => c.sessionDots + c.tokenDots));

  const totalSessions = data.reduce((a, d) => a + d.sessions, 0);
  const totalTokens = data.reduce((a, d) => a + dayTokens(d), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
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
            <span className="size-2 rounded-full bg-sky-500" aria-hidden />
            <span className="font-medium text-foreground">Tokens</span>
            <span className="tabular-nums">{formatTokens(totalTokens)}</span>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex items-end gap-[3px]">
          {columns.map((c, i) => {
            const r = data[i];
            if (!r) return null;
            return (
              <div
                key={c.day}
                className="flex flex-col-reverse gap-[2px]"
                title={`${c.day} · ${formatInt(r.sessions)} sessions · ${formatTokens(dayTokens(r))} tokens`}
              >
                {Array.from({ length: rows }).map((_, row) => {
                  const filledTokens = row < c.tokenDots;
                  const filledSessions = !filledTokens && row < c.tokenDots + c.sessionDots;
                  return (
                    <span
                      key={row}
                      className={
                        "size-[7px] shrink-0 rounded-[2px] " +
                        (filledTokens
                          ? "bg-sky-500"
                          : filledSessions
                            ? "bg-primary"
                            : "bg-foreground/[0.07]")
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-[3px]">
          {columns.map((c, i) => {
            const d = parseDay(c.day);
            const first = i === 0 || parseDay(columns[i - 1]?.day ?? c.day).getMonth() !== d.getMonth();
            return (
              <span
                key={c.day}
                className="w-[7px] shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground"
              >
                {first ? MONTHS[d.getMonth()] : ""}
              </span>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each square ≈ {formatInt(sessionsPerDot)} session{sessionsPerDot > 1 ? "s" : ""} (orange) or{" "}
        {formatTokens(tokensPerDot)} tokens (blue).
      </p>
    </div>
  );
}
