"use client";

import { DataTable } from "@/components/data-table";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatDate, formatInt } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { SkillRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";

const columns: ColumnDef<SkillRow>[] = [
  {
    accessorKey: "skill",
    header: "Skill",
    cell: ({ row }) => <span className="font-medium">{row.original.skill}</span>,
  },
  {
    accessorKey: "manual_sessions",
    header: "You ran",
    cell: ({ row }) => formatInt(row.original.manual_sessions),
    meta: { align: "right" },
  },
  {
    accessorKey: "tool_invocations",
    header: "Claude invoked",
    cell: ({ row }) => formatInt(row.original.tool_invocations),
    meta: { align: "right" },
  },
  {
    accessorKey: "sessions",
    header: "Sessions",
    cell: ({ row }) => formatInt(row.original.sessions),
    meta: { align: "right" },
  },
  {
    accessorKey: "last_used",
    header: "Last used",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.last_used)}</span>
    ),
  },
];

export default function SkillsPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<SkillRow[]>(
    settingsLoaded && hasAvailableProviders
      ? `/api/skills${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message="No discovered AI providers. Configure sources in Settings." />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle
        title={t("pages.skills.title")}
        description={t("pages.skills.description")}
      />
      {data.length === 0 ? (
        <EmptyBlock message="No skill or slash-command activity in range." />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["skill"],
            placeholder: "Filter skills…",
            ariaLabel: "Filter skills",
          }}
          pageSize={25}
          emptyMessage="No skills match."
        />
      )}
    </>
  );
}
