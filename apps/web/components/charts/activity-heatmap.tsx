"use client";

import { formatInt, formatTokens } from "@/lib/format";
import { dayTokens, dotScale, parseDay } from "@/lib/heatmap";
import type { DailyRow } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GAP = 3;
const FALLBACK_ROWS = 18;

/**
 * Booking-sources-style dot matrix that fills its tile: one column per day over a
 * light square grid, filled bottom-up with two stacked series — tokens (sky) then
 * sessions (orange). Square size and row count are derived from the measured plot
 * box so the grid spans the whole panel; the per-square quantum is in the legend.
 */
export function ActivityHeatmap({ data }: { data: DailyRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, data.length);
  // Square sized to fill the measured width; rows to fill the measured height.
  const square = box.w > 0 ? Math.max(4, Math.floor((box.w - (cols - 1) * GAP) / cols)) : 12;
  const rows =
    box.h > 0 ? Math.max(6, Math.floor((box.h + GAP) / (square + GAP))) : FALLBACK_ROWS;
  const { columns, sessionsPerDot, tokensPerDot } = dotScale(data, Math.max(1, Math.ceil(rows / 2)));

  const totalSessions = data.reduce((a, d) => a + d.sessions, 0);
  const totalTokens = data.reduce((a, d) => a + dayTokens(d), 0);

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
            <span className="size-2 rounded-full bg-sky-500" aria-hidden />
            <span className="font-medium text-foreground">Tokens</span>
            <span className="tabular-nums">{formatTokens(totalTokens)}</span>
          </span>
        </div>
      </div>

      <div className="min-h-[200px] flex-1">
        <div ref={ref} className="flex h-full items-end justify-between" style={{ gap: GAP }}>
          {columns.map((c, i) => {
            const r = data[i];
            if (!r) return null;
            const tok = Math.min(rows, c.tokenDots);
            const ses = Math.min(rows - tok, c.sessionDots);
            return (
              <div
                key={c.day}
                className="flex flex-col-reverse"
                style={{ gap: GAP }}
                title={`${c.day} · ${formatInt(r.sessions)} sessions · ${formatTokens(dayTokens(r))} tokens`}
              >
                {Array.from({ length: rows }).map((_, row) => {
                  const isToken = row < tok;
                  const isSession = !isToken && row < tok + ses;
                  return (
                    <span
                      key={row}
                      style={{ width: square, height: square }}
                      className={
                        "shrink-0 rounded-[2px] " +
                        (isToken ? "bg-sky-500" : isSession ? "bg-primary" : "bg-foreground/[0.07]")
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 space-y-2">
        <div className="flex justify-between" style={{ gap: GAP }}>
          {columns.map((c, i) => {
            const d = parseDay(c.day);
            const first =
              i === 0 || parseDay(columns[i - 1]?.day ?? c.day).getMonth() !== d.getMonth();
            return (
              <span
                key={c.day}
                style={{ width: square }}
                className="shrink-0 overflow-visible text-[10px] font-medium whitespace-nowrap text-muted-foreground"
              >
                {first ? MONTHS[d.getMonth()] : ""}
              </span>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Each square ≈ {formatInt(sessionsPerDot)} session{sessionsPerDot > 1 ? "s" : ""} (orange)
          or {formatTokens(tokensPerDot)} tokens (blue).
        </p>
      </div>
    </div>
  );
}
