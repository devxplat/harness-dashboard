"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { WorkspaceRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const makeColumns = (short: boolean): ColumnDef<WorkspaceRow>[] => [
  {
    accessorKey: "workspace",
    header: "Workspace",
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.workspace}
        short={short}
        className="max-w-[320px] font-medium"
      />
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
  const { t } = useTranslation();
  const [shortNames, setShortNames] = useState(true);
  const columns = useMemo(() => makeColumns(shortNames), [shortNames]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<WorkspaceRow[]>(
    settingsLoaded && hasAvailableProviders
      ? `/api/workspaces${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message="No discovered AI providers. Configure sources in Settings." />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={t("pages.workspaces.title")} description={t("pages.workspaces.description")} />
      {data.length === 0 ? (
        <EmptyBlock message="No file-editing activity in range." />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["workspace", "sample_cwd"],
            placeholder: "Filter workspaces…",
            ariaLabel: "Filter workspaces",
          }}
          actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
          pageSize={25}
          emptyMessage="No workspaces match."
        />
      )}
    </>
  );
}
