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
import type { ProjectRow } from "@/lib/types";

export default function ProjectsPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<ProjectRow[]>(`/api/projects${rangeQuery(since)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Projects" description="Token usage grouped by project." />
      {data.length === 0 ? (
        <EmptyBlock message="No projects in range." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Turns</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Cache read</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.project_slug}>
                    <TableCell className="max-w-[280px] truncate font-medium">{p.project_slug}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(p.sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(p.turns)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(p.input_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(p.output_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(p.billable_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(p.cache_read_tokens)}</TableCell>
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
