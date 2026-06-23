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

function RoiTable({ rows }: { rows: AiRoiByGroupRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{rows[0]?.kind === "project" ? "Project" : "Provider"}</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Commits</TableHead>
          <TableHead className="text-right">Lines</TableHead>
          <TableHead className="text-right">$ / commit</TableHead>
          <TableHead className="text-right">$ / 1k lines</TableHead>
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
    return <EmptyBlock message="No discovered AI providers. Configure sources in Settings." />;
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
        <EmptyBlock message="No AI-impact data yet. Scan AI sessions and commits (and optionally connect GitHub) first." />
      ) : null}

      {/* DX-Core-4-style scorecard: Utilization / Impact / Cost / Net value */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Utilization"
          value={pctText(b.adoption.pct_active_days)}
          hint={`${formatInt(b.adoption.active_days)} active days · ${formatInt(b.adoption.sessions)} sessions`}
        />
        <Stat
          label="AI code"
          value={pctText(b.lines.summary.ai_line_pct)}
          hint={`${formatInt(b.lines.summary.ai_lines)} of ${formatInt(b.lines.summary.total_lines)} lines`}
        />
        <Stat
          label="Cost"
          value={formatUSD(b.roi.cost_usd)}
          hint={b.roi.cost_usd == null ? "no priced usage" : b.roi.cost_estimated ? "estimated" : "reported"}
        />
        <Stat
          label="Net value"
          value={b.roi.cost_per_merged_pr == null ? "—" : `${formatUSD(b.roi.cost_per_merged_pr)} / PR`}
          hint={`${formatInt(b.roi.merged_prs)} merged PRs`}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="roi">ROI</TabsTrigger>
          <TabsTrigger value="correlation">Correlation</TabsTrigger>
          <TabsTrigger value="adoption">Adoption</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI vs by-hand lines</CardTitle>
            </CardHeader>
            <CardContent>
              {b.lines.daily.length ? (
                <AiLinesChart data={b.lines.daily} />
              ) : (
                <EmptyBlock message="No commit churn in range." />
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            AI lines = lines in AI-assisted commits (commit-level attribution, not per-line
            provenance).
          </p>
        </TabsContent>

        <TabsContent value="roi" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cost by provider</CardTitle>
            </CardHeader>
            <CardContent>
              {b.roi.by_provider.length ? (
                <RoiTable rows={b.roi.by_provider} />
              ) : (
                <EmptyBlock message="No priced AI usage in range." />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivery by project</CardTitle>
            </CardHeader>
            <CardContent>
              {b.roi.by_project.length ? (
                <RoiTable rows={b.roi.by_project} />
              ) : (
                <EmptyBlock message="No commits in range." />
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Cost is per provider/model and not attributable per repo, so project rows show delivery
            only.
          </p>
        </TabsContent>

        <TabsContent value="correlation" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Usage ↔ commits"
              value={rText(b.correlation.coeffs.usage_vs_commits)}
              hint={prev?.usage_vs_commits == null ? undefined : `prev ${rText(prev.usage_vs_commits)}`}
            />
            <Stat
              label="Usage ↔ merged PRs"
              value={rText(b.correlation.coeffs.usage_vs_merged_prs)}
              hint={
                prev?.usage_vs_merged_prs == null ? undefined : `prev ${rText(prev.usage_vs_merged_prs)}`
              }
            />
            <Stat
              label="Tokens ↔ lead time"
              value={rText(b.correlation.coeffs.tokens_vs_lead_hours)}
              hint={
                prev?.tokens_vs_lead_hours == null ? undefined : `prev ${rText(prev.tokens_vs_lead_hours)}`
              }
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Daily usage vs delivery</CardTitle>
            </CardHeader>
            <CardContent>
              {b.correlation.series.length ? (
                <AiCorrelationChart data={b.correlation.series} />
              ) : (
                <EmptyBlock message="No daily series in range." />
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Pearson r over the daily series (vs the prior equal-length window). Directional, not
            causal.
          </p>
        </TabsContent>

        <TabsContent value="adoption" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Active days"
              value={formatInt(b.adoption.active_days)}
              hint={`of ${formatInt(b.adoption.span_days)} in span`}
            />
            <Stat
              label="Sessions / active day"
              value={num1(b.adoption.avg_sessions_per_active_day)}
            />
            <Stat label="Agent tasks" value={formatInt(b.adoption.agent_tasks)} />
            <Stat label="Assistant messages" value={formatInt(b.adoption.messages)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Daily sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {b.adoption.daily.length ? (
                <AiAdoptionChart data={b.adoption.daily} />
              ) : (
                <EmptyBlock message="No activity in range." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
