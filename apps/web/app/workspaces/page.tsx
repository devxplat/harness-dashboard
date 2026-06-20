"use client";

import { DataTable } from "@/components/data-table";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { WorkspaceRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<WorkspaceRow>[] = [
  {
    accessorKey: "workspace",
    header: "Workspace",
    cell: ({ row }) => (
      <span className="block max-w-[320px] truncate font-medium">{row.original.workspace}</span>
    ),
  },
  {
    accessorKey: "calls",
    header: "File-edit calls",
    cell: ({ row }) => formatInt(row.original.calls),
    meta: { align: "right" },
  },
  {
    accessorKey: "files",
    header: "Files touched",
    cell: ({ row }) => formatInt(row.original.files),
    meta: { align: "right" },
  },
];

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
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["workspace"],
            placeholder: "Filter workspaces…",
            ariaLabel: "Filter workspaces",
          }}
          pageSize={25}
          emptyMessage="No workspaces match."
        />
      )}
    </>
  );
}
