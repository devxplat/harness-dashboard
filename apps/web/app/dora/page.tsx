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
              m.exact ? "Computed directly from the source" : "Estimated from available local data"
            }
          >
            {m.exact ? "exact" : "approx"}
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
        <p className="pt-1 text-[11px] text-muted-foreground/80">Source: {m.source}</p>
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
        <div className="flex gap-1" role="group" aria-label="DORA grain">
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

      {empty ? <EmptyBlock message="No DORA data yet. Sync commits and optionally GitHub PRs/deployments first." /> : null}

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="prs">PRs</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {bundle.metrics.length === 0 ? (
            <EmptyBlock message="No DORA metrics in range." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bundle.metrics.map((m) => (
                <MetricCard key={m.key} m={m} />
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Repo comparison</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.repoComparison.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repo</TableHead>
                      <TableHead className="text-right">Commits</TableHead>
                      <TableHead className="text-right">Deploys</TableHead>
                      <TableHead className="text-right">PRs</TableHead>
                      <TableHead className="text-right">Lead</TableHead>
                      <TableHead className="text-right">Failure proxy</TableHead>
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
                            ({formatInt(r.merged_pr_count)} merged)
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
                <EmptyBlock message="No repo comparison rows in range." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Throughput and deploy frequency</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.trends.length ? (
                <DoraTrendChart data={bundle.trends} />
              ) : (
                <EmptyBlock message="No trend data in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lead time trend</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.trends.some((t) => t.avg_lead_hours != null) ? (
                <DoraLeadTimeTrendChart data={bundle.trends} />
              ) : (
                <EmptyBlock message="No merged PR lead-time samples in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trend rows</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.trends.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Commits</TableHead>
                      <TableHead className="text-right">Deploys</TableHead>
                      <TableHead className="text-right">Lead</TableHead>
                      <TableHead className="text-right">Failure proxy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundle.trends.map((t) => (
                      <TableRow key={t.period}>
                        <TableCell className="font-mono text-xs">{t.period}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(t.commits)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(t.deploys)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(t.avg_lead_hours)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(t.change_failure_rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyBlock message="No trend rows in range." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>PR lead-time distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.leadTimeDistribution.some((b) => b.pull_requests > 0) ? (
                <LeadTimeDistributionChart data={bundle.leadTimeDistribution} />
              ) : (
                <EmptyBlock message="No merged PR lead-time samples in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PR cycle-time breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.prCycleTime.length ? (
                <>
                  <PrCycleTimeChart data={bundle.prCycleTime.slice(0, 12)} />
                  <p className="pt-2 text-xs text-muted-foreground">
                    Pickup = open → first review, Review = first review → merge. Coding time isn’t
                    captured yet (needs feature-branch first-commit data).
                  </p>
                </>
              ) : (
                <EmptyBlock message="No merged PRs with timestamps in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PR size distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.prSizeDistribution.some((b) => b.pull_requests > 0) ? (
                <>
                  <PrSizeHistogramChart data={bundle.prSizeDistribution} />
                  <div className="grid grid-cols-2 gap-3 pt-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Median churn</p>
                      <p className="tabular-nums">{formatInt(bundle.prChurnSummary.medianChurn)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">p90 churn</p>
                      <p className="tabular-nums">{formatInt(bundle.prChurnSummary.p90Churn)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg files</p>
                      <p className="tabular-nums">{num1(bundle.prChurnSummary.avgChangedFiles)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rework proxy</p>
                      <p className="tabular-nums">{formatRate(bundle.prChurnSummary.reworkProxyPct)}</p>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyBlock message="No PRs in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PR comparison</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.repoComparison.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repo</TableHead>
                      <TableHead className="text-right">PRs</TableHead>
                      <TableHead className="text-right">Merged</TableHead>
                      <TableHead className="text-right">Lead</TableHead>
                      <TableHead className="text-right">AI overlap</TableHead>
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
                <EmptyBlock message="No PR comparison rows in range." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deployments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deployment timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.deploymentTimeline.length ? (
                <DeploymentTimelineChart data={bundle.deploymentTimeline} />
              ) : (
                <EmptyBlock message="No deployment data in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deployment rows by repo</CardTitle>
            </CardHeader>
            <CardContent>
              {bundle.repoComparison.some((r) => r.deploys > 0) ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repo</TableHead>
                      <TableHead className="text-right">Deploys</TableHead>
                      <TableHead className="text-right">Failure proxy</TableHead>
                      <TableHead className="text-right">Commits</TableHead>
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
                <EmptyBlock message="No deployment rows in range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Incidents</CardTitle>
            </CardHeader>
            <CardContent>
              {incidents.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opened</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">MTTR</TableHead>
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
                <EmptyBlock message="No incidents in range. Label GitHub issues “incident” to populate exact MTTR and change-failure rate." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Reverts/hotfixes and failed deploys are proxies; connect GitHub and label incident issues
        “incident” for exact MTTR and change-failure rate.
      </p>
    </>
  );
}
