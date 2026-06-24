"use client";

import {
  AllocationDonutChart,
  AllocationTrendChart,
} from "@/components/charts/insight-charts";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
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
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { AllocationBundle } from "@/lib/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type Grain = "day" | "week" | "month";

export default function AllocationPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const [grain, setGrain] = useState<Grain>("week");
  const { data, error, loading } = useApi<AllocationBundle>(
    withRange(`/api/allocation?grain=${grain}`, since, until),
  );

  if (error) return <ErrorBlock error={error} />;
  const b = data && !Array.isArray(data) ? data : null;
  if (loading || !b) return <LoadingBlock />;

  const empty = b.totals.length === 0;
  const totalCommits = b.totals.reduce((s, r) => s + r.commits, 0);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle
          title={t("pages.allocation.title")}
          description={t("pages.allocation.description")}
        />
        <div className="flex gap-1" role="group" aria-label="Allocation grain">
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

      {empty ? <EmptyBlock message={t("pages.allocation.noCommits")} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("pages.allocation.byCategory")}</CardTitle>
          </CardHeader>
          <CardContent>
            {b.totals.length ? (
              <AllocationDonutChart data={b.totals} />
            ) : (
              <EmptyBlock message={t("pages.allocation.noCommits")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("pages.allocation.mixOverTime")}</CardTitle>
          </CardHeader>
          <CardContent>
            {b.periods.length ? (
              <AllocationTrendChart data={b.periods} />
            ) : (
              <EmptyBlock message={t("pages.allocation.noCommits")} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages.allocation.totals")}</CardTitle>
        </CardHeader>
        <CardContent>
          {b.totals.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.allocation.category")}</TableHead>
                  <TableHead className="text-right">{t("pages.allocation.commits")}</TableHead>
                  <TableHead className="text-right">{t("pages.allocation.share")}</TableHead>
                  <TableHead className="text-right">{t("pages.allocation.ai")}</TableHead>
                  <TableHead className="text-right">+/− lines</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.totals.map((r) => (
                  <TableRow key={r.category}>
                    <TableCell className="capitalize">{r.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(r.commits)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totalCommits ? Math.round((r.commits / totalCommits) * 100) : 0}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(r.aiCommits)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{formatInt(r.insertions)}
                      </span>{" "}
                      /{" "}
                      <span className="text-red-600 dark:text-red-400">
                        −{formatInt(r.deletions)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyBlock message={t("pages.allocation.noCommits")} />
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t("pages.allocation.categoryNote")}
      </p>
    </>
  );
}
