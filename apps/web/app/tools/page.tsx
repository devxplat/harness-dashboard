"use client";

import { DataTable } from "@/components/data-table";
import { ProviderBadge } from "@/components/provider-badge";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt, formatTokens } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { ToolRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

const makeColumns = (t: TFunction): ColumnDef<ToolRow>[] => [
  {
    accessorKey: "tool_name",
    header: t("pages.tools.tool"),
    cell: ({ row }) => <span className="font-medium">{row.original.tool_name}</span>,
  },
  {
    accessorKey: "provider",
    header: t("pages.tools.provider"),
    cell: ({ row }) => <ProviderBadge provider={row.original.provider} compact />,
  },
  {
    accessorKey: "calls",
    header: t("pages.tools.calls"),
    cell: ({ row }) => formatInt(row.original.calls),
    meta: { align: "right" },
  },
  {
    accessorKey: "result_tokens",
    header: t("pages.tools.resultTokens"),
    cell: ({ row }) => formatTokens(row.original.result_tokens),
    meta: { align: "right" },
  },
];

export default function ToolsPage() {
  const { t } = useTranslation();
  const columns = useMemo(() => makeColumns(t), [t]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<ToolRow[]>(
    settingsLoaded && hasAvailableProviders
      ? `/api/tools${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message={t("common.noProviders")} />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={t("pages.tools.title")} description={t("pages.tools.description")} />
      {data.length === 0 ? (
        <EmptyBlock message={t("pages.tools.noToolCalls")} />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["provider", "tool_name"],
            placeholder: t("common.search"),
            ariaLabel: t("pages.tools.title"),
          }}
          pageSize={25}
          emptyMessage={t("pages.tools.noMatch")}
        />
      )}
    </>
  );
}
