"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  SearchableSelect,
  type SearchableOption,
  useDebouncedValue,
} from "@/components/ui/searchable-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/use-api";
import { apiGet, apiPost, withRange } from "@/lib/api";
import { formatDateShort, formatInt } from "@/lib/format";
import { normalizePrSessionCorrelationConfig } from "@/lib/pr-session-correlation";
import { useRange } from "@/lib/range";
import { cn } from "@/lib/utils";
import type {
  PrAiEngine,
  PrAiIndex,
  PrAiInsightJob,
  PrDashboardBundle,
  PrDashboardRow,
  PrDeterministicInsightsPage,
  PrInsight,
  PrSessionCorrelation,
  PrSessionCorrelationConfig,
  PrTimelineEvent,
  SettingsInfo,
} from "@/lib/types";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  GitBranch,
  GitPullRequest,
  Link2,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { TFunction } from "i18next";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type StatusFilter = "all" | "awaiting_review" | "awaiting_merge" | "merged" | "closed";
type PrIndexType = "business_value" | "ai_maturity";
type PrAiBatchScope = "current_author" | "selected_prs" | "repo" | "org";

const ALL_VALUE = "__all";
const INSIGHTS_PAGE_SIZE = 8;
const JOB_POLL_MS = process.env.NODE_ENV === "test" ? 1 : 1000;
const JOB_POLL_LIMIT = 120;
const CORRELATION_BOOLEAN_OPTIONS: Array<
  [string, "use_branch" | "use_file_touches" | "use_title_keywords"]
> = [
  ["branch", "use_branch"],
  ["file_touch", "use_file_touches"],
  ["title_keyword", "use_title_keywords"],
];
const CORRELATION_WEIGHT_OPTIONS: Array<[string, keyof PrSessionCorrelationConfig["weights"]]> = [
  ["time_overlap", "time_overlap"],
  ["temporal_proximity", "temporal_proximity"],
  ["branch", "branch"],
  ["file_touch", "file_touch"],
  ["title_keyword", "title_keyword"],
];

function statusOptions(t: TFunction): SearchableOption[] {
  return ["all", "awaiting_review", "awaiting_merge", "merged", "closed"].map((value) => ({
    value,
    label: t(`enums.prStatus.${value}`),
  }));
}

function indexTypeOptions(t: TFunction): SearchableOption[] {
  return ["business_value", "ai_maturity"].map((value) => ({
    value,
    label: t(`enums.indexType.${value}`),
  }));
}

