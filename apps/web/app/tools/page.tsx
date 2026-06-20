"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatInt, formatTokens } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { ToolRow } from "@/lib/types";

export default function ToolsPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<ToolRow[]>(`/api/tools${rangeQuery(since)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Tools" description="Tool calls and the result tokens they returned." />
      {data.length === 0 ? (
        <EmptyBlock message="No tool calls in range." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Result tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.tool_name}>
                    <TableCell className="font-medium">{row.tool_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(row.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(row.result_tokens)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
