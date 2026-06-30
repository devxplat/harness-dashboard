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
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const makeColumns = (short: boolean, t: TFunction): ColumnDef<WorkspaceRow>[] => [
  {
    accessorKey: "workspace",
    header: t("pages.workspaces.workspace"),
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
    header: t("pages.workspaces.fileEditCalls"),
    cell: ({ row }) => formatInt(row.original.calls),
    meta: { align: "right" },
  },
  {
    accessorKey: "files",
    header: t("pages.workspaces.filesTouched"),
    cell: ({ row }) => formatInt(row.original.files),
    meta: { align: "right" },
  },
];

export default function WorkspacesPage() {
  const { t } = useTranslation();
  const [shortNames, setShortNames] = useState(true);
  const columns = useMemo(() => makeColumns(shortNames, t), [shortNames, t]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders, hasSelectedProviders } =
    useProviderFilter();
  const { data, error, loading } = useApi<WorkspaceRow[]>(
    settingsLoaded && hasAvailableProviders && hasSelectedProviders
      ? `/api/workspaces${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message={t("common.noProviders")} />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={t("pages.workspaces.title")} description={t("pages.workspaces.description")} />
      {data.length === 0 ? (
        <EmptyBlock message={t("pages.workspaces.noActivity")} />
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
          emptyMessage={t("pages.workspaces.noMatch")}
        />
      )}
    </>
  );
}