function prKey(row: Pick<PrDashboardRow, "repo_key" | "number">): string {
  return `${row.repo_key}#${row.number}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toOptions(values: string[], allLabel?: string): SearchableOption[] {
  const options = values.map((value) => ({ value, label: value }));
  return allLabel ? [{ value: ALL_VALUE, label: allLabel }, ...options] : options;
}

function normalizeEngineId(value: string | null | undefined): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "codex":
    case "codex-cli":
    case "codex_cli":
      return "codex_cli";
    case "claude":
    case "claude-cli":
    case "claude_cli":
      return "claude_cli";
    case "gemini":
    case "gemini-cli":
    case "gemini_cli":
      return "gemini_cli";
    default:
      return value ?? "";
  }
}

async function waitForAiJob(initial: PrAiInsightJob): Promise<PrAiInsightJob> {
  let current = initial;
  for (
    let i = 0;
    i < JOB_POLL_LIMIT && (current.status === "queued" || current.status === "running");
    i += 1
  ) {
    await sleep(JOB_POLL_MS);
    current = await apiGet<PrAiInsightJob>(
      `/api/pull-requests/ai-insights/jobs/${encodeURIComponent(initial.id)}`,
    );
  }
  if (current.status === "queued" || current.status === "running") {
    throw new Error("AI insight job did not finish in time. Check the CLI and try again.");
  }
  return current;
}

function fmtHours(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value < 1) return `${Math.round(value * 60)}m`;
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function fmtDate(value: string | null | undefined): string {
  return value ? formatDateShort(value) : "-";
}

function statusLabel(status: string, t: TFunction): string {
  return t(`enums.prStatus.${status}`, { defaultValue: status });
}

function statusClass(status: string): string {
  switch (status) {
    case "awaiting_review":
      return "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-300";
    case "awaiting_merge":
      return "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "merged":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "closed":
      return "border-muted text-muted-foreground";
    default:
      return "";
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-500/40 text-red-600 dark:text-red-300";
    case "warning":
      return "border-amber-500/40 text-amber-600 dark:text-amber-300";
    default:
      return "border-sky-500/40 text-sky-600 dark:text-sky-300";
  }
}

function scoreClass(score: number): string {
  if (score >= 75) return "border-emerald-500/40 text-emerald-600 dark:text-emerald-300";
  if (score >= 50) return "border-amber-500/40 text-amber-600 dark:text-amber-300";
  return "border-red-500/40 text-red-600 dark:text-red-300";
}

function indexTitle(type: PrIndexType, t: TFunction): string {
  return t(`enums.indexType.${type}`);
}

function indexShortTitle(type: PrIndexType, t: TFunction): string {
  return t(`enums.indexTypeShort.${type}`);
}

function authorLabel(login: string, t: TFunction): string {
  return login === ALL_VALUE ? t("pages.pullRequests.allContributors") : login;
}

function repoLabel(row: Pick<PrDashboardRow, "repo_full_name" | "repo_key">): string {
  return row.repo_full_name || row.repo_key;
}

function confidencePct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sessionModeLabel(mode: string, t: TFunction): string {
  return mode === "ai" ? t("enums.sessionMode.ai") : t("enums.sessionMode.deterministic");
}

function topSessionCorrelation(row: PrDashboardRow): PrSessionCorrelation | null {
  return row.session_correlations?.[0] ?? null;
}

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : "-";
}

function deployStatusClass(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "success":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-300";
    case "failure":
    case "failed":
      return "border-red-500/40 text-red-600 dark:text-red-300";
    default:
      return "border-muted text-muted-foreground";
  }
}

function cloneCorrelationConfig(config: PrSessionCorrelationConfig): PrSessionCorrelationConfig {
  return {
    ...config,
    weights: { ...config.weights },
  };
}

function IndexBadge({ index }: { index: PrAiIndex }) {
  return (
    <div className="min-w-0">
      <Badge variant="outline" className={scoreClass(index.score)}>
        {index.score}
        {index.grade ? ` ${index.grade}` : ""}
      </Badge>
      {index.category ? (
        <div className="mt-1 truncate text-[11px] text-muted-foreground" title={index.category}>
          {index.category.replaceAll("_", " ")}
        </div>
      ) : null}
    </div>
  );
}

function IndexExplainability({ index }: { index: PrAiIndex }) {
  const { t } = useTranslation();
  const scores = Object.entries(index.category_scores ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {index.confidence != null ? (
          <Badge variant="outline">
            {t("pages.pullRequests.detail.confidence", {
              defaultValue: "Confidence {{value}}%",
              value: Math.round(index.confidence * 100),
            })}
          </Badge>
        ) : null}
        {index.engine ? <Badge variant="outline">{index.engine}</Badge> : null}
        {index.generated_at_utc ? (
          <Badge variant="outline">{fmtDate(index.generated_at_utc)}</Badge>
        ) : null}
      </div>
      {scores.length ? (
        <div className="space-y-2">
          {scores.slice(0, 7).map(([name, value]) => (
            <div key={name} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">{name.replaceAll("_", " ")}</span>
                <span className="tabular-nums">{Math.round(value)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {index.evidence.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">
            {t("pages.pullRequests.detail.evidence", { defaultValue: "Evidence" })}
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {index.evidence.slice(0, 4).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {index.recommendations.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">
            {t("pages.pullRequests.detail.recommendations", {
              defaultValue: "Recommendations",
            })}
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {index.recommendations.slice(0, 4).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {index.input_hash ? (
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {t("pages.pullRequests.aiIndexes.inputHash", { hash: index.input_hash })}
        </p>
      ) : null}
    </div>
  );
}

function IndexCell({
  type,
  index,
  loading,
  disabled,
  onGenerate,
}: {
  type: PrIndexType;
  index: PrAiIndex | null;
  loading: boolean;
  disabled: boolean;
  onGenerate: () => void;
}) {
  const { t } = useTranslation();
  const label = indexTitle(type, t);
  return (
    <div className="flex min-w-32 items-center gap-2">
      {index ? (
        <IndexBadge index={index} />
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={(event) => {
          event.stopPropagation();
          onGenerate();
        }}
        disabled={disabled || loading}
        aria-label={t("pages.pullRequests.aiIndexes.generate", { name: label })}
      >
        <Sparkles className="size-3.5" />
        {loading ? "..." : index ? t("common.retry") : t("pages.pullRequests.aiIndexes.generate", { name: "" }).trim()}
      </Button>
    </div>
  );
}

function eventLabel(event: PrTimelineEvent, t: TFunction): string {
  switch (event.event_type) {
    case "created":
      return t("enums.prStatus.open");
    case "review":
      return t("pages.pullRequests.detail.review", { defaultValue: "Review" });
    case "comment":
      return t("pages.pullRequests.detail.comment", { defaultValue: "Comment" });
    case "check":
      return t("pages.pullRequests.detail.check", { defaultValue: "Check" });
    case "merged":
      return t("enums.prStatus.merged");
    case "closed":
      return t("enums.prStatus.closed");
    default:
      return event.event_type;
  }
}

function StatTile({
  label,
  value,
  active,
}: {
  label: string;
  value: number | string;
  active?: boolean;
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "min-h-24 justify-between transition-colors",
        active ? "ring-2 ring-primary/45" : null,
      )}
    >
      <CardHeader className="pb-0">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function DetailSheet({
  pr: summaryPr,
  open,
  onOpenChange,
}: {
  pr: PrDashboardRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const detailPath =
    open && summaryPr
      ? `/api/pull-requests/detail?repo_key=${encodeURIComponent(summaryPr.repo_key)}&number=${summaryPr.number}`
      : null;
  const detail = useApi<PrDashboardRow>(detailPath);
  const detailMatches =
    detail.data &&
    summaryPr &&
    detail.data.repo_key === summaryPr.repo_key &&
    detail.data.number === summaryPr.number;
  const pr = detailMatches ? detail.data : summaryPr;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-2xl">
        {pr ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="pr-8 leading-snug">
                #{pr.number} {pr.title ?? t("pages.pullRequests.detail.untitledPr")}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span>{repoLabel(pr)}</span>
                <Badge variant="outline" className={statusClass(pr.status_bucket)}>
                  {statusLabel(pr.status_bucket, t)}
                </Badge>
                {pr.ai_session_overlap ? (
                  <Badge>{t("pages.pullRequests.row.aiOverlap")}</Badge>
                ) : null}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              {detail.loading && !detailMatches ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  {t("pages.pullRequests.detail.loading")}
                </div>
              ) : null}
              {detail.error ? (
                <div className="rounded-lg border border-destructive/40 p-4">
                  <ErrorBlock error={detail.error} />
                  <Button className="mt-3" variant="outline" onClick={() => detail.refetch()}>
                    {t("pages.pullRequests.detail.retry")}
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("pages.pullRequests.detail.size")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">{formatInt(pr.size)}</p>
                  <p className="pt-1 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-300">
                      +{formatInt(pr.additions)}
                    </span>{" "}
                    <span className="text-red-600 dark:text-red-300">
                      -{formatInt(pr.deletions)}
                    </span>
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("pages.pullRequests.detail.filesReviews")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatInt(pr.changed_files)} / {formatInt(pr.review_count)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("pages.pullRequests.detail.cycleTime")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">{fmtHours(pr.cycle_hours)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("pages.pullRequests.detail.reviewWait")}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {fmtHours(pr.review_wait_hours)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  [t("enums.indexType.business_value"), pr.business_value_index],
                  [t("enums.indexType.ai_maturity"), pr.ai_maturity_index],
                ].map(([label, index]) => (
                  <div key={label as string} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label as string}</p>
                    {index ? (
                      <div className="space-y-2 pt-1">
                        <IndexBadge index={index as PrAiIndex} />
                        {(index as PrAiIndex).summary ? (
                          <p className="text-xs text-muted-foreground">
                            {(index as PrAiIndex).summary}
                          </p>
                        ) : null}
                        <IndexExplainability index={index as PrAiIndex} />
                      </div>
                    ) : (
                      <p className="pt-1 text-sm text-muted-foreground">
                        {t("pages.pullRequests.detail.notGenerated")}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t("pages.pullRequests.detail.branches")}</h3>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <GitBranch className="size-4 text-muted-foreground" />
                  <Badge variant="outline">{pr.head_branch ?? t("common.unknown")}</Badge>
                  <span className="text-muted-foreground">
                    {t("pages.pullRequests.detail.into")}
                  </span>
                  <Badge variant="outline">{pr.base_branch ?? t("common.unknown")}</Badge>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">
                  {t("pages.pullRequests.detail.correlatedSessions")}
                </h3>
                {pr.session_correlations?.length ? (
                  <div className="space-y-2">
                    {pr.session_correlations.slice(0, 8).map((correlation) => (
                      <div
                        key={`${correlation.mode}:${correlation.provider}:${correlation.session_id}`}
                        className="rounded-lg border p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link2 className="size-4 text-muted-foreground" />
                            <Link
                              className="truncate font-mono text-xs hover:underline"
                              href={`/sessions/?id=${encodeURIComponent(correlation.session_id)}&provider=${encodeURIComponent(correlation.provider)}`}
                            >
                              {correlation.provider}:{correlation.session_id}
                            </Link>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">
                              {sessionModeLabel(correlation.mode, t)}
                            </Badge>
                            <Badge variant="outline" className={scoreClass(correlation.score)}>
                              {confidencePct(correlation.confidence)}
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                          <span>
                            {t("pages.pullRequests.detail.started", {
                              date: fmtDate(correlation.session_started_at_utc),
                            })}
                          </span>
                          <span>
                            {t("pages.pullRequests.detail.turnsTokens", {
                              turns: formatInt(correlation.turns),
                              tokens: formatInt(correlation.tokens),
                            })}
                          </span>
                        </div>
                        {correlation.summary ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {correlation.summary}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("pages.pullRequests.detail.noCorrelations")} />
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">
                  {t("pages.pullRequests.detail.relatedCommits")}
                </h3>
                {pr.related_commits?.length ? (
                  <div className="max-h-64 overflow-y-auto rounded-lg border">
                    {pr.related_commits.slice(0, 20).map((commit) => (
                      <div
                        key={commit.sha}
                        className="grid grid-cols-[88px_1fr_auto] gap-3 border-b p-2 text-xs last:border-b-0"
                      >
                        <span className="font-mono">{shortSha(commit.sha)}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={commit.subject ?? ""}>
                            {commit.subject ?? t("pages.pullRequests.detail.untitledCommit")}
                          </p>
                          <p className="truncate text-muted-foreground">
                            {commit.author_name ?? commit.author_email ?? "-"} ·{" "}
                            {commit.match_reason.replaceAll("_", " ")}
                          </p>
                        </div>
                        <div className="text-right tabular-nums text-muted-foreground">
                          <div>
                            +{formatInt(commit.insertions)} -{formatInt(commit.deletions)}
                          </div>
                          {commit.ai_assisted ? (
                            <Badge variant="outline">{t("enums.sessionMode.ai")}</Badge>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("pages.pullRequests.detail.noCommits")} />
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">
                  {t("pages.pullRequests.detail.deployments")}
                </h3>
                {pr.related_deployments?.length ? (
                  <div className="space-y-2">
                    {pr.related_deployments.slice(0, 8).map((deployment) => (
                      <div
                        key={`${deployment.kind}:${deployment.ext_id}`}
                        className="rounded-lg border p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {deployment.name ?? deployment.ext_id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {deployment.kind} · {deployment.match_reason.replaceAll("_", " ")}
                            </p>
                          </div>
                          <Badge variant="outline" className={deployStatusClass(deployment.status)}>
                            {deployment.status ?? t("common.unknown")}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{fmtDate(deployment.created_at_utc)}</span>
                          <span>
                            {t("pages.pullRequests.detail.afterMerge", {
                              duration: fmtHours(deployment.lead_time_hours),
                            })}
                          </span>
                          <span className="font-mono">{shortSha(deployment.sha)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("pages.pullRequests.detail.noDeployments")} />
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t("pages.pullRequests.detail.incidents")}</h3>
                {pr.related_incidents?.length ? (
                  <div className="space-y-2">
                    {pr.related_incidents.slice(0, 8).map((incident) => (
                      <div
                        key={`${incident.source}:${incident.ext_id}`}
                        className="rounded-lg border p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="min-w-0 truncate font-medium">
                            {incident.title ?? incident.ext_id}
                          </p>
                          <Badge variant="outline" className={severityClass("critical")}>
                            {incident.severity ?? incident.state ?? t("pages.pullRequests.detail.incidentFallback")}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{incident.source}</span>
                          <span>{fmtDate(incident.opened_at_utc)}</span>
                          <span>
                            {t("pages.pullRequests.detail.afterMerge", {
                              duration: fmtHours(incident.hours_after_merge),
                            })}
                          </span>
                          {incident.mttr_hours != null ? (
                            <span>MTTR {fmtHours(incident.mttr_hours)}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("pages.pullRequests.detail.noIncidents")} />
                )}
              </div>

              <div className="grid gap-2 text-sm">
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted-foreground">
                    {t("pages.pullRequests.columns.author")}
                  </span>
                  <span>{pr.author ?? "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted-foreground">
                    {t("pages.pullRequests.columns.created")}
                  </span>
                  <span>{fmtDate(pr.created_at_utc)}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted-foreground">Merge SHA</span>
                  <span className="truncate font-mono text-xs">{pr.merge_commit_sha ?? "-"}</span>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">
                  {t("pages.pullRequests.detail.changedFiles")}
                </h3>
                {pr.files.length ? (
                  <div className="max-h-64 overflow-y-auto rounded-lg border">
                    {pr.files.slice(0, 80).map((file) => (
                      <div
                        key={file.path}
                        className="grid grid-cols-[1fr_auto] gap-3 border-b p-2 text-xs last:border-b-0"
                      >
                        <span className="truncate font-mono" title={file.path}>
                          {file.path}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          +{formatInt(file.additions)} -{formatInt(file.deletions)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("pages.pullRequests.detail.noFiles")} />
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t("pages.pullRequests.detail.timeline")}</h3>
                {pr.timeline.length ? (
                  <div className="space-y-3">
                    {pr.timeline.map((event, index) => (
                      <div
                        key={`${event.event_type}-${event.created_at_utc ?? index}-${event.title ?? ""}`}
                        className="grid grid-cols-[80px_1fr] gap-3 rounded-lg border p-3 text-sm"
                      >
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(event.created_at_utc)}
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{eventLabel(event, t)}</Badge>
                            {event.state ? <Badge variant="secondary">{event.state}</Badge> : null}
                            {event.conclusion ? (
                              <Badge variant="secondary">{event.conclusion}</Badge>
                            ) : null}
                          </div>
                          <p className="font-medium">{event.title ?? eventLabel(event, t)}</p>
                          {event.actor ? (
                            <p className="text-xs text-muted-foreground">
                              {t("pages.pullRequests.detail.by", {
                                defaultValue: "by {{actor}}",
                                actor: event.actor,
                              })}
                            </p>
                          ) : null}
                          {event.body ? (
                            <p className="max-h-24 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                              {event.body}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("pages.pullRequests.detail.noTimeline")} />
                )}
              </div>

              {pr.html_url ? (
                <Button asChild variant="outline">
                  <a href={pr.html_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    {t("pages.pullRequests.detail.openOnGithub", {
                      defaultValue: "Open on GitHub",
                    })}
                  </a>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DeterministicInsight({ insight }: { insight: PrInsight }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-3 p-4 text-left">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{insight.title}</span>
              <Badge variant="outline" className={severityClass(insight.severity)}>
                {t(`enums.severity.${insight.severity}`, { defaultValue: insight.severity })}
              </Badge>
              <Badge variant="secondary">{insight.category}</Badge>
              <Badge variant="outline">{insight.metric}</Badge>
            </div>
            <p className="pt-1 text-sm text-muted-foreground">
              {t("pages.pullRequests.deterministic.valueThreshold", {
                defaultValue: "{{value}} vs threshold {{threshold}}",
                value: insight.value.toFixed(1),
                threshold: insight.threshold.toFixed(1),
              })}
            </p>
          </div>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 pb-4 pt-3">
        <p className="text-sm">{insight.recommendation}</p>
        {insight.affected_prs.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {insight.affected_prs.map((pr) => (
              <Badge key={`${pr.repo_key}#${pr.number}`} variant="outline">
                {pr.repo_full_name || pr.repo_key}#{pr.number}
              </Badge>
            ))}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function JobStatusPanel({
  job,
  onRetry,
  onCancel,
}: {
  job: PrAiInsightJob | null;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!job) return null;
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {t(`enums.jobStatus.${job.status}`, { defaultValue: job.status })}
          </Badge>
          <Badge variant="outline">{job.engine}</Badge>
          <span className="text-muted-foreground">{job.analysis_type}</span>
        </div>
        <div className="flex gap-2">
          {active ? (
            <Button size="sm" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onRetry} disabled={active}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
      <div className="mt-2 grid gap-1 text-muted-foreground">
        <span>{t("pages.pullRequests.jobs.created", { date: fmtDate(job.created_at_utc) })}</span>
        {job.finished_at_utc ? (
          <span>{t("pages.pullRequests.jobs.finished", { date: fmtDate(job.finished_at_utc) })}</span>
        ) : null}
        {job.input_hash ? (
          <span className="truncate font-mono">
            {t("pages.pullRequests.aiIndexes.inputHash", { hash: job.input_hash })}
          </span>
        ) : null}
        {job.error ? <span className="text-destructive">{job.error}</span> : null}
      </div>
    </div>
  );
}

