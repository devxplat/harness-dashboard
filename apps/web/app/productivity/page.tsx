"use client";

import { AiSplitChart } from "@/components/charts/ai-split-chart";
import {
  FocusTrendChart,
  PrImpactChart,
  ProductivityPeriodChart,
  WarmupBucketChart,
} from "@/components/charts/insight-charts";
import { ProductiveHoursHeatmap } from "@/components/charts/productive-hours-heatmap";
import { CommitsTable } from "@/components/commits-table";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { rangeQuery, withRange } from "@/lib/api";
import { formatDateShort, formatInt } from "@/lib/format";
import { aiTotals } from "@/lib/productivity-grid";
import { useRange } from "@/lib/range";
import type {
  CommitRow,
  DeploymentRow,
  FocusBlockRow,
  MeetingImpact,
  ProductivityBundle,
  ProductivityInsightsBundle,
  ProductivitySummary,
  PullRequestRow,
} from "@/lib/types";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type Grain = "day" | "week" | "month";

function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value < 60) return `${Math.round(value)}m`;
  const hours = value / 60;
  return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
}

function formatHours(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function StatCard({
  label,
  value,
  detail,
  estimated,
  estimatedLabel,
}: {
  label: string;
  value: string;
  detail?: string;
  estimated?: boolean;
  estimatedLabel?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {estimated ? (
          <Badge variant="outline" className="text-[10px]">
            {estimatedLabel}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {detail ? <p className="pt-1 text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function SummaryGrid({ summary, t }: { summary: ProductivitySummary; t: TFunction }) {
  const aiPct =
    summary.commits > 0 ? Math.round((summary.ai_commits / summary.commits) * 100) : 0;
  const estimatedLabel = t("pages.productivity.estimated");
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label={t("pages.productivity.commits")}
        value={formatInt(summary.commits)}
        detail={`${formatInt(summary.ai_commits)} ${t("pages.productivity.aiAssisted")} (${aiPct}%)`}
      />
      <StatCard
        label="Assistant messages"
        value={formatInt(summary.messages)}
        detail={`${formatInt(summary.pr_count)} PRs, ${formatInt(summary.merged_pr_count)} merged`}
      />
      <StatCard
        label="Focus and flow"
        value={formatMinutes(summary.focus_minutes)}
        detail={`${formatMinutes(summary.flow_minutes)} estimated flow time`}
        estimated
        estimatedLabel={estimatedLabel}
      />
      <StatCard
        label="Post-meeting warm-up"
        value={formatMinutes(summary.avg_warmup_minutes)}
        detail={`${formatMinutes(summary.meeting_minutes)} in busy meetings`}
        estimated
        estimatedLabel={estimatedLabel}
      />
    </div>
  );
}


function FocusBlocksTable({ blocks, t }: { blocks: FocusBlockRow[]; t: TFunction }) {
  const rows = [...blocks].sort((a, b) => b.duration_minutes - a.duration_minutes).slice(0, 10);
  if (!rows.length) return <EmptyBlock message={t("pages.productivity.noFocusBlocks")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("pages.productivity.started")}</TableHead>
          <TableHead>{t("pages.productivity.ended")}</TableHead>
          <TableHead className="text-right">{t("pages.productivity.activeSpan")}</TableHead>
          <TableHead className="text-right">{t("pages.productivity.events")}</TableHead>
          <TableHead>{t("pages.productivity.mode")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={`${b.started_at}:${b.ended_at}`}>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDateShort(b.started_at)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDateShort(b.ended_at)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMinutes(b.duration_minutes)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatInt(b.events)}{" "}
              <span className="text-xs text-muted-foreground">
                ({formatInt(b.commits)} commits, {formatInt(b.messages)} messages)
              </span>
            </TableCell>
            <TableCell>
              <Badge variant={b.flow ? "default" : "outline"}>
                {b.flow ? t("pages.productivity.flowMode") : t("pages.productivity.focusMode")}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MeetingImpactCards({ impact, t }: { impact: MeetingImpact | null; t: TFunction }) {
  if (!impact) {
    return <EmptyBlock message={t("pages.productivity.noCalendarOverlap")} />;
  }
  const pct = (during: number, free: number) =>
    Math.round((during / Math.max(1, during + free)) * 100);
  const estimatedLabel = t("pages.productivity.estimated");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatCard
        label={t("pages.productivity.assistantDuringMeetings")}
        value={`${pct(impact.during_messages, impact.free_messages)}%`}
        detail={`${formatInt(impact.during_messages)} of ${formatInt(
          impact.during_messages + impact.free_messages,
        )} messages`}
        estimated
        estimatedLabel={estimatedLabel}
      />
      <StatCard
        label={t("pages.productivity.commitsDuringMeetings")}
        value={`${pct(impact.during_commits, impact.free_commits)}%`}
        detail={`${formatInt(impact.during_commits)} of ${formatInt(
          impact.during_commits + impact.free_commits,
        )} commits`}
        estimated
        estimatedLabel={estimatedLabel}
      />
    </div>
  );
}

export default function ProductivityPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const [grain, setGrain] = useState<Grain>("day");
  const tz = -new Date().getTimezoneOffset();

  const insights = useApi<ProductivityInsightsBundle>(
    withRange(`/api/productivity/insights?tz_offset_min=${tz}&grain=${grain}`, since, until),
  );
  const prod = useApi<ProductivityBundle>(
    withRange(`/api/productivity?tz_offset_min=${tz}`, since, until),
  );
  const commits = useApi<CommitRow[]>(`/api/commits${rangeQuery(since, until)}`);
  const prs = useApi<PullRequestRow[]>(`/api/pull-requests${rangeQuery(since, until)}`);
  const deployments = useApi<DeploymentRow[]>(`/api/deployments${rangeQuery(since, until)}`);
  const meetings = useApi<MeetingImpact>(`/api/meetings/impact${rangeQuery(since, until)}`);

  if (insights.error) return <ErrorBlock error={insights.error} />;
  if (prod.error) return <ErrorBlock error={prod.error} />;
  if (commits.error) return <ErrorBlock error={commits.error} />;
  const data = insights.data && !Array.isArray(insights.data) ? insights.data : null;
  if (insights.loading || !data) return <LoadingBlock />;

  const legacyProd = prod.data && !Array.isArray(prod.data) ? prod.data : null;
  const ai = legacyProd ? aiTotals(legacyProd.aiByDay) : null;
  const meetingImpact =
    meetings.data && !Array.isArray(meetings.data) ? (meetings.data as MeetingImpact) : null;
  const hasActivity =
    data.summary.commits + data.summary.messages + data.summary.pr_count + data.summary.meeting_minutes > 0;
  const meetingHeavy = data.periods
    .filter((p) => p.meeting_minutes > 0)
    .sort((a, b) => b.meeting_minutes - a.meeting_minutes)
    .slice(0, 8);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle
          title={t("pages.productivity.title")}
          description={t("pages.productivity.description")}
        />
        <div className="flex gap-1" role="group" aria-label="Productivity grain">
          {(["day", "week", "month"] as Grain[]).map((g) => (
            <Button
              key={g}
              size="sm"
              variant={grain === g ? "default" : "outline"}
              aria-pressed={grain === g}
              onClick={() => setGrain(g)}
              className="capitalize"
            >
              {g}
            </Button>
          ))}
        </div>
      </div>

      {!hasActivity ? (
        <EmptyBlock message={t("pages.productivity.noData")} />
      ) : null}

      <SummaryGrid summary={data.summary} t={t} />

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="focus">Focus</TabsTrigger>
          <TabsTrigger value="calendar">Calendar Impact</TabsTrigger>
          <TabsTrigger value="prs">PR Impact</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid items-stretch gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>{t("pages.productivity.aiVsHand")}</CardTitle>
                {ai && ai.total > 0 ? (
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{Math.round(ai.pct * 100)}%</span>{" "}
                    {t("pages.productivity.aiAssisted")} - {formatInt(ai.ai)}/{formatInt(ai.total)} {t("pages.productivity.commits")}
                  </span>
                ) : null}
              </CardHeader>
              <CardContent>
                {!legacyProd ? (
                  <Skeleton className="h-64 w-full" />
                ) : legacyProd.aiByDay.length ? (
                  <AiSplitChart data={legacyProd.aiByDay} />
                ) : (
                  <EmptyBlock message={t("pages.productivity.noCommits")} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                {!legacyProd ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ProductiveHoursHeatmap data={legacyProd.hours} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.productivityTrend")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.periods.length ? (
                <ProductivityPeriodChart data={data.periods} />
              ) : (
                <EmptyBlock message={t("pages.productivity.noTrendData")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.commits")}</CardTitle>
            </CardHeader>
            <CardContent>
              {!commits.data ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : commits.data.length === 0 ? (
                <EmptyBlock message={t("pages.productivity.noCommits")} />
              ) : (
                <CommitsTable commits={commits.data} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="focus" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t("pages.productivity.focusTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.periods.length ? (
                  <FocusTrendChart data={data.periods} />
                ) : (
                  <EmptyBlock message={t("pages.productivity.noFocusTrend")} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("pages.productivity.warmupBuckets")}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.warmup.some((b) => b.count > 0) ? (
                  <WarmupBucketChart data={data.warmup} />
                ) : (
                  <EmptyBlock message={t("pages.productivity.noWarmup")} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.longestFocusBlocks")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FocusBlocksTable blocks={data.focusBlocks} t={t} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <MeetingImpactCards impact={meetingImpact} t={t} />

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.meetingVsProductive")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.periods.length ? (
                <FocusTrendChart data={data.periods} />
              ) : (
                <EmptyBlock message={t("pages.productivity.noCalendarTrend")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.meetingHeavy")}</CardTitle>
            </CardHeader>
            <CardContent>
              {meetingHeavy.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.meetings")}</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.focus")}</TableHead>
                      <TableHead className="text-right">Flow</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.avgWarmup")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meetingHeavy.map((p) => (
                      <TableRow key={p.period}>
                        <TableCell className="font-mono text-xs">{p.period}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMinutes(p.meeting_minutes)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinutes(p.focus_minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinutes(p.flow_minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMinutes(p.avg_warmup_minutes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.productivity.noBusyPeriods")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.repoPrComparison")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.prCorrelation.length ? (
                <PrImpactChart data={data.prCorrelation} />
              ) : (
                <EmptyBlock message={t("pages.productivity.noPrCorrelation")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.productivity.prImpactRows")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.prCorrelation.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repo</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.pullRequests")}</TableHead>
                      <TableHead className="text-right">Merged</TableHead>
                      <TableHead className="text-right">Lead</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.reviewWait")}</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.churn")}</TableHead>
                      <TableHead className="text-right">AI overlap</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.prCorrelation.slice(0, 50).map((p) => (
                      <TableRow key={p.repo_key}>
                        <TableCell className="max-w-[320px] truncate" title={p.repo_key}>
                          {p.repo_key}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(p.pr_count)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(p.merged_pr_count)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(p.avg_lead_hours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(p.avg_review_wait_hours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(p.churn)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.ai_overlap_prs ? <Badge>{formatInt(p.ai_overlap_prs)}</Badge> : "0"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.productivity.noSyncedPrs")} />
              )}
            </CardContent>
          </Card>

          {prs.data && prs.data.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("pages.productivity.pullRequests")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>{t("pages.productivity.status")}</TableHead>
                      <TableHead className="text-right">{t("pages.productivity.lines")}</TableHead>
                      <TableHead className="text-right">AI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prs.data.slice(0, 25).map((p) => (
                      <TableRow key={`${p.repo_key}#${p.number}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.html_url ? (
                            <a className="hover:underline" href={p.html_url} target="_blank" rel="noreferrer">
                              #{p.number}
                            </a>
                          ) : (
                            `#${p.number}`
                          )}
                        </TableCell>
                        <TableCell className="max-w-[360px] truncate" title={p.title ?? undefined}>
                          {p.title ?? "-"}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs capitalize text-muted-foreground">{p.state ?? "-"}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          <span className="text-emerald-600 dark:text-emerald-400">+{formatInt(p.additions)}</span>{" "}
                          <span className="text-rose-600 dark:text-rose-400">-{formatInt(p.deletions)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {p.ai_session_overlap ? <Badge>AI</Badge> : <span className="text-xs text-muted-foreground">-</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <EmptyBlock message={t("pages.productivity.noSyncedPrs")} />
          )}

          {deployments.data && deployments.data.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("pages.productivity.deployments")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.productivity.name")}</TableHead>
                      <TableHead>{t("pages.productivity.kind")}</TableHead>
                      <TableHead>{t("pages.productivity.status")}</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deployments.data.slice(0, 25).map((d) => (
                      <TableRow key={`${d.repo_key}:${d.kind}:${d.ext_id}`}>
                        <TableCell className="max-w-[320px] truncate">
                          {d.html_url ? (
                            <a className="hover:underline" href={d.html_url} target="_blank" rel="noreferrer">
                              {d.name ?? d.ext_id}
                            </a>
                          ) : (
                            (d.name ?? d.ext_id)
                          )}
                        </TableCell>
                        <TableCell className="text-xs capitalize text-muted-foreground">{d.kind}</TableCell>
                        <TableCell className="text-xs capitalize text-muted-foreground">{d.status ?? "-"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateShort(d.created_at_utc)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <EmptyBlock message={t("pages.productivity.noSyncedDeployments")} />
          )}
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        {t("pages.productivity.focusNote")}
      </p>
    </>
  );
}
