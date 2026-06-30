"use client";

import { StatsCard1 } from "@/components/stats-card1";
import { StatsCard2 } from "@/components/stats-card2";
import { formatInt, formatTokens, formatUSD } from "@/lib/format";
import type { DailyRow, Totals } from "@/lib/types";
import { TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

/** Period-over-period change as a fraction, or null when there's no comparable prior value. */
function delta(curr: number, prev: number | null | undefined): number | null {
  return prev != null && prev > 0 ? (curr - prev) / prev : null;
}

/** Period-over-period change as a rounded percent (1 decimal), or null. */
function pctChange(curr: number, prev: number | null | undefined): number | null {
  const d = delta(curr, prev);
  return d != null ? Math.round(d * 1000) / 10 : null;
}

// Shared card chrome: fills the grid cell, lifts and fades into a colored gradient on
// hover, and is clickable (wrapped in a Link) to drill into the matching screen.
const CARD =
  "h-full max-w-none cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:bg-gradient-to-br hover:to-transparent";

/** Left-column secondary stat — label (subtitle) + value + optional trend, the prior pattern. */
function LeftStat({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-medium tabular-nums text-foreground">{value}</p>
      {change != null ? (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {change >= 0 ? (
            <TrendingUp className="size-3" aria-hidden />
          ) : (
            <TrendingDown className="size-3" aria-hidden />
          )}
          <span className="tabular-nums">
            {change >= 0 ? "+" : ""}
            {change}%
          </span>
          <span>{t("common.vsPrev")}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Header panel: an eyebrow + title and the secondary (turns/cache) stats on the left,
 * and the four headline metrics as stat cards on the right. Tokens/sessions use a
 * sparkline card (StatsCard2) with a trend; cost uses a trend card (StatsCard1).
 */
export function OverviewStats({
  totals: t,
  prev: p,
  rangeLabel,
  daily = [],
}: {
  totals: Totals;
  prev: Totals | null;
  rangeLabel: string;
  daily?: DailyRow[];
}) {
  const { t: tr } = useTranslation();
  const cache = t.cache_read_tokens + t.cache_create_5m_tokens + t.cache_create_1h_tokens;
  const prevCache = p
    ? p.cache_read_tokens + p.cache_create_5m_tokens + p.cache_create_1h_tokens
    : null;

  const sessionsSeries = daily.map((d) => ({ value: d.sessions }));
  const inputSeries = daily.map((d) => ({ value: d.input_tokens }));
  const outputSeries = daily.map((d) => ({ value: d.output_tokens }));

  const costChange = t.cost_usd != null ? pctChange(t.cost_usd, p?.cost_usd) : null;

  return (
    <section className="rounded-xl border bg-card px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-stretch xl:justify-between xl:gap-8">
        <div className="min-w-0 xl:w-[230px] xl:shrink-0">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {rangeLabel}
          </p>
          <h2 className="pt-2 text-[26px] leading-none font-medium tracking-tight text-foreground">
            {tr("overview.title")}
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-5">
            <LeftStat
              label={tr("overview.turns")}
              value={formatInt(t.turns)}
              change={pctChange(t.turns, p?.turns)}
            />
            <LeftStat
              label={tr("overview.cache")}
              value={formatTokens(cache)}
              change={pctChange(cache, prevCache)}
            />
          </div>
        </div>

        <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/sessions" aria-label={tr("overview.aria.browseSessions")} className="block h-full">
            <StatsCard2
              title={tr("overview.cards.sessions")}
              value={formatInt(t.sessions)}
              data={sessionsSeries}
              color="var(--chart-1)"
              change={pctChange(t.sessions, p?.sessions)}
              changeLabel={tr("common.vsPrev")}
              className={`${CARD} hover:border-sky-500/40 hover:from-sky-500/10`}
            />
          </Link>

          <Link href="/projects" aria-label={tr("overview.aria.inputByProject")} className="block h-full">
            <StatsCard2
              title={tr("overview.cards.input")}
              value={formatTokens(t.input_tokens)}
              data={inputSeries}
              color="var(--chart-2)"
              change={pctChange(t.input_tokens, p?.input_tokens)}
              changeLabel={tr("common.vsPrev")}
              className={`${CARD} hover:border-cyan-500/40 hover:from-cyan-500/10`}
            />
          </Link>

          <Link href="/projects" aria-label={tr("overview.aria.outputByProject")} className="block h-full">
            <StatsCard2
              title={tr("overview.cards.output")}
              value={formatTokens(t.output_tokens)}
              data={outputSeries}
              color="var(--chart-4)"
              change={pctChange(t.output_tokens, p?.output_tokens)}
              changeLabel={tr("common.vsPrev")}
              className={`${CARD} hover:border-violet-500/40 hover:from-violet-500/10`}
            />
          </Link>

          <Link href="/prompts" aria-label={tr("overview.aria.expensivePrompts")} className="block h-full">
            <StatsCard1
              title={tr("overview.cards.cost")}
              value={formatUSD(t.cost_usd)}
              change={costChange}
              changeLabel={tr("common.vsPrev")}
              className={`${CARD} hover:border-emerald-500/40 hover:from-emerald-500/10`}
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
