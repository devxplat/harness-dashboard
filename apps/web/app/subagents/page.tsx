"use client";

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
import { formatInt, formatTokens, formatUSD } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { AgentGroupRow, SubagentsResponse } from "@/lib/types";

function AgentTable({ rows, label }: { rows: AgentGroupRow[]; label: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Msgs</TableHead>
          <TableHead className="text-right">I/O tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.group}-${r.model ?? "none"}-${i}`}>
            <TableCell className="font-medium">{r.group}</TableCell>
            <TableCell className="font-mono text-xs">{r.model ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(r.messages)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokens(r.input_tokens + r.output_tokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatUSD(r.cost_usd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function SubagentsPage() {
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<SubagentsResponse>(
    settingsLoaded && hasAvailableProviders
      ? `/api/subagents${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message="No discovered AI providers. Configure sources in Settings." />;
  }
  if (loading || !data) return <LoadingBlock />;

  const empty = data.by_kind.length === 0 && data.by_entrypoint.length === 0;

  return (
    <>
      <PageTitle
        title="Subagents & orchestration"
        description="Spend split by agent kind (main / auto-compaction / subagent) and client entrypoint."
      />
      {empty ? (
        <EmptyBlock message="No assistant activity in range." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>By kind</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentTable rows={data.by_kind} label="Kind" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By entrypoint</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentTable rows={data.by_entrypoint} label="Entrypoint" />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
