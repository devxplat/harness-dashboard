"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt, formatTokens } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { ProjectRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

const makeColumns = (short: boolean): ColumnDef<ProjectRow>[] => [
  {
    accessorKey: "project_slug",
    header: "Project",
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.project_slug}
        short={short}
        className="max-w-[280px] font-medium"
      />
    ),
  },
  {
    accessorKey: "sessions",
    header: "Sessions",
    cell: ({ row }) => formatInt(row.original.sessions),
    meta: { align: "right" },
  },
  {
    accessorKey: "turns",
    header: "Turns",
    cell: ({ row }) => formatInt(row.original.turns),
    meta: { align: "right" },
  },
  {
    accessorKey: "input_tokens",
    header: "Input",
    cell: ({ row }) => formatTokens(row.original.input_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "output_tokens",
    header: "Output",
    cell: ({ row }) => formatTokens(row.original.output_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "billable_tokens",
    header: "Billable",
    cell: ({ row }) => formatTokens(row.original.billable_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "cache_read_tokens",
    header: "Cache read",
    cell: ({ row }) => formatTokens(row.original.cache_read_tokens),
    meta: { align: "right" },
  },
];

export default function ProjectsPage() {
  const [shortNames, setShortNames] = useState(true);
  const columns = useMemo(() => makeColumns(shortNames), [shortNames]);
  const { since, until } = useRange();
  const { data, error, loading } = useApi<ProjectRow[]>(`/api/projects${rangeQuery(since, until)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Projects" description="Token usage grouped by project." />
      {data.length === 0 ? (
        <EmptyBlock message="No projects in range." />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["project_slug", "sample_cwd"],
            placeholder: "Filter projects…",
            ariaLabel: "Filter projects",
          }}
          actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
          pageSize={25}
          emptyMessage="No projects match."
        />
      )}
    </>
  );
}
