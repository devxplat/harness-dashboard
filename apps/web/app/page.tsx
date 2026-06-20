"use client";

import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { DailyChart } from "@/components/charts/daily-chart";
import { OverviewStats } from "@/components/overview-stats";
import { EmptyBlock, ErrorBlock } from "@/components/states";
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
import Link from "next/link";
import { useState } from "react";

const RANGE_LABEL: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom range",
};

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
  const { range, since, until, previous } = useRange();
  const [shortNames, setShortNames] = useState(true);
  // Fast path: the stat panel renders from the lightweight totals query (~0.6s)
  // while the heavier bundle (heatmaps, by-model, recent sessions) streams in.
  const totals = useApi<Totals>(`/api/overview${rangeQuery(since, until)}`);
  const prevUrl = previous
    ? `/api/overview?since=${encodeURIComponent(previous.since)}&until=${encodeURIComponent(previous.until)}`
    : null;
  const prev = useApi<Totals>(prevUrl);
  const bundle = useApi<OverviewBundle>(`/api/overview-bundle${rangeQuery(since, until)}`);

  if (totals.error) return <ErrorBlock error={totals.error} />;

  const t = totals.data;
  const b = bundle.data;

  return (
    <>
      {t ? (
        <OverviewStats totals={t} prev={prev.data} rangeLabel={RANGE_LABEL[range] ?? "Selected range"} />
      ) : (
        <Skeleton className="h-[196px] w-full rounded-xl" />
      )}

      <div className="grid items-stretch gap-4 lg:grid-cols-5">
        <Card className="flex flex-col lg:col-span-3">
          <CardContent className="flex-1 pt-6">
            {!b ? (
              <Skeleton className="h-72 w-full" />
            ) : b.daily.length ? (
              <ActivityHeatmap data={b.daily} />
            ) : (
              <EmptyBlock message="No activity in range." />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            {!b ? (
              <Skeleton className="h-72 w-full" />
            ) : b.daily.length ? (
              <CalendarHeatmap data={b.daily} />
            ) : (
              <EmptyBlock message="No activity in range." />
            )}
          </CardContent>
        </Card>
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