export default function PullRequestsPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const [author, setAuthor] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<PrDashboardRow | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);
  const [sort, setSort] = useState("created");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState("overview");
  const [engineId, setEngineId] = useState("");
  const [job, setJob] = useState<PrAiInsightJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [indexJob, setIndexJob] = useState<PrAiInsightJob | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [generatingIndexKey, setGeneratingIndexKey] = useState<string | null>(null);
  const [selectedPrKeys, setSelectedPrKeys] = useState<Set<string>>(new Set());
  const [batchType, setBatchType] = useState<PrIndexType>("business_value");
  const [batchScope, setBatchScope] = useState<PrAiBatchScope>("selected_prs");
  const [batchRepo, setBatchRepo] = useState(ALL_VALUE);
  const [batchOrg, setBatchOrg] = useState(ALL_VALUE);
  const [correlationConfig, setCorrelationConfig] = useState<PrSessionCorrelationConfig>(() =>
    normalizePrSessionCorrelationConfig(null),
  );
  const [savingCorrelationConfig, setSavingCorrelationConfig] = useState(false);
  const [correlationJob, setCorrelationJob] = useState<PrAiInsightJob | null>(null);
  const [correlationError, setCorrelationError] = useState<string | null>(null);
  const [generatingCorrelation, setGeneratingCorrelation] = useState(false);
  const [insightRepo, setInsightRepo] = useState(ALL_VALUE);
  const [insightOrg, setInsightOrg] = useState(ALL_VALUE);
  const [insightCategory, setInsightCategory] = useState(ALL_VALUE);
  const [insightSeverity, setInsightSeverity] = useState(ALL_VALUE);
  const [insightScope, setInsightScope] = useState(ALL_VALUE);
  const [insightPage, setInsightPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query);

  const bundlePath = useMemo(() => {
    const params = new URLSearchParams({
      grain: "week",
      page: String(page),
      page_size: String(pageSize),
      sort,
      direction,
    });
    if (author) params.set("author", author);
    if (debouncedQuery.trim()) params.set("query", debouncedQuery.trim());
    if (status !== "all") params.set("status", status);
    return withRange(`/api/pull-requests/bundle?${params.toString()}`, since, until);
  }, [author, debouncedQuery, direction, page, pageSize, since, sort, status, until]);
  const deterministicInsightsPath = useMemo(() => {
    const params = new URLSearchParams({
      grain: "week",
      page: String(insightPage),
      page_size: String(INSIGHTS_PAGE_SIZE),
    });
    if (author) params.set("author", author);
    if (debouncedQuery.trim()) params.set("query", debouncedQuery.trim());
    if (status !== "all") params.set("status", status);
    if (insightRepo !== ALL_VALUE) params.set("repo", insightRepo);
    if (insightOrg !== ALL_VALUE) params.set("org", insightOrg);
    if (insightCategory !== ALL_VALUE) params.set("category", insightCategory);
    if (insightSeverity !== ALL_VALUE) params.set("severity", insightSeverity);
    if (insightScope !== ALL_VALUE) params.set("scope", insightScope);
    return withRange(
      `/api/pull-requests/deterministic-insights?${params.toString()}`,
      since,
      until,
    );
  }, [
    author,
    debouncedQuery,
    insightCategory,
    insightOrg,
    insightPage,
    insightRepo,
    insightScope,
    insightSeverity,
    since,
    status,
    until,
  ]);
  const bundle = useApi<PrDashboardBundle>(bundlePath);
  const deterministicInsights = useApi<PrDeterministicInsightsPage>(deterministicInsightsPath);
  const engines = useApi<PrAiEngine[]>("/api/pull-requests/ai-engines");
  const settings = useApi<SettingsInfo>("/api/settings");

  const data = bundle.data && !Array.isArray(bundle.data) ? bundle.data : null;
  const availableEngines = Array.isArray(engines.data) ? engines.data : [];

  useEffect(() => {
    if (engineId || !availableEngines.length) return;
    const preferred = normalizeEngineId(settings.data?.pr_ai_default_engine);
    const preferredEngine = preferred ? availableEngines.find((e) => e.id === preferred) : null;
    setEngineId(
      preferredEngine?.id ??
        availableEngines.find((e) => e.available)?.id ??
        availableEngines[0]?.id ??
        "",
    );
  }, [availableEngines, engineId, settings.data?.pr_ai_default_engine]);

  useEffect(() => {
    const mode = settings.data?.pr_ai_default_generation_mode;
    if (!mode) return;
    const mapped =
      mode === "all_mine"
        ? "current_author"
        : mode === "repo" || mode === "org"
          ? mode
          : "selected_prs";
    setBatchScope(mapped);
  }, [settings.data?.pr_ai_default_generation_mode]);

  useEffect(() => {
    setCorrelationConfig(
      cloneCorrelationConfig(
        normalizePrSessionCorrelationConfig(
          settings.data?.pr_session_correlation_config ?? data?.session_correlation_config,
        ),
      ),
    );
  }, [data?.session_correlation_config, settings.data?.pr_session_correlation_config]);

  useEffect(() => {
    setInsightPage(0);
  }, [
    author,
    debouncedQuery,
    insightRepo,
    insightOrg,
    insightCategory,
    insightSeverity,
    insightScope,
    status,
  ]);

  useEffect(() => {
    setPage(0);
  }, [author, debouncedQuery, status]);

  const rows = data?.rows ?? [];
  const totalRows = data?.pagination?.total_rows ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const selectedRows = useMemo(() => {
    return (data?.rows ?? []).filter((row) => selectedPrKeys.has(prKey(row)));
  }, [data?.rows, selectedPrKeys]);

  const prOptions = useMemo(() => {
    return {
      repos: data?.filter_options?.repos ?? [],
      orgs: data?.filter_options?.orgs ?? [],
    };
  }, [data?.filter_options?.orgs, data?.filter_options?.repos]);

  const authorOptions = useMemo(
    () =>
      (data?.authors ?? []).map((authorOption) => ({
        value: authorOption.login,
        label: `${authorLabel(authorOption.login, t)} (${formatInt(authorOption.pull_requests)})`,
        description:
          authorOption.login === ALL_VALUE
            ? t("pages.pullRequests.filters.allAuthorsDescription", {
                defaultValue: "Show every synced PR author",
              })
            : authorOption.login,
      })),
    [data?.authors, t],
  );

  const engineOptions = useMemo(
    () =>
      availableEngines.map((engine) => ({
        value: engine.id,
        label: engine.available
          ? engine.label
          : t("pages.pullRequests.aiIndexes.notInstalled", { name: engine.label }),
        description: engine.notes,
      })),
    [availableEngines, t],
  );

  const batchScopeOptions = useMemo(
    () => [
      {
        value: "selected_prs",
        label: `${t("enums.batchScope.selected_prs")} (${formatInt(selectedRows.length)})`,
      },
      {
        value: "current_author",
        label: `${t("enums.batchScope.current_author")} (${authorLabel(
          data?.active_author ?? ALL_VALUE,
          t,
        )})`,
      },
      { value: "repo", label: t("enums.batchScope.repo") },
      { value: "org", label: t("enums.batchScope.org") },
    ],
    [data?.active_author, selectedRows.length, t],
  );

  const insightOptions = useMemo(() => {
    const options = deterministicInsights.data?.filter_options ?? data?.filter_options;
    return {
      repos: options?.repos ?? [],
      orgs: options?.orgs ?? [],
      categories: options?.insight_categories ?? [],
      severities: options?.insight_severities ?? [],
      scopes: options?.insight_scopes ?? [],
    };
  }, [data?.filter_options, deterministicInsights.data?.filter_options]);

  const insightOrgOptions = useMemo(
    () =>
      toOptions(
        insightOptions.orgs,
        t("pages.pullRequests.deterministic.allOrgs", { defaultValue: "All orgs" }),
      ),
    [insightOptions.orgs, t],
  );
  const insightRepoOptions = useMemo(
    () =>
      toOptions(
        insightOptions.repos,
        t("pages.pullRequests.deterministic.allRepos", { defaultValue: "All repos" }),
      ),
    [insightOptions.repos, t],
  );
  const insightCategoryOptions = useMemo(
    () =>
      toOptions(
        insightOptions.categories,
        t("pages.pullRequests.deterministic.allTypes", { defaultValue: "All types" }),
      ),
    [insightOptions.categories, t],
  );
  const insightSeverityOptions = useMemo(
    () =>
      toOptions(
        insightOptions.severities,
        t("pages.pullRequests.deterministic.allSeverities", { defaultValue: "All severities" }),
      ),
    [insightOptions.severities, t],
  );
  const insightScopeOptions = useMemo(
    () =>
      toOptions(
        insightOptions.scopes,
        t("pages.pullRequests.deterministic.allScopes", { defaultValue: "All scopes" }),
      ),
    [insightOptions.scopes, t],
  );
  const batchRepoOptions = useMemo(
    () =>
      toOptions(
        prOptions.repos,
        t("pages.pullRequests.aiIndexes.chooseRepo", { defaultValue: "Choose repo" }),
      ),
    [prOptions.repos, t],
  );
  const batchOrgOptions = useMemo(
    () =>
      toOptions(
        prOptions.orgs,
        t("pages.pullRequests.aiIndexes.chooseOrg", { defaultValue: "Choose org" }),
      ),
    [prOptions.orgs, t],
  );

  const pagedInsights = deterministicInsights.data?.rows ?? [];
  const insightTotalRows = deterministicInsights.data?.pagination?.total_rows ?? pagedInsights.length;
  const insightPageCount = Math.max(1, Math.ceil(insightTotalRows / INSIGHTS_PAGE_SIZE));
  const currentInsightPage = Math.min(insightPage, insightPageCount - 1);

  useEffect(() => {
    if (insightPage !== currentInsightPage) setInsightPage(currentInsightPage);
  }, [currentInsightPage, insightPage]);

  async function generateAiInsights() {
    setGenerating(true);
    setJobError(null);
    setJob(null);
    try {
      const result = await apiPost<PrAiInsightJob>("/api/pull-requests/ai-insights/jobs", {
        engine: engineId,
        author: author || data?.active_author,
        since,
        until,
        grain: "week",
      });
      setJob(result);
      const finalJob = await waitForAiJob(result);
      setJob(finalJob);
      if (finalJob.error) {
        setJobError(finalJob.error);
        toast.error(finalJob.error);
      } else {
        toast.success(t("pages.pullRequests.toast.aiInsightsGenerated"));
      }
    } catch (e) {
      const message = errorText(e);
      setJobError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }

  async function retryAiJob(
    current: PrAiInsightJob | null,
    setCurrent: Dispatch<SetStateAction<PrAiInsightJob | null>>,
    setError: Dispatch<SetStateAction<string | null>>,
  ) {
    if (!current) return;
    setError(null);
    try {
      const restarted = await apiPost<PrAiInsightJob>(
        `/api/pull-requests/ai-insights/jobs/${encodeURIComponent(current.id)}/retry`,
        {},
      );
      setCurrent(restarted);
      const finalJob = await waitForAiJob(restarted);
      setCurrent(finalJob);
      if (finalJob.error) {
        setError(finalJob.error);
        toast.error(finalJob.error);
      } else {
        toast.success(
          t("pages.pullRequests.toast.aiJobRetried", {
            defaultValue: "AI job retried successfully",
          }),
        );
        bundle.refetch();
        deterministicInsights.refetch();
      }
    } catch (e) {
      const message = errorText(e);
      setError(message);
      toast.error(message);
    }
  }

  async function cancelAiJob(
    current: PrAiInsightJob | null,
    setCurrent: Dispatch<SetStateAction<PrAiInsightJob | null>>,
    setError: Dispatch<SetStateAction<string | null>>,
  ) {
    if (!current) return;
    setError(null);
    try {
      const cancelled = await apiPost<PrAiInsightJob>(
        `/api/pull-requests/ai-insights/jobs/${encodeURIComponent(current.id)}/cancel`,
        {},
      );
      setCurrent(cancelled);
      toast.success(
        t("pages.pullRequests.toast.aiJobCancelled", {
          defaultValue: "AI job cancelled",
        }),
      );
    } catch (e) {
      const message = errorText(e);
      setError(message);
      toast.error(message);
    }
  }

  function togglePrSelection(row: PrDashboardRow) {
    const key = prKey(row);
    setSelectedPrKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectVisibleRows(checked: boolean) {
    setSelectedPrKeys((current) => {
      const next = new Set(current);
      for (const row of rows) {
        const key = prKey(row);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function toggleSort(nextSort: string) {
    setPage(0);
    if (sort === nextSort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(nextSort);
      setDirection(nextSort === "created" ? "desc" : "asc");
    }
  }

  function sortLabel(key: string): string {
    if (sort !== key) return "";
    return direction === "asc" ? " ascending" : " descending";
  }

  async function generatePrIndex(type: PrIndexType, row: PrDashboardRow) {
    const key = `${type}:${prKey(row)}`;
    setGeneratingIndexKey(key);
    setIndexError(null);
    setIndexJob(null);
    try {
      const result = await apiPost<PrAiInsightJob>("/api/pull-requests/ai-insights/jobs", {
        engine: engineId,
        analysis_type: type,
        scope: "single_pr",
        prs: [{ repo_key: row.repo_key, number: row.number }],
        author: author || data?.active_author,
        since,
        until,
        grain: "week",
      });
      setIndexJob(result);
      const finalJob = await waitForAiJob(result);
      setIndexJob(finalJob);
      if (finalJob.error) {
        setIndexError(finalJob.error);
        toast.error(finalJob.error);
      } else {
        await bundle.refetch();
        toast.success(
          t("pages.pullRequests.toast.aiIndexGeneratedForPr", {
            defaultValue: "{{name}} generated for PR #{{number}}",
            name: indexTitle(type, t),
            number: row.number,
          }),
        );
      }
    } catch (e) {
      const message = errorText(e);
      setIndexError(message);
      toast.error(message);
    } finally {
      setGeneratingIndexKey(null);
    }
  }

  async function generateBatchIndex() {
    const payload: Record<string, unknown> = {
      engine: engineId,
      analysis_type: batchType,
      scope: batchScope,
      author: author || data?.active_author,
      since,
      until,
      grain: "week",
    };
    if (batchScope === "selected_prs") {
      payload.prs = selectedRows.map((row) => ({ repo_key: row.repo_key, number: row.number }));
    }
    if (batchScope === "repo" && batchRepo !== ALL_VALUE) payload.repo = batchRepo;
    if (batchScope === "org" && batchOrg !== ALL_VALUE) payload.org = batchOrg;

    setGeneratingIndexKey(`${batchType}:batch`);
    setIndexError(null);
    setIndexJob(null);
    try {
      const result = await apiPost<PrAiInsightJob>("/api/pull-requests/ai-insights/jobs", payload);
      setIndexJob(result);
      const finalJob = await waitForAiJob(result);
      setIndexJob(finalJob);
      if (finalJob.error) {
        setIndexError(finalJob.error);
        toast.error(finalJob.error);
      } else {
        await bundle.refetch();
        toast.success(
          t("pages.pullRequests.toast.aiIndexBatchGenerated", {
            defaultValue: "{{name}} batch generated",
            name: indexShortTitle(batchType, t),
          }),
        );
      }
    } catch (e) {
      const message = errorText(e);
      setIndexError(message);
      toast.error(message);
    } finally {
      setGeneratingIndexKey(null);
    }
  }

  function patchCorrelationConfig(patch: Partial<PrSessionCorrelationConfig>) {
    setCorrelationConfig((current) => cloneCorrelationConfig({ ...current, ...patch }));
  }

  function patchCorrelationWeights(patch: Partial<PrSessionCorrelationConfig["weights"]>) {
    setCorrelationConfig((current) => ({
      ...current,
      weights: { ...current.weights, ...patch },
    }));
  }

  async function saveCorrelationConfig() {
    setSavingCorrelationConfig(true);
    setCorrelationError(null);
    try {
      await apiPost("/api/settings", { pr_session_correlation_config: correlationConfig });
      await settings.refetch();
      await bundle.refetch();
      toast.success(t("pages.pullRequests.sessionsPanel.saved"));
    } catch (e) {
      const message = errorText(e);
      setCorrelationError(message);
      toast.error(message);
    } finally {
      setSavingCorrelationConfig(false);
    }
  }

  async function generateSessionCorrelation() {
    const payload: Record<string, unknown> = {
      engine: engineId,
      analysis_type: "session_correlation",
      scope: batchScope,
      author: author || data?.active_author,
      since,
      until,
      grain: "week",
    };
    if (batchScope === "selected_prs") {
      payload.prs = selectedRows.map((row) => ({ repo_key: row.repo_key, number: row.number }));
    }
    if (batchScope === "repo" && batchRepo !== ALL_VALUE) payload.repo = batchRepo;
    if (batchScope === "org" && batchOrg !== ALL_VALUE) payload.org = batchOrg;

    setGeneratingCorrelation(true);
    setCorrelationError(null);
    setCorrelationJob(null);
    try {
      const result = await apiPost<PrAiInsightJob>("/api/pull-requests/ai-insights/jobs", payload);
      setCorrelationJob(result);
      const finalJob = await waitForAiJob(result);
      setCorrelationJob(finalJob);
      if (finalJob.error) {
        setCorrelationError(finalJob.error);
        toast.error(finalJob.error);
      } else {
        await bundle.refetch();
        toast.success(t("pages.pullRequests.sessionsPanel.generated"));
      }
    } catch (e) {
      const message = errorText(e);
      setCorrelationError(message);
      toast.error(message);
    } finally {
      setGeneratingCorrelation(false);
    }
  }

  if (bundle.error) return <ErrorBlock error={bundle.error} />;
  if (bundle.loading || !data) return <LoadingBlock />;

  const selectedEngine = availableEngines.find((e) => e.id === engineId);
  const allVisibleSelected =
    rows.length > 0 && rows.every((row) => selectedPrKeys.has(prKey(row)));
  const canGenerateIndex = Boolean(selectedEngine?.available && engineId);
  const correlatedPrCount = data.rows.filter((row) => row.session_correlations?.length).length;
  const aiSessionMatchCount = data.rows.reduce(
    (total, row) =>
      total + (row.session_correlations ?? []).filter((item) => item.mode === "ai").length,
    0,
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle
          title={t("pages.pullRequests.title")}
          description={t("pages.pullRequests.description")}
        />
        <div className="flex flex-wrap gap-2">
          <SearchableSelect
            label={t("pages.pullRequests.filters.author")}
            value={data.active_author}
            onValueChange={setAuthor}
            options={authorOptions}
            placeholder={t("pages.pullRequests.filters.authorPlaceholder")}
            className="min-w-56"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">
            <GitPullRequest className="size-4" />
            {t("pages.pullRequests.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="insights">
            <Sparkles className="size-4" />
            {t("pages.pullRequests.tabs.insights")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <StatTile label={t("pages.pullRequests.summary.aiAssisted")} value={formatInt(data.summary.ai_assisted)} />
            <StatTile label={t("pages.pullRequests.summary.open")} value={formatInt(data.summary.open)} active />
            <StatTile label={t("pages.pullRequests.summary.awaitingReview")} value={formatInt(data.summary.awaiting_review)} />
            <StatTile label={t("pages.pullRequests.summary.awaitingMerge")} value={formatInt(data.summary.awaiting_merge)} />
            <StatTile label={t("pages.pullRequests.summary.highReviewTime")} value={formatInt(data.summary.high_review_time)} />
            <StatTile label={t("pages.pullRequests.summary.merged")} value={formatInt(data.summary.merged)} />
            <StatTile label={t("pages.pullRequests.summary.closed")} value={formatInt(data.summary.closed)} />
            <StatTile label={t("pages.pullRequests.summary.noAiSignal")} value={formatInt(data.summary.no_ai_signal)} />
          </div>

          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>{t("pages.pullRequests.queue.title")}</CardTitle>
                  <CardDescription>
                    {t("pages.pullRequests.queue.description", { count: formatInt(totalRows) })}
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                    <Input
                      aria-label={t("pages.pullRequests.filters.searchLabel")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("pages.pullRequests.filters.searchPlaceholder")}
                      className="pl-8"
                    />
                  </div>
                  <SearchableSelect
                    label={t("pages.pullRequests.filters.status")}
                    value={status}
                    onValueChange={(value) => setStatus(value as StatusFilter)}
                    options={statusOptions(t)}
                    className="min-w-44"
                    leadingIcon={<Filter className="size-4" />}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rows.length ? (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label={t("pages.pullRequests.filters.selectVisible")}
                          checked={allVisibleSelected}
                          onChange={(event) => selectVisibleRows(event.target.checked)}
                          className="size-4 accent-primary"
                        />
                      </TableHead>
                      <TableHead>
                        <Button variant="ghost" size="sm" onClick={() => toggleSort("number")}>
                          {t("pages.pullRequests.columns.number")}
                          {sortLabel("number")}
                        </Button>
                      </TableHead>
                      <TableHead>
                        <Button variant="ghost" size="sm" onClick={() => toggleSort("title")}>
                          {t("pages.pullRequests.columns.pullRequest")}
                          {sortLabel("title")}
                        </Button>
                      </TableHead>
                      <TableHead>{t("pages.pullRequests.columns.sessions")}</TableHead>
                      <TableHead>{t("pages.pullRequests.columns.businessValue")}</TableHead>
                      <TableHead>{t("pages.pullRequests.columns.aiMaturity")}</TableHead>
                      <TableHead>{t("pages.pullRequests.columns.author")}</TableHead>
                      <TableHead className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggleSort("size")}>
                          {t("pages.pullRequests.columns.size")}
                          {sortLabel("size")}
                        </Button>
                      </TableHead>
                      <TableHead className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggleSort("review_wait")}>
                          {t("pages.pullRequests.columns.reviewWait")}
                          {sortLabel("review_wait")}
                        </Button>
                      </TableHead>
                      <TableHead>
                        <Button variant="ghost" size="sm" onClick={() => toggleSort("created")}>
                          {t("pages.pullRequests.columns.created")}
                          {sortLabel("created")}
                        </Button>
                      </TableHead>
                      <TableHead>{t("pages.pullRequests.columns.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={`${row.repo_key}#${row.number}`}
                        className="cursor-pointer"
                        onClick={() => setSelected(row)}
                        tabIndex={0}
                        role="button"
                        aria-label={t("pages.pullRequests.row.open", { number: row.number })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelected(row);
                        }}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={t("pages.pullRequests.row.select", { number: row.number })}
                            checked={selectedPrKeys.has(prKey(row))}
                            onChange={() => togglePrSelection(row)}
                            onClick={(event) => event.stopPropagation()}
                            className="size-4 accent-primary"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">#{row.number}</TableCell>
                        <TableCell className="max-w-[420px]">
                          <div className="truncate font-medium" title={row.title ?? ""}>
                            {row.title ?? "-"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {repoLabel(row)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {topSessionCorrelation(row) ? (
                            <div className="min-w-28">
                              <Badge
                                variant="outline"
                                className={scoreClass(topSessionCorrelation(row)!.score)}
                              >
                                {confidencePct(topSessionCorrelation(row)!.confidence)}
                              </Badge>
                              <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                {t("pages.pullRequests.row.sessionCount", {
                                  count: (row.session_correlations ?? []).length,
                                  label: t("common.sessionLabel", {
                                    count: (row.session_correlations ?? []).length,
                                    defaultValue:
                                      (row.session_correlations ?? []).length === 1
                                        ? "session"
                                        : "sessions",
                                  }),
                                  mode: sessionModeLabel(topSessionCorrelation(row)!.mode, t),
                                })}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <IndexCell
                            type="business_value"
                            index={row.business_value_index}
                            loading={generatingIndexKey === `business_value:${prKey(row)}`}
                            disabled={!canGenerateIndex}
                            onGenerate={() => void generatePrIndex("business_value", row)}
                          />
                        </TableCell>
                        <TableCell>
                          <IndexCell
                            type="ai_maturity"
                            index={row.ai_maturity_index}
                            loading={generatingIndexKey === `ai_maturity:${prKey(row)}`}
                            disabled={!canGenerateIndex}
                            onGenerate={() => void generatePrIndex("ai_maturity", row)}
                          />
                        </TableCell>
                        <TableCell>{row.author ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div className="font-medium">{formatInt(row.size)}</div>
                          <div className="text-xs">
                            <span className="text-emerald-600 dark:text-emerald-300">
                              +{formatInt(row.additions)}
                            </span>{" "}
                            <span className="text-red-600 dark:text-red-300">
                              -{formatInt(row.deletions)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtHours(row.review_wait_hours)}
                        </TableCell>
                        <TableCell>{fmtDate(row.created_at_utc)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={statusClass(row.status_bucket)}>
                              {statusLabel(row.status_bucket, t)}
                            </Badge>
                            {row.ai_session_overlap ? (
                              <Bot
                                className="size-4 text-primary"
                                aria-label={t("pages.pullRequests.row.aiOverlap")}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {t("common.pageOfTotal", {
                      page: currentPage + 1,
                      total: pageCount,
                      count: formatInt(totalRows),
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 0}
                      onClick={() => setPage((value) => Math.max(0, value - 1))}
                    >
                      <ChevronLeft className="size-4" />
                      {t("common.previous")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= pageCount - 1}
                      onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                    >
                      {t("common.next")}
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
                </>
              ) : (
                <EmptyBlock
                  message={
                    debouncedQuery.trim() || status !== "all"
                      ? t("pages.pullRequests.queue.noFilterMatch")
                      : t("pages.pullRequests.queue.noRangeData")
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {data.tiles.map((tile) => (
              <Card key={tile.key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm text-muted-foreground">{tile.label}</CardTitle>
                    <Badge variant="outline" className={severityClass(tile.severity)}>
                      {tile.severity}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tabular-nums">{tile.value}</span>
                    {tile.unit ? (
                      <span className="text-sm text-muted-foreground">{tile.unit}</span>
                    ) : null}
                  </div>
                  <p className="pt-2 text-xs text-muted-foreground">{tile.detail}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader className="gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>{t("pages.pullRequests.deterministic.title")}</CardTitle>
                    <CardDescription>
                      {t("pages.pullRequests.deterministic.description", {
                        count: formatInt(insightTotalRows),
                      })}
                    </CardDescription>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <SearchableSelect
                      label={t("pages.pullRequests.deterministic.filters.org")}
                      value={insightOrg}
                      onValueChange={setInsightOrg}
                      options={insightOrgOptions}
                    />
                    <SearchableSelect
                      label={t("pages.pullRequests.deterministic.filters.repo")}
                      value={insightRepo}
                      onValueChange={setInsightRepo}
                      options={insightRepoOptions}
                    />
                    <SearchableSelect
                      label={t("pages.pullRequests.deterministic.filters.type")}
                      value={insightCategory}
                      onValueChange={setInsightCategory}
                      options={insightCategoryOptions}
                    />
                    <SearchableSelect
                      label={t("pages.pullRequests.deterministic.filters.severity")}
                      value={insightSeverity}
                      onValueChange={setInsightSeverity}
                      options={insightSeverityOptions}
                    />
                    <SearchableSelect
                      label={t("pages.pullRequests.deterministic.filters.scope")}
                      value={insightScope}
                      onValueChange={setInsightScope}
                      options={insightScopeOptions}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {deterministicInsights.loading && !deterministicInsights.data ? (
                  <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                    {t("pages.pullRequests.deterministic.loading")}
                  </div>
                ) : null}
                {deterministicInsights.error ? (
                  <div className="rounded-lg border border-destructive/40 p-4">
                    <ErrorBlock error={deterministicInsights.error} />
                    <Button
                      className="mt-3"
                      variant="outline"
                      onClick={() => deterministicInsights.refetch()}
                    >
                      {t("pages.pullRequests.deterministic.retry")}
                    </Button>
                  </div>
                ) : null}
                {pagedInsights.length ? (
                  pagedInsights.map((insight) => (
                    <DeterministicInsight key={insight.id} insight={insight} />
                  ))
                ) : !deterministicInsights.loading && !deterministicInsights.error ? (
                  <EmptyBlock message={t("pages.pullRequests.deterministic.empty")} />
                ) : null}
                <div className="flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
                  <span>
                    {t("common.pageOf", {
                      page: currentInsightPage + 1,
                      total: insightPageCount,
                    })}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setInsightPage((page) => Math.max(0, page - 1))}
                      disabled={currentInsightPage === 0}
                    >
                      <ChevronLeft className="size-4" />
                      {t("common.previous")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setInsightPage((page) => Math.min(insightPageCount - 1, page + 1))
                      }
                      disabled={currentInsightPage >= insightPageCount - 1}
                    >
                      {t("common.next")}
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t("pages.pullRequests.aiIndexes.title")}</CardTitle>
                  <CardDescription>
                    {t("pages.pullRequests.aiIndexes.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SearchableSelect
                    label={t("pages.pullRequests.aiIndexes.engine")}
                    value={engineId}
                    onValueChange={setEngineId}
                    options={engineOptions}
                    placeholder={t("pages.pullRequests.aiIndexes.enginePlaceholder")}
                    className="w-full"
                  />
                  {selectedEngine ? (
                    <p className="text-xs text-muted-foreground">{selectedEngine.notes}</p>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <SearchableSelect
                      label={t("pages.pullRequests.aiIndexes.type")}
                      value={batchType}
                      onValueChange={(value) => setBatchType(value as PrIndexType)}
                      options={indexTypeOptions(t)}
                    />
                    <SearchableSelect
                      label={t("pages.pullRequests.aiIndexes.scope")}
                      value={batchScope}
                      onValueChange={(value) => setBatchScope(value as PrAiBatchScope)}
                      options={batchScopeOptions}
                    />
                  </div>

                  {batchScope === "repo" ? (
                    <SearchableSelect
                      label={t("pages.pullRequests.aiIndexes.repo")}
                      value={batchRepo}
                      onValueChange={setBatchRepo}
                      options={batchRepoOptions}
                    />
                  ) : null}

                  {batchScope === "org" ? (
                    <SearchableSelect
                      label={t("pages.pullRequests.aiIndexes.org")}
                      value={batchOrg}
                      onValueChange={setBatchOrg}
                      options={batchOrgOptions}
                    />
                  ) : null}

                  <Button
                    className="w-full"
                    onClick={() => void generateBatchIndex()}
                    disabled={
                      generatingIndexKey != null ||
                      !canGenerateIndex ||
                      (batchScope === "selected_prs" && selectedRows.length === 0) ||
                      (batchScope === "repo" && batchRepo === ALL_VALUE) ||
                      (batchScope === "org" && batchOrg === ALL_VALUE)
                    }
                  >
                    <Sparkles className="size-4" />
                    {generatingIndexKey === `${batchType}:batch`
                      ? t("common.generating")
                      : t("pages.pullRequests.aiIndexes.generate", {
                          name: indexShortTitle(batchType, t),
                        })}
                  </Button>

                  {indexError ? <p className="text-sm text-destructive">{indexError}</p> : null}
                  <JobStatusPanel
                    job={indexJob}
                    onRetry={() => void retryAiJob(indexJob, setIndexJob, setIndexError)}
                    onCancel={() => void cancelAiJob(indexJob, setIndexJob, setIndexError)}
                  />
                  {indexJob?.result ? (
                    <div className="space-y-2 rounded-lg border p-3 text-sm">
                      <p>{indexJob.result.summary}</p>
                      {indexJob.result.indexes.length ? (
                        <div className="flex flex-wrap gap-2">
                          {indexJob.result.indexes.slice(0, 8).map((index) => (
                            <Badge
                              key={`${index.repo_key}#${index.pr_number}:${index.index_type}`}
                              variant="outline"
                              className={scoreClass(index.score)}
                            >
                              #{index.pr_number} {index.score}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("pages.pullRequests.sessionsPanel.title")}</CardTitle>
                  <CardDescription>
                    {t("pages.pullRequests.sessionsPanel.description", {
                      prs: formatInt(correlatedPrCount),
                      matches: formatInt(aiSessionMatchCount),
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={t("pages.pullRequests.sessionsPanel.enableDeterministic")}
                      checked={correlationConfig.enabled}
                      onChange={(event) =>
                        patchCorrelationConfig({ enabled: event.target.checked })
                      }
                      className="size-4 accent-primary"
                    />
                    {t("pages.pullRequests.sessionsPanel.enableDeterministic")}
                  </label>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="pr-session-before">
                        {t("pages.pullRequests.sessionsPanel.minutesBefore")}
                      </label>
                      <Input
                        id="pr-session-before"
                        aria-label={t("pages.pullRequests.sessionsPanel.minutesBeforeAria")}
                        type="number"
                        min={0}
                        max={10080}
                        value={correlationConfig.time_window_before_minutes}
                        onChange={(event) =>
                          patchCorrelationConfig({
                            time_window_before_minutes: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="pr-session-after">
                        {t("pages.pullRequests.sessionsPanel.minutesAfter")}
                      </label>
                      <Input
                        id="pr-session-after"
                        aria-label={t("pages.pullRequests.sessionsPanel.minutesAfterAria")}
                        type="number"
                        min={0}
                        max={10080}
                        value={correlationConfig.time_window_after_minutes}
                        onChange={(event) =>
                          patchCorrelationConfig({
                            time_window_after_minutes: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        className="text-xs text-muted-foreground"
                        htmlFor="pr-session-confidence"
                      >
                        {t("pages.pullRequests.sessionsPanel.minConfidence")}
                      </label>
                      <Input
                        id="pr-session-confidence"
                        aria-label={t("pages.pullRequests.sessionsPanel.minConfidenceAria")}
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={correlationConfig.min_confidence}
                        onChange={(event) =>
                          patchCorrelationConfig({ min_confidence: Number(event.target.value) })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="pr-session-max">
                        {t("pages.pullRequests.sessionsPanel.maxSessions")}
                      </label>
                      <Input
                        id="pr-session-max"
                        aria-label={t("pages.pullRequests.sessionsPanel.maxSessionsAria")}
                        type="number"
                        min={1}
                        max={25}
                        value={correlationConfig.max_sessions_per_pr}
                        onChange={(event) =>
                          patchCorrelationConfig({
                            max_sessions_per_pr: Number(event.target.value),
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 text-sm">
                    {CORRELATION_BOOLEAN_OPTIONS.map(([label, key]) => (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={correlationConfig[key]}
                          onChange={(event) =>
                            patchCorrelationConfig({
                              [key]: event.target.checked,
                            })
                          }
                          className="size-4 accent-primary"
                        />
                        {t(`enums.correlationSignal.${label}`, { defaultValue: label })}</label>
                    ))}
                  </div>

                  <details className="rounded-lg border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">{t("pages.pullRequests.sessionsPanel.signalWeights")}</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {CORRELATION_WEIGHT_OPTIONS.map(([label, key]) => (
                        <div key={key} className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t(`enums.correlationSignal.${label}`, { defaultValue: label })}</label>
                          <Input
                            aria-label={t("pages.pullRequests.sessionsPanel.weightAria", { defaultValue: "{{label}} weight", label: t(`enums.correlationSignal.${label}`, { defaultValue: label }) })}
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={correlationConfig.weights[key]}
                            onChange={(event) =>
                              patchCorrelationWeights({
                                [key]: Number(event.target.value),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </details>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void saveCorrelationConfig()}
                    disabled={savingCorrelationConfig}
                  >
                    <Save className="size-4" />
                    {savingCorrelationConfig
                      ? t("pages.pullRequests.sessionsPanel.saving")
                      : t("pages.pullRequests.sessionsPanel.saveConfig")}
                  </Button>

                  <Button
                    className="w-full"
                    onClick={() => void generateSessionCorrelation()}
                    disabled={
                      generatingCorrelation ||
                      !canGenerateIndex ||
                      (batchScope === "selected_prs" && selectedRows.length === 0) ||
                      (batchScope === "repo" && batchRepo === ALL_VALUE) ||
                      (batchScope === "org" && batchOrg === ALL_VALUE)
                    }
                  >
                    <Sparkles className="size-4" />
                    {generatingCorrelation
                      ? t("pages.pullRequests.sessionsPanel.correlating")
                      : t("pages.pullRequests.sessionsPanel.generateAi")}
                  </Button>

                  {correlationError ? (
                    <p className="text-sm text-destructive">{correlationError}</p>
                  ) : null}
                  <JobStatusPanel
                    job={correlationJob}
                    onRetry={() =>
                      void retryAiJob(correlationJob, setCorrelationJob, setCorrelationError)
                    }
                    onCancel={() =>
                      void cancelAiJob(correlationJob, setCorrelationJob, setCorrelationError)
                    }
                  />
                  {correlationJob?.result ? (
                    <div className="rounded-lg border p-3 text-sm">
                      <p>{correlationJob.result.summary}</p>
                      {correlationJob.result.session_correlations?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {correlationJob.result.session_correlations.slice(0, 8).map((item) => (
                            <Badge
                              key={`${item.repo_key}#${item.pr_number}:${item.provider}:${item.session_id}`}
                              variant="outline"
                            >
                              #{item.pr_number} {confidencePct(item.confidence)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("pages.pullRequests.agentInsights.title")}</CardTitle>
                  <CardDescription>
                    {t("pages.pullRequests.agentInsights.description", {
                      author: authorLabel(data.active_author, t),
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {t("pages.pullRequests.agentInsights.engine")}{" "}
                    <span className="font-medium text-foreground">
                      {selectedEngine?.label ?? t("common.notSelected")}
                    </span>
                    . {t("pages.pullRequests.agentInsights.changeEngine")}
                  </div>
                  <Button
                    className="w-full"
                    onClick={generateAiInsights}
                    disabled={generating || !selectedEngine?.available}
                  >
                    <Sparkles className="size-4" />
                    {generating
                      ? t("pages.pullRequests.agentInsights.generating")
                      : t("pages.pullRequests.agentInsights.generate")}
                  </Button>
                  {jobError ? <p className="text-sm text-destructive">{jobError}</p> : null}
                  <JobStatusPanel
                    job={job}
                    onRetry={() => void retryAiJob(job, setJob, setJobError)}
                    onCancel={() => void cancelAiJob(job, setJob, setJobError)}
                  />
                  {job?.result ? (
                    <div className="space-y-3 rounded-lg border p-3">
                      <p className="text-sm">{job.result.summary}</p>
                      {job.result.insights.map((insight, index) => (
                        <div
                          key={`${insight.title}-${index}`}
                          className="rounded-md bg-muted/50 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{insight.title}</span>
                            <Badge variant="outline" className={severityClass(insight.severity)}>
                              {insight.severity}
                            </Badge>
                          </div>
                          <p className="pt-1 text-xs text-muted-foreground">{insight.evidence}</p>
                          <p className="pt-2 text-sm">{insight.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("pages.pullRequests.ruleManagement.title")}</CardTitle>
                  <CardDescription>
                    {t("pages.pullRequests.ruleManagement.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/settings?section=rules">
                      <SlidersHorizontal className="size-4" />
                      {t("pages.pullRequests.ruleManagement.openSettings")}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <DetailSheet
        pr={selected}
        open={selected != null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
