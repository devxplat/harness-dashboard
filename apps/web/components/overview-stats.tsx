"use client";

import { formatInt, formatPct, formatTokens, formatUSD } from "@/lib/format";
import type { Totals } from "@/lib/types";
import {
  ArrowUpRight,
  FolderGit2,
  History,
  MessagesSquare,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import Link from "next/link";

/** Period-over-period change as a fraction, or null when there's no comparable prior value. */
function delta(curr: number, prev: number | null | undefined): number | null {
  return prev != null && prev > 0 ? (curr - prev) / prev : null;
}

const ACTIONS = [
  { title: "Expensive prompts", icon: MessagesSquare, href: "/prompts" },
  { title: "Browse sessions", icon: History, href: "/sessions" },
  { title: "Tool usage", icon: Wrench, href: "/tools" },
  { title: "By project", icon: FolderGit2, href: "/projects" },
];

/**
 * Shift-Board-style header panel (after dashboard18): an eyebrow + title and a
 * 2-col stat grid on the left, with quick-action tiles filling the right.
 */
export function OverviewStats({
  totals: t,
  prev: p,
  rangeLabel,
}: {
  totals: Totals;
  prev: Totals | null;
  rangeLabel: string;
}) {
  const cacheWrite = t.cache_create_5m_tokens + t.cache_create_1h_tokens;
  const prevCache = p ? p.cache_read_tokens + p.cache_create_5m_tokens + p.cache_create_1h_tokens : null;
  const cache = t.cache_read_tokens + cacheWrite;

  const items: { label: string; value: string; d: number | null }[] = [
    { label: "Sessions", value: formatInt(t.sessions), d: delta(t.sessions, p?.sessions) },
    { label: "Turns", value: formatInt(t.turns), d: delta(t.turns, p?.turns) },
    { label: "Input", value: formatTokens(t.input_tokens), d: delta(t.input_tokens, p?.input_tokens) },
    { label: "Output", value: formatTokens(t.output_tokens), d: delta(t.output_tokens, p?.output_tokens) },
    { label: "Cache", value: formatTokens(cache), d: delta(cache, prevCache) },
    {
      label: "Est. cost",
      value: formatUSD(t.cost_usd),
      d: t.cost_usd != null ? delta(t.cost_usd, p?.cost_usd) : null,
    },
  ];

  return (
    <section className="rounded-xl border bg-card px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between xl:gap-8">
        <div className="min-w-0 xl:w-[360px] xl:shrink-0">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Claude Code · {rangeLabel}
          </p>
          <h2 className="pt-2 text-[26px] leading-none font-medium tracking-tight text-foreground">
            Usage Overview
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-5 sm:grid-cols-3 xl:grid-cols-2">
            {items.map((it) => (
              <div key={it.label} className="space-y-1">
                <p className="text-[11px] text-muted-foreground">{it.label}</p>
                <p className="text-base font-medium tabular-nums text-foreground">{it.value}</p>
                {it.d != null ? (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {it.d >= 0 ? (
                      <TrendingUp className="size-3" aria-hidden />
                    ) : (
                      <TrendingDown className="size-3" aria-hidden />
                    )}
                    <span className="tabular-nums">{formatPct(it.d)}</span>
                    <span>vs prev</span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:self-stretch">
          {ACTIONS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex h-[92px] flex-col justify-between rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <a.icon className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-foreground uppercase">
                {a.title}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
