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
import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

function makeColumns(t: TFunction): ColumnDef<SkillRow>[] {
  return [
    {
      accessorKey: "skill",
      header: t("pages.skills.skill"),
      cell: ({ row }) => <span className="font-medium">{row.original.skill}</span>,
    },
    {
      accessorKey: "manual_sessions",
      header: t("pages.skills.youRan"),
      cell: ({ row }) => formatInt(row.original.manual_sessions),
      meta: { align: "right" },
    },
    {
      accessorKey: "tool_invocations",
      header: t("pages.skills.claudeInvoked"),
      cell: ({ row }) => formatInt(row.original.tool_invocations),
      meta: { align: "right" },
    },
    {
      accessorKey: "sessions",
      header: t("pages.skills.sessions"),
      cell: ({ row }) => formatInt(row.original.sessions),
      meta: { align: "right" },
    },
    {
      accessorKey: "last_used",
      header: t("pages.skills.lastUsed"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.original.last_used)}</span>
      ),
    },
  ];
}

export default function SkillsPage() {
  const { t } = useTranslation();
  const columns = useMemo(() => makeColumns(t), [t]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders, hasSelectedProviders } =
    useProviderFilter();
  const { data, error, loading } = useApi<SkillRow[]>(
    settingsLoaded && hasAvailableProviders && hasSelectedProviders
      ? `/api/skills${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message={t("common.noProviders")} />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle
        title={t("pages.skills.title")}
        description={t("pages.skills.description")}
      />
      {data.length === 0 ? (
        <EmptyBlock message={t("pages.skills.noActivity")} />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["skill"],
            placeholder: t("common.search"),
            ariaLabel: "Filter skills",
          }}
          pageSize={25}
          emptyMessage={t("pages.skills.noMatch")}
        />
      )}
    </>
  );
}
