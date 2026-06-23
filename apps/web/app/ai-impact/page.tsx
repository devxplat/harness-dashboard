"use client";

import {
  AiAdoptionChart,
  AiCorrelationChart,
  AiLinesChart,
} from "@/components/charts/insight-charts";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
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
import { formatInt, formatUSD } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { AiImpactBundle, AiRoiByGroupRow } from "@/lib/types";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

function pctText(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function rText(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(2);
}

function num1(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(1);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        {hint ? <p className="pt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function makeRoiColumns(t: TFunction) {
  return {
    project: t("pages.aiImpact.roi.project"),
    provider: t("pages.aiImpact.roi.provider"),
    cost: t("pages.aiImpact.roi.cost"),
    commits: t("pages.aiImpact.roi.commits"),
    lines: t("pages.aiImpact.roi.lines"),
    costPerCommit: t("pages.aiImpact.roi.costPerCommit"),
    costPer1kLines: t("pages.aiImpact.roi.costPer1kLines"),
  };
}

function RoiTable({ rows, t }: { rows: AiRoiByGroupRow[]; t: TFunction }) {
  const cols = useMemo(() => makeRoiColumns(t), [t]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{rows[0]?.kind === "project" ? cols.project : cols.provider}</TableHead>
          <TableHead className="text-right">{cols.cost}</TableHead>
          <TableHead className="text-right">{cols.commits}</TableHead>
          <TableHead className="text-right">{cols.lines}</TableHead>
          <TableHead className="text-right">{cols.costPerCommit}</TableHead>
          <TableHead className="text-right">{cols.costPer1kLines}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, 50).map((r) => (
          <TableRow key={`${r.kind}:${r.group}`}>
            <TableCell className="max-w-[280px] truncate" title={r.group}>
              {r.group}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.cost_usd == null ? "—" : formatUSD(r.cost_usd)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(r.commits)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(r.lines_shipped)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {r.cost_per_commit == null ? "—" : formatUSD(r.cost_per_commit)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.cost_per_1k_lines == null ? "—" : formatUSD(r.cost_per_1k_lines)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AiImpactPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  const { data, error, loading } = useApi<AiImpactBundle>(
    settingsLoaded && hasAvailableProviders
      ? withRange("/api/ai/impact-bundle", since, until, queryProviders)
      : null,
  );

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders)
    return <EmptyBlock message={t("pages.aiImpact.noData")} />;
  const b = data && !Array.isArray(data) ? data : null;
  if (loading || !b) return <LoadingBlock />;

  const empty =
    b.lines.summary.total_lines === 0 && b.adoption.active_days === 0 && b.roi.commits === 0;

  const prev = b.correlation.previous_period;

  return (
    <>
      <PageTitle
        title={t("pages.aiImpact.title")}
        description={t("pages.aiImpact.description")}
      />

      {empty ? (
        <EmptyBlock message={t("pages.aiImpact.noData")} />
      ) : null}

      {/* DX-Core-4-style scorecard: Utilization / Impact / Cost / Net value */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("pages.aiImpact.tab.utilization")}
          value={pctText(b.adoption.pct_active_days)}
          hint={`${formatInt(b.adoption.active_days)} ${t("pages.aiImpact.activeDays")} · ${formatInt(b.adoption.sessions)} ${t("pages.aiImpact.sessionsPerDay")}`}
        />
        <Stat
          label={t("pages.aiImpact.tab.aiCode")}
          value={pctText(b.lines.summary.ai_line_pct)}
          hint={`${formatInt(b.lines.summary.ai_lines)} of ${formatInt(b.lines.summary.total_lines)} lines`}
        />
        <Stat
          label={t("pages.aiImpact.tab.cost")}
          value={formatUSD(b.roi.cost_usd)}
          hint={b.roi.cost_usd == null ? t("pages.aiImpact.noCost") : b.roi.cost_estimated ? "estimated" : "reported"}
        />
        <Stat
          label={t("pages.aiImpact.tab.netValue")}
          value={b.roi.cost_per_merged_pr == null ? "—" : `${formatUSD(b.roi.cost_per_merged_pr)} / PR`}
          hint={`${formatInt(b.roi.merged_prs)} merged PRs`}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">{t("pages.aiImpact.tab.overview")}</TabsTrigger>
          <TabsTrigger value="roi">{t("pages.aiImpact.tab.roi")}</TabsTrigger>
          <TabsTrigger value="correlation">{t("pages.aiImpact.tab.correlation")}</TabsTrigger>
          <TabsTrigger value="adoption">{t("pages.aiImpact.tab.adoption")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.aiImpact.aiVsHandLines")}</CardTitle>
            </CardHeader>
            <CardContent>
              {b.lines.daily.length ? (
                <AiLinesChart data={b.lines.daily} />
              ) : (
                <EmptyBlock message={t("pages.aiImpact.noCommitChurn")} />
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            {t("pages.aiImpact.aiLinesNote")}
          </p>
        </TabsContent>

        <TabsContent value="roi" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.aiImpact.costByProvider")}</CardTitle>
            </CardHeader>
            <CardContent>
              {b.roi.by_provider.length ? (
                <RoiTable rows={b.roi.by_provider} t={t} />
              ) : (
                <EmptyBlock message={t("pages.aiImpact.noCost")} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.aiImpact.deliveryByProject")}</CardTitle>
            </CardHeader>
            <CardContent>
              {b.roi.by_project.length ? (
                <RoiTable rows={b.roi.by_project} t={t} />
              ) : (
                <EmptyBlock message={t("pages.aiImpact.noCommits")} />
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            {t("pages.aiImpact.costProjectNote")}
          </p>
        </TabsContent>

        <TabsContent value="correlation" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label={t("pages.aiImpact.usageCommits")}
              value={rText(b.correlation.coeffs.usage_vs_commits)}
              hint={prev?.usage_vs_commits == null ? undefined : `prev ${rText(prev.usage_vs_commits)}`}
            />
            <Stat
              label={t("pages.aiImpact.usagePrs")}
              value={rText(b.correlation.coeffs.usage_vs_merged_prs)}
              hint={
                prev?.usage_vs_merged_prs == null ? undefined : `prev ${rText(prev.usage_vs_merged_prs)}`
              }
            />
            <Stat
              label={t("pages.aiImpact.tokensLeadTime")}
              value={rText(b.correlation.coeffs.tokens_vs_lead_hours)}
              hint={
                prev?.tokens_vs_lead_hours == null ? undefined : `prev ${rText(prev.tokens_vs_lead_hours)}`
              }
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.aiImpact.dailyUsageDelivery")}</CardTitle>
            </CardHeader>
            <CardContent>
              {b.correlation.series.length ? (
                <AiCorrelationChart data={b.correlation.series} />
              ) : (
                <EmptyBlock message={t("pages.aiImpact.noDailySeries")} />
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            {t("pages.aiImpact.correlationNote")}
          </p>
        </TabsContent>

        <TabsContent value="adoption" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("pages.aiImpact.activeDays")}
              value={formatInt(b.adoption.active_days)}
              hint={`of ${formatInt(b.adoption.span_days)} ${t("pages.aiImpact.inSpan")}`}
            />
            <Stat
              label={t("pages.aiImpact.sessionsPerDay")}
              value={num1(b.adoption.avg_sessions_per_active_day)}
            />
            <Stat label={t("pages.aiImpact.agentTasks")} value={formatInt(b.adoption.agent_tasks)} />
            <Stat label={t("pages.aiImpact.assistantMessages")} value={formatInt(b.adoption.messages)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.aiImpact.dailySessions")}</CardTitle>
            </CardHeader>
            <CardContent>
              {b.adoption.daily.length ? (
                <AiAdoptionChart data={b.adoption.daily} />
              ) : (
                <EmptyBlock message={t("pages.aiImpact.noActivity")} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
