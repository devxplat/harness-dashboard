"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { useRange } from "@/lib/range";
import type { DoraMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Format a metric value for display; null → "—". Whole numbers drop the decimal. */
function formatValue(m: DoraMetric): string {
  if (m.value === null) return "—";
  return Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(1);
}

function MetricCard({ m }: { m: DoraMetric }) {
  const available = m.value !== null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{m.label}</CardTitle>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            m.exact
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
          )}
          title={m.exact ? "Computed exactly from the source" : "Approximated from available data"}
        >
          {m.exact ? "exact" : "approx"}
        </span>
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
        <p className="pt-1 text-[11px] text-muted-foreground/80">Source: {m.source}</p>
      </CardContent>
    </Card>
  );
}

export default function DoraPage() {
  const { since, until } = useRange();
  const { data, error, loading } = useApi<DoraMetric[]>(`/api/dora${rangeQuery(since, until)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle
        title="DORA"
        description="Individual, approximate DORA metrics from your configured sources. Each is labeled exact or approximated."
      />
      {data.length === 0 ? (
        <EmptyBlock message="No data yet — make some commits (and optionally connect GitHub) first." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((m) => (
            <MetricCard key={m.key} m={m} />
          ))}
        </div>
      )}
    </>
  );
}
