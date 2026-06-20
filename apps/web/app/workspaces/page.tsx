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
import { formatInt } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { WorkspaceRow } from "@/lib/types";

export default function WorkspacesPage() {
  const { since, until } = useRange();
  const { data, error, loading } = useApi<WorkspaceRow[]>(
    `/api/workspaces${rangeQuery(since, until)}`,
  );

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Workspaces" description="File-editing tool activity per workspace." />
      {data.length === 0 ? (
        <EmptyBlock message="No file-editing activity in range." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">File-edit calls</TableHead>
                  <TableHead className="text-right">Files touched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((w) => (
                  <TableRow key={w.workspace}>
                    <TableCell className="max-w-[320px] truncate font-medium">{w.workspace}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(w.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(w.files)}</TableCell>
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
