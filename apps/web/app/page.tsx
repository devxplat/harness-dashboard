"use client";

import { DailyChart } from "@/components/charts/daily-chart";
import { KpiCard } from "@/components/kpi-card";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatInt, formatTokens, formatUSD, shortId } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { OverviewBundle } from "@/lib/types";
import Link from "next/link";

export default function OverviewPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<OverviewBundle>(
    `/api/overview-bundle${rangeQuery(since)}`,
  );

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  const t = data.totals;
  const cacheWrite = t.cache_create_5m_tokens + t.cache_create_1h_tokens;

  return (
    <>
      <PageTitle title="Overview" description="Token usage and cost across your Claude Code sessions." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Sessions" value={formatInt(t.sessions)} />
        <KpiCard label="Turns" value={formatInt(t.turns)} />
        <KpiCard label="Input" value={formatTokens(t.input_tokens)} />
        <KpiCard label="Output" value={formatTokens(t.output_tokens)} />
        <KpiCard label="Cache read" value={formatTokens(t.cache_read_tokens)} />
        <KpiCard label="Cache write" value={formatTokens(cacheWrite)} />
        <KpiCard
          label="Est. cost"
          value={formatUSD(t.cost_usd)}
          hint={t.cost_estimated ? "includes estimated rates" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {data.daily.length ? <DailyChart data={data.daily} /> : <EmptyBlock message="No activity in range." />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
          </CardHeader>
          <CardContent>
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
                {data.byModel.map((m) => (
                  <TableRow key={m.model ?? "unknown"}>
                    <TableCell className="font-mono text-xs">{m.model ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(m.input_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(m.output_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUSD(m.cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Turns</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sessions.map((s) => (
                  <TableRow key={s.session_id}>
                    <TableCell className="max-w-[180px] truncate">
                      <Link className="hover:underline" href={`/sessions/?id=${s.session_id}`}>
                        {s.project_slug ?? shortId(s.session_id)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(s.turns)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(s.tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUSD(s.cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
