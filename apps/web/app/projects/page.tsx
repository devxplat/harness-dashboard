"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { ProviderBlips } from "@/components/provider-badge";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt, formatTokens, tidyPath } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { ProjectRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type ProjectAggregateRow = Omit<ProjectRow, "provider" | "providers"> & {
  providers: string[];
  provider_search: string;
  project_search: string;
};

function normalizePath(path: string): string {
  return tidyPath(path).replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function projectGroupKey(row: ProjectRow): string {
  if (row.repo_root) return `root:${normalizePath(row.repo_root)}`;
  if (row.sample_cwd) return `cwd:${normalizePath(row.sample_cwd)}`;
  if (row.repo_key) return `repo:${normalizePath(row.repo_key)}`;
  return `slug:${row.project_slug.toLocaleLowerCase()}`;
}

function aggregateProjects(rows: ProjectRow[]): ProjectAggregateRow[] {
  const grouped = new Map<string, ProjectAggregateRow>();

  for (const row of rows) {
    const key = projectGroupKey(row);
    const displayPath = row.repo_root ?? row.sample_cwd;
    const current =
      grouped.get(key) ??
      ({
        project_slug: row.project_slug,
        repo_key: row.repo_key,
        repo_root: row.repo_root,
        sample_cwd: displayPath,
        providers: [],
        provider_search: "",
        project_search: "",
        sessions: 0,
        turns: 0,
        input_tokens: 0,
        output_tokens: 0,
        billable_tokens: 0,
        cache_read_tokens: 0,
      } satisfies ProjectAggregateRow);

    if (!current.repo_key && row.repo_key) current.repo_key = row.repo_key;
    if (!current.repo_root && row.repo_root) current.repo_root = row.repo_root;
    if (row.repo_root && current.sample_cwd !== row.repo_root) current.sample_cwd = row.repo_root;
    if (!current.sample_cwd && displayPath) current.sample_cwd = displayPath;
    const rowProviders = row.providers?.length ? row.providers : [row.provider ?? "claude"];
    for (const provider of rowProviders) {
      if (!current.providers.includes(provider)) {
        current.providers.push(provider);
        current.provider_search = current.providers.join(" ");
      }
    }
    current.project_search = [
      current.project_search,
      row.project_slug,
      row.sample_cwd,
      row.repo_root,
      row.repo_key,
    ]
      .filter(Boolean)
      .join(" ");
    current.sessions += row.sessions;
    current.turns += row.turns;
    current.input_tokens += row.input_tokens;
    current.output_tokens += row.output_tokens;
    current.billable_tokens += row.billable_tokens;
    current.cache_read_tokens += row.cache_read_tokens;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort(
    (a, b) => b.billable_tokens - a.billable_tokens || b.sessions - a.sessions,
  );
}

const makeColumns = (short: boolean, t: TFunction): ColumnDef<ProjectAggregateRow>[] => [
  {
    accessorKey: "project_slug",
    header: t("pages.projects.project"),
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
    accessorKey: "providers",
    header: t("pages.projects.provider"),
    cell: ({ row }) => <ProviderBlips providers={row.original.providers} />,
  },
  {
    accessorKey: "sessions",
    header: t("pages.projects.sessions"),
    cell: ({ row }) => formatInt(row.original.sessions),
    meta: { align: "right" },
  },
  {
    accessorKey: "turns",
    header: t("pages.projects.turns"),
    cell: ({ row }) => formatInt(row.original.turns),
    meta: { align: "right" },
  },
  {
    accessorKey: "input_tokens",
    header: t("pages.projects.input"),
    cell: ({ row }) => formatTokens(row.original.input_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "output_tokens",
    header: t("pages.projects.output"),
    cell: ({ row }) => formatTokens(row.original.output_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "billable_tokens",
    header: t("pages.projects.billable"),
    cell: ({ row }) => formatTokens(row.original.billable_tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "cache_read_tokens",
    header: t("pages.projects.cacheRead"),
    cell: ({ row }) => formatTokens(row.original.cache_read_tokens),
    meta: { align: "right" },
  },
];

export default function ProjectsPage() {
  const { t } = useTranslation();
  const [shortNames, setShortNames] = useState(true);
  const columns = useMemo(() => makeColumns(shortNames, t), [shortNames, t]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<ProjectRow[]>(
    settingsLoaded && hasAvailableProviders
      ? `/api/projects${rangeQuery(since, until, queryProviders)}`
      : null,
  );
  const projects = useMemo(() => aggregateProjects(data ?? []), [data]);

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message={t("common.noProviders")} />;
  }
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={t("pages.projects.title")} description={t("pages.projects.description")} />
      {projects.length === 0 ? (
        <EmptyBlock message={t("pages.projects.noProjects")} />
      ) : (
        <DataTable
          columns={columns}
          data={projects}
          search={{
            fields: ["provider_search", "project_search", "project_slug", "sample_cwd"],
            placeholder: "Filter projects…",
            ariaLabel: "Filter projects",
          }}
          actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
          pageSize={25}
          emptyMessage={t("pages.projects.noMatch")}
        />
      )}
    </>
  );
}
