"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { ProviderBadge } from "@/components/provider-badge";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { formatDate, formatInt, formatTokens, formatUSD } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { MessageDetail, Paged, SessionRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const makeSessionColumns = (short: boolean): ColumnDef<SessionRow>[] => [
  {
    accessorKey: "started",
    header: "Started",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(row.original.started)}
      </span>
    ),
  },
  {
    accessorKey: "project_slug",
    header: "Project",
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.project_slug}
        short={short}
        href={`/sessions/?id=${row.original.session_id}&provider=${row.original.provider}`}
        className="max-w-[240px]"
      />
    ),
  },
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ row }) => <ProviderBadge provider={row.original.provider} compact />,
  },
  {
    accessorKey: "turns",
    header: "Turns",
    cell: ({ row }) => formatInt(row.original.turns),
    meta: { align: "right" },
  },
  {
    accessorKey: "tokens",
    header: "Tokens",
    cell: ({ row }) => formatTokens(row.original.tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "cost_usd",
    header: "Cost",
    cell: ({ row }) => formatUSD(row.original.cost_usd),
    meta: { align: "right" },
  },
];

function SessionsList() {
  const [shortNames, setShortNames] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const columns = useMemo(() => makeSessionColumns(shortNames), [shortNames]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  useEffect(() => setPage(0), [since, until, queryProviders]);
  const { data, error, loading } = useApi<Paged<SessionRow>>(
    settingsLoaded && hasAvailableProviders
      ? withRange(
          `/api/sessions?page=${page}&page_size=${pageSize}`,
          since,
          until,
          queryProviders,
        )
      : null,
  );
  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message="No discovered AI providers. Configure sources in Settings." />;
  }
  if (loading || !data) return <LoadingBlock />;
  if (data.total === 0) return <EmptyBlock message="No sessions yet." />;

  return (
    <DataTable
      columns={columns}
      data={data.rows}
      search={{
        fields: ["provider", "project_slug", "sample_cwd", "session_id"],
        placeholder: "Filter this page…",
        ariaLabel: "Filter sessions",
      }}
      actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
      emptyMessage="No sessions match."
      server={{
        total: data.total,
        pageIndex: page,
        pageSize,
        onPageChange: setPage,
        onPageSizeChange: (s) => {
          setPageSize(s);
          setPage(0);
        },
      }}
      footer={(rows) => {
        const turns = rows.reduce((a, s) => a + s.turns, 0);
        const tokens = rows.reduce((a, s) => a + s.tokens, 0);
        const cost = rows.reduce((a, s) => a + (s.cost_usd ?? 0), 0);
        return (
          <p className="text-xs text-muted-foreground">
            Totals: {formatInt(turns)} turns · {formatTokens(tokens)} tokens · {formatUSD(cost)}
          </p>
        );
      }}
    />
  );
}

function SessionDetail({ id, provider }: { id: string; provider: string | null }) {
  const { t } = useTranslation();
  const { data, error, loading } = useApi<MessageDetail[]>(
    `/api/sessions/${id}${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
  );
  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <Link className="text-sm text-muted-foreground hover:underline" href="/sessions/">
        ← All sessions
      </Link>
      <PageTitle title={t("pages.sessionDetail.title")} description={id} />
      <div className="space-y-2">
        {data.map((m) => (
          <Card key={m.uuid}>
            <CardContent className="space-y-1 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={m.type === "user" ? "default" : "secondary"}>{m.type}</Badge>
                <ProviderBadge provider={m.provider} compact />
                {m.is_sidechain ? <Badge variant="outline">subagent</Badge> : null}
                {m.model ? <span className="font-mono">{m.model}</span> : null}
                <span className="ml-auto">{formatDate(m.timestamp)}</span>
              </div>
              {m.prompt_text ? (
                <p className="whitespace-pre-wrap text-sm">{m.prompt_text}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {formatTokens(m.input_tokens)} in · {formatTokens(m.output_tokens)} out
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function SessionsContent() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const id = params.get("id");
  const provider = params.get("provider");
  return id ? (
    <SessionDetail id={id} provider={provider} />
  ) : (
    <>
      <PageTitle
        title={t("pages.sessions.title")}
        description={t("pages.sessions.description")}
      />
      <SessionsList />
    </>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SessionsContent />
    </Suspense>
  );
}
