"use client";

import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { DailyChart } from "@/components/charts/daily-chart";
import { KpiCard } from "@/components/kpi-card";
import { EmptyBlock, ErrorBlock, PageTitle } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatDateShort, formatInt, formatTokens, formatUSD, projectLabel } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { OverviewBundle, Totals } from "@/lib/types";
import { ArrowDown, ArrowUp, Coins, Database, HardDrive, MessagesSquare, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/** Period-over-period change as a fraction, or null when there's no comparable prior value. */
function delta(curr: number, prev: number | null | undefined): number | null {
  return prev != null && prev > 0 ? (curr - prev) / prev : null;
}

function RowsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const { since, until, previous } = useRange();
  const [shortNames, setShortNames] = useState(true);
  // Fast path: the KPIs render from the lightweight totals query (~0.6s) while
  // the heavier bundle (chart, by-model, recent sessions) streams in behind skeletons.
  const totals = useApi<Totals>(`/api/overview${rangeQuery(since, until)}`);
  const prevUrl = previous
    ? `/api/overview?since=${encodeURIComponent(previous.since)}&until=${encodeURIComponent(previous.until)}`
    : null;
  const prev = useApi<Totals>(prevUrl);
  const bundle = useApi<OverviewBundle>(`/api/overview-bundle${rangeQuery(since, until)}`);

  if (totals.error) return <ErrorBlock error={totals.error} />;

  const t = totals.data;
  const p = prev.data;
  const b = bundle.data;
  const cacheWrite = t ? t.cache_create_5m_tokens + t.cache_create_1h_tokens : 0;
  const prevCacheWrite = p ? p.cache_create_5m_tokens + p.cache_create_1h_tokens : null;

  return (
    <>
      <PageTitle title="Overview" description="Token usage and cost across your Claude Code sessions." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {t ? (
          <>
            <KpiCard label="Sessions" value={formatInt(t.sessions)} icon={MessagesSquare} delta={delta(t.sessions, p?.sessions)} />
            <KpiCard label="Turns" value={formatInt(t.turns)} icon={RefreshCw} delta={delta(t.turns, p?.turns)} />
            <KpiCard label="Input" value={formatTokens(t.input_tokens)} icon={ArrowDown} delta={delta(t.input_tokens, p?.input_tokens)} />
            <KpiCard label="Output" value={formatTokens(t.output_tokens)} icon={ArrowUp} delta={delta(t.output_tokens, p?.output_tokens)} />
            <KpiCard label="Cache read" value={formatTokens(t.cache_read_tokens)} icon={Database} delta={delta(t.cache_read_tokens, p?.cache_read_tokens)} />
            <KpiCard label="Cache write" value={formatTokens(cacheWrite)} icon={HardDrive} delta={delta(cacheWrite, prevCacheWrite)} />
            <KpiCard
              label="Est. cost"
              value={formatUSD(t.cost_usd)}
              icon={Coins}
              hint={t.cost_estimated ? "includes estimated rates" : undefined}
              delta={t.cost_usd != null ? delta(t.cost_usd, p?.cost_usd) : null}
            />
          </>
        ) : (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[110px] rounded-xl" />)
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {!b ? (
            <Skeleton className="h-64 w-full" />
          ) : b.daily.length ? (
            <DailyChart data={b.daily} />
          ) : (
            <EmptyBlock message="No activity in range." />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {!b ? (
              <Skeleton className="h-48 w-full" />
            ) : b.daily.length ? (
              <ActivityHeatmap data={b.daily} />
            ) : (
              <EmptyBlock message="No activity in range." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            {!b ? (
              <Skeleton className="h-64 w-full" />
            ) : b.daily.length ? (
              <CalendarHeatmap data={b.daily} />
            ) : (
              <EmptyBlock message="No activity in range." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
          </CardHeader>
          <CardContent>
            {!b ? (
              <RowsSkeleton />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.byModel.map((m) => (
                    <TableRow key={m.model ?? "unknown"}>
                      <TableCell className="font-mono text-xs">{m.model ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokens(m.input_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokens(m.output_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(m.cost_usd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Recent sessions</CardTitle>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={shortNames}
              onClick={() => setShortNames((v) => !v)}
              title={shortNames ? "Showing folder names" : "Showing full paths"}
            >
              {shortNames ? "Short names" : "Full paths"}
            </Button>
          </CardHeader>
          <CardContent>
            {!b ? (
              <RowsSkeleton />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Turns</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.sessions.map((s) => (
                    <TableRow key={s.session_id}>
                      <TableCell className="max-w-[200px] truncate">
                        <Link className="hover:underline" href={`/sessions/?id=${s.session_id}`}>
                          {projectLabel(s.sample_cwd, s.project_slug, shortNames)}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateShort(s.started)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(s.turns)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokens(s.tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(s.cost_usd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
