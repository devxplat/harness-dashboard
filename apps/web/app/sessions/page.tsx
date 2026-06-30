"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { ProviderBadge } from "@/components/provider-badge";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { formatDate, formatInt, formatTokens, formatUSD } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type {
  ContextWindowComponent,
  ContextWindowDetail,
  Paged,
  PlanUsageWindow,
  SessionBundle,
  SessionRow,
} from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

function sessionHref(sessionId: string, provider?: string | null) {
  const params = new URLSearchParams({ id: sessionId });
  if (provider) params.set("provider", provider);
  return `/sessions/?${params.toString()}`;
}

const makeSessionColumns = (short: boolean, t: TFunction): ColumnDef<SessionRow>[] => [
  {
    accessorKey: "started",
    header: t("pages.sessions.started"),
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(row.original.started)}
      </span>
    ),
  },
  {
    accessorKey: "project_slug",
    header: t("pages.sessions.project"),
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.project_slug}
        short={short}
        href={sessionHref(row.original.session_id, row.original.provider)}
        className="max-w-[240px]"
      />
    ),
  },
  {
    accessorKey: "provider",
    header: t("pages.sessions.provider"),
    cell: ({ row }) => <ProviderBadge provider={row.original.provider} compact />,
  },
  {
    accessorKey: "turns",
    header: t("pages.sessions.turns"),
    cell: ({ row }) => formatInt(row.original.turns),
    meta: { align: "right" },
  },
  {
    accessorKey: "tokens",
    header: t("pages.sessions.tokens"),
    cell: ({ row }) => formatTokens(row.original.tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "cost_usd",
    header: t("pages.sessions.cost"),
    cell: ({ row }) => formatUSD(row.original.cost_usd),
    meta: { align: "right" },
  },
];

function pctText(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "-";
}

function sourceBadge(source: string, observed?: boolean) {
  if (source === "statusline" || observed) return "reported";
  if (source === "estimated") return "estimated";
  if (source === "computed") return "computed";
  return "unavailable";
}

function unavailableContext(sessionId: string, provider?: string | null): ContextWindowDetail {
  return {
    provider: provider ?? "unknown",
    session_id: sessionId,
    captured_at: null,
    source: "unavailable",
    model: null,
    context_window_size: null,
    used_tokens: 0,
    used_pct: null,
    remaining_pct: null,
    current_usage: {},
    components: [],
    supported: false,
    observed: false,
    note: null,
  };
}

function unavailablePlanUsage(provider: string | null | undefined, label: string): PlanUsageWindow {
  return {
    provider: provider ?? "unknown",
    account_scope: "default",
    window_key: "unavailable",
    label,
    captured_at: null,
    source: "unavailable",
    used_pct: null,
    resets_at: null,
    used_amount: null,
    limit_amount: null,
    unit: null,
    details: {},
    supported: false,
    observed: false,
    note: null,
  };
}

function normalizeContextWindow(
  context: Partial<ContextWindowDetail> | null | undefined,
  sessionId: string,
  provider: string | null,
) {
  return {
    ...unavailableContext(sessionId, provider),
    ...context,
    provider: context?.provider ?? provider ?? "unknown",
    session_id: context?.session_id ?? sessionId,
    current_usage: context?.current_usage ?? {},
    components: context?.components ?? [],
    used_tokens: context?.used_tokens ?? 0,
    supported: context?.supported ?? false,
    observed: context?.observed ?? false,
  };
}

function normalizePlanUsage(
  windows: Partial<PlanUsageWindow>[] | null | undefined,
  provider: string | null,
  fallbackLabel: string,
) {
  if (!windows?.length) return [unavailablePlanUsage(provider, fallbackLabel)];
  return windows.map((window) => ({
    ...unavailablePlanUsage(provider, fallbackLabel),
    ...window,
    provider: window.provider ?? provider ?? "unknown",
    account_scope: window.account_scope ?? "default",
    label: window.label ?? fallbackLabel,
    details: window.details ?? {},
    supported: window.supported ?? false,
    observed: window.observed ?? false,
  }));
}

function UsageMeter({
  label,
  pct,
  meta,
}: {
  label: string;
  pct: number | null | undefined;
  meta?: string;
}) {
  const width = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{meta ?? pctText(pct)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-muted">
        <div className="h-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ContextComponentRow({ component }: { component: ContextWindowComponent }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-xs">
      <span className="min-w-0 truncate">{component.label}</span>
      <span className="font-mono text-muted-foreground">{formatTokens(component.tokens)}</span>
      <span className="w-12 text-right text-muted-foreground">{pctText(component.pct)}</span>
      <Badge variant="outline" className="justify-center text-[10px]">
        {component.source} / {component.confidence}
      </Badge>
    </div>
  );
}

