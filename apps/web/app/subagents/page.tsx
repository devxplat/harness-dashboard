"use client";

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
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { formatInt, formatTokens, formatUSD } from "@/lib/format";
import { useProviderFilter } from "@/lib/provider-filter";
import { useRange } from "@/lib/range";
import type { AgentGroupRow, SubagentsResponse } from "@/lib/types";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

function makeColumns(t: TFunction) {
  return {
    kind: t("pages.subagents.kind"),
    model: t("pages.subagents.model"),
    msgs: t("pages.subagents.msgs"),
    ioTokens: t("pages.subagents.ioTokens"),
    cost: t("pages.subagents.cost"),
    entrypoint: t("pages.subagents.entrypoint"),
  };
}

function AgentTable({
  rows,
  label,
  modelLabel,
  msgsLabel,
  ioTokensLabel,
  costLabel,
}: {
  rows: AgentGroupRow[];
  label: string;
  modelLabel: string;
  msgsLabel: string;
  ioTokensLabel: string;
  costLabel: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          <TableHead>{modelLabel}</TableHead>
          <TableHead className="text-right">{msgsLabel}</TableHead>
          <TableHead className="text-right">{ioTokensLabel}</TableHead>
          <TableHead className="text-right">{costLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.group}-${r.model ?? "none"}-${i}`}>
            <TableCell className="font-medium">{r.group}</TableCell>
            <TableCell className="font-mono text-xs">{r.model ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(r.messages)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokens(r.input_tokens + r.output_tokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatUSD(r.cost_usd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function SubagentsPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const { queryProviders, settingsLoaded, hasAvailableProviders, hasSelectedProviders } =
    useProviderFilter();
  const { data, error, loading } = useApi<SubagentsResponse>(
    settingsLoaded && hasAvailableProviders && hasSelectedProviders
      ? `/api/subagents${rangeQuery(since, until, queryProviders)}`
      : null,
  );

  const cols = useMemo(() => makeColumns(t), [t]);

  if (error) return <ErrorBlock error={error} />;
  if (settingsLoaded && !hasAvailableProviders) {
    return <EmptyBlock message={t("common.noProviders")} />;
  }
  if (loading || !data) return <LoadingBlock />;

  const empty = data.by_kind.length === 0 && data.by_entrypoint.length === 0;

  return (
    <>
      <PageTitle
        title={t("pages.subagents.title")}
        description={t("pages.subagents.description")}
      />
      {empty ? (
        <EmptyBlock message={t("pages.subagents.noActivity")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.subagents.byKind")}</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentTable
                rows={data.by_kind}
                label={cols.kind}
                modelLabel={cols.model}
                msgsLabel={cols.msgs}
                ioTokensLabel={cols.ioTokens}
                costLabel={cols.cost}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.subagents.byEntrypoint")}</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentTable
                rows={data.by_entrypoint}
                label={cols.entrypoint}
                modelLabel={cols.model}
                msgsLabel={cols.msgs}
                ioTokensLabel={cols.ioTokens}
                costLabel={cols.cost}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
