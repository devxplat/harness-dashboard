"use client";

import { DataTable } from "@/components/data-table";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { formatDate, formatTokens, formatUSD } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { PromptRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";

const promptColumns: ColumnDef<PromptRow>[] = [
  {
    accessorKey: "timestamp",
    header: "When",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(row.original.timestamp)}
      </span>
    ),
  },
  {
    accessorKey: "project_slug",
    header: "Project",
    cell: ({ row }) => <span className="block max-w-[160px] truncate text-xs">{row.original.project_slug}</span>,
  },
  {
    accessorKey: "prompt_text",
    header: "Prompt",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="block max-w-[360px] truncate">
        {row.original.prompt_text ?? "—"}
        {row.original.cost_estimated ? (
          <Badge variant="outline" className="ml-2 text-[10px]">
            est.
          </Badge>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "billable_tokens",
    header: "Billable",
    cell: ({ row }) => formatTokens(row.original.billable_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "estimated_cost_usd",
    header: "Cost",
    cell: ({ row }) => formatUSD(row.original.estimated_cost_usd),
    meta: { align: "right" },
  },
];

export default function PromptsPage() {
  const [sort, setSort] = useState<"tokens" | "recent">("tokens");
  const { since, until } = useRange();
  const { data, error, loading } = useApi<PromptRow[]>(
    withRange(`/api/prompts?limit=50&sort=${sort}`, since, until),
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Prompts" description="Your most expensive prompts by attributed tokens." />
        <div className="flex gap-1">
          <Button size="sm" variant={sort === "tokens" ? "default" : "outline"} onClick={() => setSort("tokens")}>
            By tokens
          </Button>
          <Button size="sm" variant={sort === "recent" ? "default" : "outline"} onClick={() => setSort("recent")}>
            Recent
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorBlock error={error} />
      ) : loading || !data ? (
        <LoadingBlock />
      ) : data.length === 0 ? (
        <EmptyBlock message="No prompts yet." />
      ) : (
        <DataTable
          columns={promptColumns}
          data={data}
          search={{
            fields: ["project_slug", "prompt_text"],
            placeholder: "Filter prompts…",
            ariaLabel: "Filter prompts",
          }}
          pageSize={25}
          emptyMessage="No prompts match."
        />
      )}
    </>
  );
}
