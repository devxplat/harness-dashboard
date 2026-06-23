"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { ProviderBadge } from "@/components/provider-badge";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { formatDate, formatTokens, formatUSD } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { Paged, PromptRow } from "@/lib/types";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const makeColumns = (t: TFunction, short: boolean): ColumnDef<PromptRow>[] => [
  {
    accessorKey: "timestamp",
    header: t("pages.prompts.when"),
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(row.original.timestamp)}
      </span>
    ),
  },
  {
    accessorKey: "project_slug",
    header: t("pages.prompts.project"),
    enableSorting: false,
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.project_slug}
        short={short}
        className="max-w-[200px] text-xs"
      />
    ),
  },
  {
    accessorKey: "provider",
    header: t("pages.prompts.provider"),
    enableSorting: false,
    cell: ({ row }) => <ProviderBadge provider={row.original.provider} compact />,
  },
  {
    accessorKey: "prompt_text",
    header: t("pages.prompts.prompt"),
    enableSorting: false,
    cell: ({ row }) => (
      <span className="block max-w-[360px] truncate">
        {row.original.prompt_text ?? "—"}
        {row.original.cost_estimated ? (
          <Badge variant="outline" className="ml-2 text-[10px]">
            {t("pages.prompts.est")}
          </Badge>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "billable_tokens",
    header: t("pages.prompts.billable"),
    cell: ({ row }) => formatTokens(row.original.billable_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "estimated_cost_usd",
    header: t("pages.prompts.cost"),
    enableSorting: false,
    cell: ({ row }) => formatUSD(row.original.estimated_cost_usd),
    meta: { align: "right" },
  },
];

export default function PromptsPage() {
  const { t } = useTranslation();
  const [sort, setSort] = useState<"tokens" | "recent">("tokens");
  const [shortNames, setShortNames] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const columns = useMemo(() => makeColumns(t, shortNames), [t, shortNames]);
  // The server sorts the whole dataset by tokens or recency; reflect that on the
  // matching column header so clicking it re-ranks everything (not just the page).
  const sorting: SortingState = [
    { id: sort === "recent" ? "timestamp" : "billable_tokens", desc: true },
  ];
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  // Reset to the first page whenever the result set changes underneath us.
  useEffect(() => setPage(0), [sort, since, until, queryProviders]);
  const { data, error, loading } = useApi<Paged<PromptRow>>(
    settingsLoaded && hasAvailableProviders
      ? withRange(
          `/api/prompts?sort=${sort}&page=${page}&page_size=${pageSize}`,
          since,
          until,
          queryProviders,
        )
      : null,
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title={t("pages.prompts.title")} description={t("pages.prompts.description")} />
        <div className="flex gap-1">
          <Button size="sm" variant={sort === "tokens" ? "default" : "outline"} onClick={() => setSort("tokens")}>
            {t("pages.prompts.byTokens")}
          </Button>
          <Button size="sm" variant={sort === "recent" ? "default" : "outline"} onClick={() => setSort("recent")}>
            {t("pages.prompts.recent")}
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorBlock error={error} />
      ) : settingsLoaded && !hasAvailableProviders ? (
        <EmptyBlock message={t("common.noProviders")} />
      ) : loading || !data ? (
        <LoadingBlock />
      ) : data.total === 0 ? (
        <EmptyBlock message={t("pages.prompts.noPrompts")} />
      ) : (
        <DataTable
          columns={columns}
          data={data.rows}
          search={{
            fields: ["provider", "project_slug", "sample_cwd", "prompt_text"],
            placeholder: "Filter this page…",
            ariaLabel: "Filter prompts",
          }}
          actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
          emptyMessage={t("pages.prompts.noMatch")}
          server={{
            total: data.total,
            pageIndex: page,
            pageSize,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setPageSize(s);
              setPage(0);
            },
            sort: {
              state: sorting,
              onChange: (next) => {
                const col = next[0]?.id;
                if (col === "timestamp") setSort("recent");
                else if (col === "billable_tokens") setSort("tokens");
              },
            },
          }}
        />
      )}
    </>
  );
}
