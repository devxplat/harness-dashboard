"use client";

import {
  DoraLeadTimeTrendChart,
  DeploymentTimelineChart,
  DoraTrendChart,
  LeadTimeDistributionChart,
  PrCycleTimeChart,
  PrSizeHistogramChart,
} from "@/components/charts/insight-charts";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { withRange } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { DoraBundle, DoraMetric, IncidentDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type Grain = "day" | "week" | "month";

function formatValue(m: DoraMetric): string {
  if (m.value === null) return "-";
  return Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(1);
}

function formatHours(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function formatRate(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${Math.round(value)}%`;
}

function num1(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

const BANDS = ["elite", "high", "medium", "low"] as const;

function bandColor(b: string | null): string {
  switch (b) {
    case "elite":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "high":
      return "border-sky-500/40 text-sky-600 dark:text-sky-400";
    case "medium":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "low":
      return "border-red-500/40 text-red-600 dark:text-red-400";
    default:
      return "border-muted text-muted-foreground";
  }
}

function bandFill(b: string): string {
  switch (b) {
    case "elite":
      return "bg-emerald-500";
    case "high":
      return "bg-sky-500";
    case "medium":
      return "bg-amber-500";
    case "low":
      return "bg-red-500";
    default:
      return "bg-muted";
  }
}

function MetricCard({ m }: { m: DoraMetric }) {
  const { t } = useTranslation();
  const available = m.value !== null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle>
        <div className="flex items-center gap-1.5">
          {m.band ? (
            <Badge variant="outline" className={cn("text-[10px] capitalize", bandColor(m.band))}>
              {m.band}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              m.exact
                ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                : "border-amber-500/40 text-amber-600 dark:text-amber-400",
            )}
            title={
              m.exact ? t("pages.dora.exactTitle") : t("pages.dora.estimatedTitle")
            }
          >
            {m.exact ? t("pages.dora.exact") : t("pages.dora.approx")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-3xl font-semibold tabular-nums",
              available ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {formatValue(m)}
          </span>
          {available ? <span className="text-sm text-muted-foreground">{m.unit}</span> : null}
        </div>
        <p className="pt-2 text-xs text-muted-foreground">{m.detail}</p>
        {m.band_target ? (
          <div className="pt-2">
            <div className="flex gap-0.5" aria-hidden>
              {BANDS.map((seg) => (
                <div
                  key={seg}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    m.band === seg ? bandFill(seg) : "bg-muted",
                  )}
                />
              ))}
            </div>
            <p className="pt-1 text-[11px] text-muted-foreground/80">{m.band_target}</p>
          </div>
        ) : null}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {t("pages.dora.source", { source: m.source })}
        </p>
      </CardContent>
    </Card>
  );
}

export default function DoraPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const [grain, setGrain] = useState<Grain>("week");
  const { data, error, loading } = useApi<DoraBundle>(
    withRange(`/api/dora/bundle?grain=${grain}`, since, until),
  );
  const { data: incidentsData } = useApi<IncidentDto[]>(withRange("/api/incidents", since, until));
  const incidents = Array.isArray(incidentsData) ? incidentsData : [];

  if (error) return <ErrorBlock error={error} />;
  const bundle = data && !Array.isArray(data) ? data : null;
  if (loading || !bundle) return <LoadingBlock />;

  const empty =
    bundle.metrics.length === 0 &&
    bundle.trends.length === 0 &&
    bundle.leadTimeDistribution.every((b) => b.pull_requests === 0) &&
    bundle.deploymentTimeline.length === 0;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle
          title={t("pages.dora.title")}
          description={t("pages.dora.description")}
        />
        <div className="flex gap-1" role="group" aria-label={t("pages.dora.grain")}>
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

      {empty ? <EmptyBlock message={t("pages.dora.noData")} /> : null}

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">{t("pages.dora.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="trends">{t("pages.dora.trends")}</TabsTrigger>
          <TabsTrigger value="prs">{t("pages.dora.prs")}</TabsTrigger>
          <TabsTrigger value="deployments">{t("pages.dora.deployments")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {bundle.metrics.length === 0 ? (
            <EmptyBlock message={t("pages.dora.noMetrics")} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bundle.metrics.map((m) => (
                <MetricCard key={m.key} m={m} />
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.repoComparison")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.repoComparison.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.dora.repo")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.commits")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.deploys")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.prs")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.lead")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.failureProxy")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundle.repoComparison.slice(0, 50).map((r) => (
                      <TableRow key={r.repo_key}>
                        <TableCell className="max-w-[320px] truncate" title={r.repo_key}>
                          {r.repo_key}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(r.commits)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(r.deploys)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(r.pr_count)}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({formatInt(r.merged_pr_count)} {t("pages.dora.merged")})
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatHours(r.avg_lead_hours)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(r.change_failure_rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.dora.noRepoComparison")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.throughput")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.trends.length ? (
                <DoraTrendChart data={bundle.trends} />
              ) : (
                <EmptyBlock message={t("pages.dora.noTrendData")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.leadTimeTrend")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.trends.some((tr) => tr.avg_lead_hours != null) ? (
                <DoraLeadTimeTrendChart data={bundle.trends} />
              ) : (
                <EmptyBlock message={t("pages.dora.noLeadTime")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.trendRows")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.trends.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.dora.period")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.commits")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.deploys")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.lead")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.failureProxy")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundle.trends.map((tr) => (
                      <TableRow key={tr.period}>
                        <TableCell className="font-mono text-xs">{tr.period}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(tr.commits)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(tr.deploys)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(tr.avg_lead_hours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(tr.change_failure_rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.dora.noTrendRows")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.prLeadTime")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.leadTimeDistribution.some((b) => b.pull_requests > 0) ? (
                <LeadTimeDistributionChart data={bundle.leadTimeDistribution} />
              ) : (
                <EmptyBlock message={t("pages.dora.noLeadTime")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.prCycleTime")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.prCycleTime.length ? (
                <>
                  <PrCycleTimeChart data={bundle.prCycleTime.slice(0, 12)} />
                  <p className="pt-2 text-xs text-muted-foreground">
                    {t("pages.dora.prCycleTimeNote")}
                  </p>
                </>
              ) : (
                <EmptyBlock message={t("pages.dora.noPrTimestamps")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.prSize")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.prSizeDistribution.some((b) => b.pull_requests > 0) ? (
                <>
                  <PrSizeHistogramChart data={bundle.prSizeDistribution} />
                  <div className="grid grid-cols-2 gap-3 pt-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">{t("pages.dora.medianChurn")}</p>
                      <p className="tabular-nums">{formatInt(bundle.prChurnSummary.medianChurn)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("pages.dora.p90Churn")}</p>
                      <p className="tabular-nums">{formatInt(bundle.prChurnSummary.p90Churn)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("pages.dora.avgFiles")}</p>
                      <p className="tabular-nums">{num1(bundle.prChurnSummary.avgChangedFiles)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("pages.dora.reworkProxy")}</p>
                      <p className="tabular-nums">{formatRate(bundle.prChurnSummary.reworkProxyPct)}</p>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyBlock message={t("pages.dora.noPrs")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.prComparison")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.repoComparison.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.dora.repo")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.prs")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.merged")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.lead")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.aiOverlap")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundle.repoComparison.slice(0, 50).map((r) => (
                      <TableRow key={r.repo_key}>
                        <TableCell className="max-w-[320px] truncate" title={r.repo_key}>
                          {r.repo_key}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(r.pr_count)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(r.merged_pr_count)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatHours(r.avg_lead_hours)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.ai_overlap_prs ? <Badge>{formatInt(r.ai_overlap_prs)}</Badge> : "0"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.dora.noRepoComparison")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deployments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.deployTimeline")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.deploymentTimeline.length ? (
                <DeploymentTimelineChart data={bundle.deploymentTimeline} />
              ) : (
                <EmptyBlock message={t("pages.dora.noDeployments")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.deployRows")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.repoComparison.some((r) => r.deploys > 0) ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.dora.repo")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.deploys")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.failureProxy")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.commits")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundle.repoComparison
                      .filter((r) => r.deploys > 0)
                      .slice(0, 50)
                      .map((r) => (
                        <TableRow key={r.repo_key}>
                          <TableCell className="max-w-[320px] truncate" title={r.repo_key}>
                            {r.repo_key}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(r.deploys)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatRate(r.change_failure_rate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(r.commits)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.dora.noDeployments")} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pages.dora.incidents")}</CardTitle>
            </CardHeader>
            <CardContent>
              {incidents.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.dora.opened")}</TableHead>
                      <TableHead>{t("pages.dora.incidentTitle")}</TableHead>
                      <TableHead>{t("pages.dora.severity")}</TableHead>
                      <TableHead>{t("pages.dora.state")}</TableHead>
                      <TableHead className="text-right">{t("pages.dora.mttr")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incidents.slice(0, 50).map((i) => (
                      <TableRow key={`${i.source}:${i.ext_id}`}>
                        <TableCell className="tabular-nums">
                          {i.opened_at_utc?.slice(0, 10) ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[320px] truncate" title={i.title ?? ""}>
                          {i.title ?? "—"}
                        </TableCell>
                        <TableCell className="capitalize">{i.severity ?? "—"}</TableCell>
                        <TableCell className="capitalize">{i.state ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(i.mttrHours)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message={t("pages.dora.noIncidents")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        {t("pages.dora.incidentNote")}
      </p>
    </>
  );
}
