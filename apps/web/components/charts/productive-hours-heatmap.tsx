"use client";

// Productive-hours matrix: local weekday (rows) × hour-of-day (columns), shaded by
// activity intensity, with a commits / messages / both metric toggle. A CSS grid of
// cells (like the calendar heatmap, not a recharts chart), so the geometry in
// lib/productivity-grid.ts is unit-tested and this renders as a smoke test.
import { Button } from "@/components/ui/button";
import { formatInt } from "@/lib/format";
import {
  buildMatrix,
  hourLabel,
  hourTotals,
  intensity,
  matrixMax,
  peakBucket,
  PRODUCTIVITY_METRICS,
  type ProductivityMetric,
} from "@/lib/productivity-grid";
import type { ProductiveHourRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const LEVELS = 4;
const RAMP = ["bg-primary/15", "bg-primary/40", "bg-primary/70", "bg-primary"];

function cellClass(level: number): string {
  if (level <= 0) return "bg-muted/30";
  return RAMP[level - 1] ?? "bg-primary";
}

export function ProductiveHoursHeatmap({ data }: { data: ProductiveHourRow[] }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<ProductivityMetric>("both");
  const grid = buildMatrix(data, metric);
  const max = matrixMax(grid);
  const peak = peakBucket(grid);
  const totals = hourTotals(data);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const dayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, day) =>
        new Date(2024, 0, 7 + day).toLocaleDateString(locale, { weekday: "short" }),
      ),
    [locale],
  );
  // label: "auto" 2.6rem track + 24 equal hour columns.
  const cols = { gridTemplateColumns: "2.6rem repeat(24, minmax(0, 1fr))" };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("components.charts.productiveHours")}
          </p>
          <p className="pt-1 text-sm text-muted-foreground">
            {t("components.charts.productiveHoursSummary", {
              commits: formatInt(totals.commits),
              messages: formatInt(totals.messages),
            })}
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label={t("components.charts.productivityMetric")}>
          {PRODUCTIVITY_METRICS.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={m === metric ? "default" : "outline"}
              aria-pressed={m === metric}
              onClick={() => setMetric(m)}
              className="capitalize"
            >
              {t(`enums.heatMetric.${m}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-1" style={cols}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[9px] text-muted-foreground tabular-nums">
            {h % 6 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
        {dayLabels.map((label, dow) => (
          <div key={label} className="contents">
            <div className="self-center pr-1 text-[10px] font-medium text-muted-foreground">
              {label}
            </div>
            {(grid[dow] ?? []).map((value, hour) => (
              <div
                key={hour}
                title={`${label} ${hourLabel(hour)} · ${formatInt(value)}`}
                className={cn("h-4 rounded-[3px]", cellClass(intensity(value, max, LEVELS)))}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>{t("common.less")}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={cn("size-2.5 rounded-[3px]", cellClass(l))} aria-hidden />
          ))}
          <span>{t("common.more")}</span>
        </div>
        <span className="ml-auto">
          {peak
            ? t("components.charts.peak", {
                day: dayLabels[peak.dow],
                hour: hourLabel(peak.hour),
                value: formatInt(peak.value),
              })
            : t("components.charts.noActivity")}
        </span>
      </div>
    </div>
  );
}
