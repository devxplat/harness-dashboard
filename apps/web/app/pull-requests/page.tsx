"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useRange } from "@/lib/range";
import { cn } from "@/lib/utils";
import type {
  PrAiEngine,
  PrAiIndex,
  PrAiInsightJob,
  PrDashboardBundle,
  PrDashboardRow,
  PrInsight,
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
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type StatusFilter = "all" | "awaiting_review" | "awaiting_merge" | "merged" | "closed";
type PrIndexType = "business_value" | "ai_maturity";
type PrAiBatchScope = "current_author" | "selected_prs" | "repo" | "org";

const ALL_VALUE = "__all";
const INSIGHTS_PAGE_SIZE = 8;
const JOB_POLL_MS = process.env.NODE_ENV === "test" ? 1 : 1000;
const JOB_POLL_LIMIT = 120;

function prKey(row: Pick<PrDashboardRow, "repo_key" | "number">): string {
  return `${row.repo_key}#${row.number}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  for (let i = 0; i < JOB_POLL_LIMIT && current.status === "running"; i += 1) {
    await sleep(JOB_POLL_MS);
    current = await apiGet<PrAiInsightJob>(
      `/api/pull-requests/ai-insights/jobs/${encodeURIComponent(initial.id)}`,
    );
  }
  if (current.status === "running") {
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

function statusLabel(status: string): string {
  switch (status) {
    case "awaiting_review":
      return "Awaiting review";
    case "awaiting_merge":
      return "Awaiting merge";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return status;
  }
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

function indexTitle(type: PrIndexType): string {
  return type === "business_value" ? "Business Value Index" : "AI Maturity";
}

function indexShortTitle(type: PrIndexType): string {
  return type === "business_value" ? "Business Value" : "AI Maturity";
}

function authorLabel(login: string): string {
  return login === ALL_VALUE ? "All contributors" : login;
}

function repoLabel(row: Pick<PrDashboardRow, "repo_full_name" | "repo_key">): string {
  return row.repo_full_name || row.repo_key;
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
        aria-label={`Generate ${indexTitle(type)}`}
      >
        <Sparkles className="size-3.5" />
        {loading ? "..." : index ? "Refresh" : "Generate"}
      </Button>
    </div>
  );
}

function eventLabel(event: PrTimelineEvent): string {
  switch (event.event_type) {
    case "created":
      return "Opened";
    case "review":
      return "Review";
    case "comment":
      return "Comment";
    case "check":
      return "Check";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return event.event_type;
  }
}

function findAuthor(input: string, data: PrDashboardBundle): string {
  const value = input.trim();
  if (!value) return "";
  if (value.toLowerCase() === "all contributors" || value === ALL_VALUE) return ALL_VALUE;
  const match = data.authors.find(
    (author) =>
      author.login.toLowerCase() === value.toLowerCase() ||
      authorLabel(author.login).toLowerCase() === value.toLowerCase(),
  );
  return match?.login ?? value;
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
  pr,
  open,
  onOpenChange,
}: {
  pr: PrDashboardRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-2xl">
        {pr ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="pr-8 leading-snug">
                #{pr.number} {pr.title ?? "Untitled pull request"}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span>{repoLabel(pr)}</span>
                <Badge variant="outline" className={statusClass(pr.status_bucket)}>
                  {statusLabel(pr.status_bucket)}
                </Badge>
                {pr.ai_session_overlap ? <Badge>AI overlap</Badge> : null}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Size</p>
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
                  <p className="text-xs text-muted-foreground">Files / reviews</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatInt(pr.changed_files)} / {formatInt(pr.review_count)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cycle time</p>
                  <p className="text-lg font-semibold tabular-nums">{fmtHours(pr.cycle_hours)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Review wait</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {fmtHours(pr.review_wait_hours)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Business Value Index", pr.business_value_index],
                  ["AI Maturity", pr.ai_maturity_index],
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
                      </div>
                    ) : (
                      <p className="pt-1 text-sm text-muted-foreground">Not generated yet</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Branches</h3>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <GitBranch className="size-4 text-muted-foreground" />
                  <Badge variant="outline">{pr.head_branch ?? "unknown"}</Badge>
                  <span className="text-muted-foreground">into</span>
                  <Badge variant="outline">{pr.base_branch ?? "unknown"}</Badge>
                </div>
              </div>

              <div className="grid gap-2 text-sm">
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted-foreground">Author</span>
                  <span>{pr.author ?? "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted-foreground">Created</span>
                  <span>{fmtDate(pr.created_at_utc)}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted-foreground">Merge SHA</span>
                  <span className="truncate font-mono text-xs">{pr.merge_commit_sha ?? "-"}</span>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Changed files</h3>
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
                  <EmptyBlock message="No changed-file list was synced for this PR yet." />
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Timeline</h3>
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
                            <Badge variant="outline">{eventLabel(event)}</Badge>
                            {event.state ? <Badge variant="secondary">{event.state}</Badge> : null}
                            {event.conclusion ? (
                              <Badge variant="secondary">{event.conclusion}</Badge>
                            ) : null}
                          </div>
                          <p className="font-medium">{event.title ?? eventLabel(event)}</p>
                          {event.actor ? (
                            <p className="text-xs text-muted-foreground">by {event.actor}</p>
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
                  <EmptyBlock message="No comments, checks, or reviews were synced for this PR yet." />
                )}
              </div>

              {pr.html_url ? (
                <Button asChild variant="outline">
                  <a href={pr.html_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Open on GitHub
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
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-3 p-4 text-left">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{insight.title}</span>
              <Badge variant="outline" className={severityClass(insight.severity)}>
                {insight.severity}
              </Badge>
              <Badge variant="secondary">{insight.category}</Badge>
              <Badge variant="outline">{insight.metric}</Badge>
            </div>
            <p className="pt-1 text-sm text-muted-foreground">
              {insight.value.toFixed(1)} vs threshold {insight.threshold.toFixed(1)}
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

export default function PullRequestsPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const [author, setAuthor] = useState("");
  const [authorDraft, setAuthorDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<PrDashboardRow | null>(null);
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
  const [insightRepo, setInsightRepo] = useState(ALL_VALUE);
  const [insightOrg, setInsightOrg] = useState(ALL_VALUE);
  const [insightCategory, setInsightCategory] = useState(ALL_VALUE);
  const [insightSeverity, setInsightSeverity] = useState(ALL_VALUE);
  const [insightScope, setInsightScope] = useState(ALL_VALUE);
  const [insightPage, setInsightPage] = useState(0);

  const bundlePath = useMemo(() => {
    let url = "/api/pull-requests/bundle?grain=week";
    if (author) url += `&author=${encodeURIComponent(author)}`;
    return withRange(url, since, until);
  }, [author, since, until]);
  const bundle = useApi<PrDashboardBundle>(bundlePath);
  const engines = useApi<PrAiEngine[]>("/api/pull-requests/ai-engines");
  const settings = useApi<SettingsInfo>("/api/settings");

  const data = bundle.data && !Array.isArray(bundle.data) ? bundle.data : null;
  const availableEngines = Array.isArray(engines.data) ? engines.data : [];

  useEffect(() => {
    if (!data) return;
    setAuthorDraft(authorLabel(data.active_author));
  }, [data?.active_author]);

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
    setInsightPage(0);
  }, [insightRepo, insightOrg, insightCategory, insightSeverity, insightScope]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      if (status !== "all" && row.status_bucket !== status) return false;
      if (!q) return true;
      return [
        row.repo_key,
        repoLabel(row),
        row.title ?? "",
        row.author ?? "",
        String(row.number),
        row.head_branch ?? "",
        row.base_branch ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data?.rows, query, status]);

  const selectedRows = useMemo(() => {
    return (data?.rows ?? []).filter((row) => selectedPrKeys.has(prKey(row)));
  }, [data?.rows, selectedPrKeys]);

  const prOptions = useMemo(() => {
    const repos = new Set<string>();
    const orgs = new Set<string>();
    for (const row of data?.rows ?? []) {
      if (row.repo_full_name) repos.add(row.repo_full_name);
      if (row.repo_owner) orgs.add(row.repo_owner);
    }
    return {
      repos: Array.from(repos).sort(),
      orgs: Array.from(orgs).sort(),
    };
  }, [data?.rows]);

  const insightOptions = useMemo(() => {
    const repos = new Set<string>();
    const orgs = new Set<string>();
    const categories = new Set<string>();
    const severities = new Set<string>();
    const scopes = new Set<string>();
    for (const insight of data?.deterministic_insights ?? []) {
      categories.add(insight.category);
      severities.add(insight.severity);
      scopes.add(insight.scope);
      for (const pr of insight.affected_prs) {
        if (pr.repo_full_name) repos.add(pr.repo_full_name);
        if (pr.repo_owner) orgs.add(pr.repo_owner);
      }
    }
    return {
      repos: Array.from(repos).sort(),
      orgs: Array.from(orgs).sort(),
      categories: Array.from(categories).sort(),
      severities: Array.from(severities).sort(),
      scopes: Array.from(scopes).sort(),
    };
  }, [data?.deterministic_insights]);

  const filteredInsights = useMemo(() => {
    return (data?.deterministic_insights ?? []).filter((insight) => {
      if (insightCategory !== ALL_VALUE && insight.category !== insightCategory) return false;
      if (insightSeverity !== ALL_VALUE && insight.severity !== insightSeverity) return false;
      if (insightScope !== ALL_VALUE && insight.scope !== insightScope) return false;
      if (
        insightRepo !== ALL_VALUE &&
        !insight.affected_prs.some((pr) => pr.repo_full_name === insightRepo)
      ) {
        return false;
      }
      if (
        insightOrg !== ALL_VALUE &&
        !insight.affected_prs.some((pr) => pr.repo_owner === insightOrg)
      ) {
        return false;
      }
      return true;
    });
  }, [
    data?.deterministic_insights,
    insightCategory,
    insightOrg,
    insightRepo,
    insightScope,
    insightSeverity,
  ]);

  const insightPageCount = Math.max(1, Math.ceil(filteredInsights.length / INSIGHTS_PAGE_SIZE));
  const currentInsightPage = Math.min(insightPage, insightPageCount - 1);
  const pagedInsights = filteredInsights.slice(
    currentInsightPage * INSIGHTS_PAGE_SIZE,
    currentInsightPage * INSIGHTS_PAGE_SIZE + INSIGHTS_PAGE_SIZE,
  );

  function applyAuthor() {
    if (!data) return;
    const nextAuthor = findAuthor(authorDraft, data);
    setAuthor(nextAuthor);
  }

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
      if (finalJob.error) setJobError(finalJob.error);
    } catch (e) {
      setJobError(String(e));
    } finally {
      setGenerating(false);
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
      for (const row of filteredRows) {
        const key = prKey(row);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
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
      if (finalJob.error) setIndexError(finalJob.error);
      else await bundle.refetch();
    } catch (e) {
      setIndexError(String(e));
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
      if (finalJob.error) setIndexError(finalJob.error);
      else await bundle.refetch();
    } catch (e) {
      setIndexError(String(e));
    } finally {
      setGeneratingIndexKey(null);
    }
  }

  if (bundle.error) return <ErrorBlock error={bundle.error} />;
  if (bundle.loading || !data) return <LoadingBlock />;

  const selectedEngine = availableEngines.find((e) => e.id === engineId);
  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selectedPrKeys.has(prKey(row)));
  const canGenerateIndex = Boolean(selectedEngine?.available && engineId);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle
          title={t("pages.pullRequests.title")}
          description={t("pages.pullRequests.description")}
        />
        <div className="flex flex-wrap gap-2">
          <div className="flex min-w-0 flex-1 gap-2 sm:flex-none">
            <div className="min-w-56 flex-1 sm:flex-none">
              <Input
                aria-label="PR author autocomplete"
                list="pr-author-options"
                value={authorDraft}
                onChange={(event) => setAuthorDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyAuthor();
                }}
                placeholder="Author or All contributors"
              />
              <datalist id="pr-author-options">
                {data.authors.map((authorOption) => (
                  <option key={authorOption.login} value={authorLabel(authorOption.login)}>
                    {authorOption.login} ({formatInt(authorOption.pull_requests)})
                  </option>
                ))}
              </datalist>
            </div>
            <Button variant="outline" onClick={applyAuthor}>
              Apply
            </Button>
          </div>
          <Select
            value={data.active_author}
            onValueChange={(value) => {
              setAuthor(value);
              setAuthorDraft(authorLabel(value));
            }}
          >
            <SelectTrigger aria-label="PR author" className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.authors.map((a) => (
                <SelectItem key={a.login} value={a.login}>
                  {authorLabel(a.login)} ({formatInt(a.pull_requests)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">
            <GitPullRequest className="size-4" />
            PR Overview
          </TabsTrigger>
          <TabsTrigger value="insights">
            <Sparkles className="size-4" />
            PR AI Insights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <StatTile label="AI-assisted" value={formatInt(data.summary.ai_assisted)} />
            <StatTile label="Open" value={formatInt(data.summary.open)} active />
            <StatTile label="Awaiting review" value={formatInt(data.summary.awaiting_review)} />
            <StatTile label="Awaiting merge" value={formatInt(data.summary.awaiting_merge)} />
            <StatTile label="High review time" value={formatInt(data.summary.high_review_time)} />
            <StatTile label="Merged" value={formatInt(data.summary.merged)} />
            <StatTile label="Closed" value={formatInt(data.summary.closed)} />
            <StatTile label="No AI signal" value={formatInt(data.summary.no_ai_signal)} />
          </div>

          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>Pull request queue</CardTitle>
                  <CardDescription>
                    {formatInt(filteredRows.length)} PRs in the selected date range
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                    <Input
                      aria-label="Search pull requests"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search PRs"
                      className="pl-8"
                    />
                  </div>
                  <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                    <SelectTrigger aria-label="PR status" className="min-w-44">
                      <Filter className="size-4" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="awaiting_review">Awaiting review</SelectItem>
                      <SelectItem value="awaiting_merge">Awaiting merge</SelectItem>
                      <SelectItem value="merged">Merged</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredRows.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select visible pull requests"
                          checked={allVisibleSelected}
                          onChange={(event) => selectVisibleRows(event.target.checked)}
                          className="size-4 accent-primary"
                        />
                      </TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Pull request</TableHead>
                      <TableHead>Business Value</TableHead>
                      <TableHead>AI Maturity</TableHead>
                      <TableHead>Author</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Review wait</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow
                        key={`${row.repo_key}#${row.number}`}
                        className="cursor-pointer"
                        onClick={() => setSelected(row)}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open PR ${row.number}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelected(row);
                        }}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Select PR ${row.number}`}
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
                              {statusLabel(row.status_bucket)}
                            </Badge>
                            {row.ai_session_overlap ? (
                              <Bot className="size-4 text-primary" aria-label="AI overlap" />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message="No pull requests match the selected filters." />
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
                    <CardTitle>Deterministic rules</CardTitle>
                    <CardDescription>
                      {formatInt(filteredInsights.length)} insights from local, configurable rules.
                    </CardDescription>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <Select value={insightOrg} onValueChange={setInsightOrg}>
                      <SelectTrigger aria-label="Insight org">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>All orgs</SelectItem>
                        {insightOptions.orgs.map((org) => (
                          <SelectItem key={org} value={org}>
                            {org}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={insightRepo} onValueChange={setInsightRepo}>
                      <SelectTrigger aria-label="Insight repo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>All repos</SelectItem>
                        {insightOptions.repos.map((repo) => (
                          <SelectItem key={repo} value={repo}>
                            {repo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={insightCategory} onValueChange={setInsightCategory}>
                      <SelectTrigger aria-label="Insight type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>All types</SelectItem>
                        {insightOptions.categories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={insightSeverity} onValueChange={setInsightSeverity}>
                      <SelectTrigger aria-label="Insight severity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>All severities</SelectItem>
                        {insightOptions.severities.map((severity) => (
                          <SelectItem key={severity} value={severity}>
                            {severity}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={insightScope} onValueChange={setInsightScope}>
                      <SelectTrigger aria-label="Insight scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>All scopes</SelectItem>
                        {insightOptions.scopes.map((scope) => (
                          <SelectItem key={scope} value={scope}>
                            {scope}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {pagedInsights.length ? (
                  pagedInsights.map((insight) => (
                    <DeterministicInsight key={insight.id} insight={insight} />
                  ))
                ) : (
                  <EmptyBlock message="No deterministic PR insights match the selected filters." />
                )}
                <div className="flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
                  <span>
                    Page {currentInsightPage + 1} of {insightPageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setInsightPage((page) => Math.max(0, page - 1))}
                      disabled={currentInsightPage === 0}
                    >
                      <ChevronLeft className="size-4" />
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setInsightPage((page) => Math.min(insightPageCount - 1, page + 1))
                      }
                      disabled={currentInsightPage >= insightPageCount - 1}
                    >
                      Next
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>PR AI indexes</CardTitle>
                  <CardDescription>
                    Generate Business Value or AI Maturity scores with your local CLI.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={engineId} onValueChange={setEngineId}>
                    <SelectTrigger aria-label="PR AI index engine" className="w-full">
                      <SelectValue placeholder="Select engine" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEngines.map((engine) => (
                        <SelectItem key={engine.id} value={engine.id}>
                          {engine.label} {engine.available ? "" : "(not installed)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <Select
                      value={batchType}
                      onValueChange={(value) => setBatchType(value as PrIndexType)}
                    >
                      <SelectTrigger aria-label="PR AI index type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="business_value">Business Value Index</SelectItem>
                        <SelectItem value="ai_maturity">AI Maturity</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={batchScope}
                      onValueChange={(value) => setBatchScope(value as PrAiBatchScope)}
                    >
                      <SelectTrigger aria-label="PR AI index scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="selected_prs">
                          Selected PRs ({formatInt(selectedRows.length)})
                        </SelectItem>
                        <SelectItem value="current_author">
                          Current author ({authorLabel(data.active_author)})
                        </SelectItem>
                        <SelectItem value="repo">Repo</SelectItem>
                        <SelectItem value="org">Org</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {batchScope === "repo" ? (
                    <Select value={batchRepo} onValueChange={setBatchRepo}>
                      <SelectTrigger aria-label="PR AI index repo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Choose repo</SelectItem>
                        {prOptions.repos.map((repo) => (
                          <SelectItem key={repo} value={repo}>
                            {repo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {batchScope === "org" ? (
                    <Select value={batchOrg} onValueChange={setBatchOrg}>
                      <SelectTrigger aria-label="PR AI index org">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Choose org</SelectItem>
                        {prOptions.orgs.map((org) => (
                          <SelectItem key={org} value={org}>
                            {org}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      ? "Generating..."
                      : `Generate ${indexShortTitle(batchType)}`}
                  </Button>

                  {indexError ? <p className="text-sm text-destructive">{indexError}</p> : null}
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
                  <CardTitle>AI Agent Insights</CardTitle>
                  <CardDescription>
                    Runs on demand for {authorLabel(data.active_author)} using the selected date
                    range.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={engineId} onValueChange={setEngineId}>
                    <SelectTrigger aria-label="AI insight engine" className="w-full">
                      <SelectValue placeholder="Select engine" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEngines.map((engine) => (
                        <SelectItem key={engine.id} value={engine.id}>
                          {engine.label} {engine.available ? "" : "(not installed)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedEngine ? (
                    <p className="text-xs text-muted-foreground">{selectedEngine.notes}</p>
                  ) : null}
                  <Button
                    className="w-full"
                    onClick={generateAiInsights}
                    disabled={generating || !selectedEngine?.available}
                  >
                    <Sparkles className="size-4" />
                    {generating ? "Generating..." : "Generate AI Insights"}
                  </Button>
                  {jobError ? <p className="text-sm text-destructive">{jobError}</p> : null}
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
                  <CardTitle>Rule management</CardTitle>
                  <CardDescription>
                    Rules are managed in Settings so they can be reused and audited.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/settings?section=rules">
                      <SlidersHorizontal className="size-4" />
                      Open PR Rules settings
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
