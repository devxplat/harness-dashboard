"use client";

import { DataTable } from "@/components/data-table";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt, formatTokens } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { ToolRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<ToolRow>[] = [
  {
    accessorKey: "tool_name",
    header: "Tool",
    cell: ({ row }) => <span className="font-medium">{row.original.tool_name}</span>,
  },
  {
    accessorKey: "calls",
    header: "Calls",
    cell: ({ row }) => formatInt(row.original.calls),
    meta: { align: "right" },
  },
  {
    accessorKey: "result_tokens",
    header: "Result tokens",
    cell: ({ row }) => formatTokens(row.original.result_tokens),
    meta: { align: "right" },
  },
];

export default function ToolsPage() {
  const { since, until } = useRange();
  const { data, error, loading } = useApi<ToolRow[]>(`/api/tools${rangeQuery(since, until)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Tools" description="Tool calls and the result tokens they returned." />
      {data.length === 0 ? (
        <EmptyBlock message="No tool calls in range." />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["tool_name"],
            placeholder: "Filter tools…",
            ariaLabel: "Filter tools",
          }}
          pageSize={25}
          emptyMessage="No tools match."
        />
      )}
    </>
  );
}