function ContextWindowPanel({ context }: { context: ContextWindowDetail }) {
  const { t } = useTranslation();
  const total = context.context_window_size ? formatTokens(context.context_window_size) : "-";
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("pages.sessionDetail.contextWindow")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {context.model ?? t("pages.sessionDetail.unknownModel")} /{" "}
              {sourceBadge(context.source, context.observed)}
            </p>
          </div>
          <Badge variant={context.observed ? "default" : "secondary"}>
            {context.observed ? t("pages.sessionDetail.officialSnapshot") : context.source}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <UsageMeter
          label={`${formatTokens(context.used_tokens)} / ${total}`}
          pct={context.used_pct}
          meta={t("pages.sessionDetail.usedFree", {
            used: pctText(context.used_pct),
            free: pctText(context.remaining_pct),
          })}
        />
        {context.note ? <p className="text-xs text-muted-foreground">{context.note}</p> : null}
        {context.components.length ? (
          <details className="space-y-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t("pages.sessionDetail.breakdown")}
            </summary>
            <div className="mt-2 space-y-2">
              {context.components.map((component) => (
                <ContextComponentRow key={component.key} component={component} />
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PlanUsagePanel({ windows }: { windows: PlanUsageWindow[] }) {
  const { t } = useTranslation();
  const visible = windows.filter((window) => window.supported);
  const unavailable = windows.find((window) => !window.supported);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("pages.sessionDetail.planUsage")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {visible.length ? (
          visible.map((window) => {
            const meta = window.resets_at
              ? t("pages.sessionDetail.resetsAt", {
                  date: formatDate(window.resets_at),
                  pct: pctText(window.used_pct),
                })
              : pctText(window.used_pct);
            const details = [
              window.source,
              window.captured_at ? formatDate(window.captured_at) : null,
              window.account_scope !== "default" ? window.account_scope : null,
              window.unit,
            ].filter(Boolean);
            return (
              <div key={`${window.account_scope}:${window.window_key}`} className="space-y-1">
                <UsageMeter label={window.label} pct={window.used_pct} meta={meta} />
                {details.length ? (
                  <p className="text-[11px] text-muted-foreground">{details.join(" / ")}</p>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            {unavailable?.note ?? t("pages.sessionDetail.noPlanUsageSource")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsList() {
  const { t } = useTranslation();
  const [shortNames, setShortNames] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const columns = useMemo(() => makeSessionColumns(shortNames, t), [shortNames, t]);
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders, hasSelectedProviders } =
    useProviderFilter();
  useEffect(() => setPage(0), [since, until, queryProviders]);
  const { data, error, loading } = useApi<Paged<SessionRow>>(
    settingsLoaded && hasAvailableProviders && hasSelectedProviders
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
    return <EmptyBlock message={t("common.noProviders")} />;
  }
  if (loading || !data) return <LoadingBlock />;
  if (data.total === 0) return <EmptyBlock message={t("pages.sessions.noSessions")} />;

  return (
    <DataTable
      columns={columns}
      data={data.rows}
      search={{
        fields: ["provider", "project_slug", "sample_cwd", "session_id"],
        placeholder: t("common.search"),
        ariaLabel: t("pages.sessions.title"),
      }}
      actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
      emptyMessage={t("pages.sessions.noMatch")}
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
            {t("pages.sessions.footerTotals", {
              turns: formatInt(turns),
              tokens: formatTokens(tokens),
              cost: formatUSD(cost),
            })}
          </p>
        );
      }}
    />
  );
}

function SessionDetail({ id, provider }: { id: string; provider: string | null }) {
  const { t } = useTranslation();
  const { data, error, loading } = useApi<SessionBundle>(
    `/api/sessions/${encodeURIComponent(id)}/bundle${
      provider ? `?provider=${encodeURIComponent(provider)}` : ""
    }`,
  );
  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;
  const session = data.session;
  const contextWindow = normalizeContextWindow(data.context_window, id, provider);
  const planUsage = normalizePlanUsage(data.plan_usage, provider, t("pages.sessionDetail.planUsage"));
  const messages = data.messages ?? [];

  return (
    <>
      <Link className="text-sm text-muted-foreground hover:underline" href="/sessions/">
        {t("pages.sessions.allSessions")}
      </Link>
      <PageTitle title={t("pages.sessionDetail.title")} description={id} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ContextWindowPanel context={contextWindow} />
        <PlanUsagePanel windows={planUsage} />
      </div>
      {session ? (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground sm:grid-cols-4">
          <div>
            <span className="block font-medium text-foreground">{formatInt(session.turns)}</span>
            {t("pages.sessionDetail.turns")}
          </div>
          <div>
            <span className="block font-medium text-foreground">{formatTokens(session.tokens)}</span>
            {t("pages.sessionDetail.tokens")}
          </div>
          <div>
            <span className="block font-medium text-foreground">{formatUSD(session.cost_usd)}</span>
            {t("pages.sessionDetail.apiCost")}
          </div>
          <div>
            <span className="block font-medium text-foreground">
              {formatDate(session.started)}
            </span>
            {t("pages.sessionDetail.started")}
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        {messages.map((m) => (
          <Card key={m.uuid}>
            <CardContent className="space-y-1 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={m.type === "user" ? "default" : "secondary"}>
                  {m.type === "user"
                    ? t("pages.sessions.user")
                    : t("pages.sessions.secondary")}
                </Badge>
                <ProviderBadge provider={m.provider} compact />
                {m.is_sidechain ? (
                  <Badge variant="outline">{t("pages.sessions.subagent")}</Badge>
                ) : null}
                {m.model ? <span className="font-mono">{m.model}</span> : null}
                <span className="ml-auto">{formatDate(m.timestamp)}</span>
              </div>
              {m.prompt_text ? (
                <p className="whitespace-pre-wrap text-sm">{m.prompt_text}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {formatTokens(m.input_tokens)} {t("pages.sessions.in")} · {formatTokens(m.output_tokens)} {t("pages.sessions.out")}
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
