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
import { useTranslation } from "react-i18next";

const columns: ColumnDef<ToolRow>[] = [
  {
    accessorKey: "tool_name",
    header: "Tool",
    cell: ({ row }) => <span className="font-medium">{row.original.tool_name}</span>,
  },
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ row }) => <ProviderBadge provider={row.original.provider} compact />,
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
  const { t } = useTranslation();
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<ToolRow[]>(
    settingsLoaded && hasAvailableProviders
      ? `/api/tools${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message="No discovered AI providers. Configure sources in Settings." />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={t("pages.tools.title")} description={t("pages.tools.description")} />
      {data.length === 0 ? (
        <EmptyBlock message="No tool calls in range." />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          search={{
            fields: ["provider", "tool_name"],
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
