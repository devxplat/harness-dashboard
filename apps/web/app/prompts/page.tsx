"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTokens, formatUSD } from "@/lib/format";
import type { PromptRow } from "@/lib/types";
import { useState } from "react";

export default function PromptsPage() {
  const [sort, setSort] = useState<"tokens" | "recent">("tokens");
  const { data, error, loading } = useApi<PromptRow[]>(`/api/prompts?limit=50&sort=${sort}`);

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Prompts" description="Your most expensive prompts by attributed tokens." />
        <div className="flex gap-1">
          <Button size="sm" variant={sort === "tokens" ? "default" : "outline"} onClick={() => setSort("tokens")}>
            By tokens
          </Button>
          <Button size="sm" variant={sort === "recent" ? "default" : "outline"} onClick={() => setSort("recent")}>
            Recent
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorBlock error={error} />
      ) : loading || !data ? (
        <LoadingBlock />
      ) : data.length === 0 ? (
        <EmptyBlock message="No prompts yet." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.user_uuid}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(p.timestamp)}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs">{p.project_slug}</TableCell>
                    <TableCell className="max-w-[360px] truncate">
                      {p.prompt_text ?? "—"}
                      {p.cost_estimated ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          est.
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(p.billable_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUSD(p.estimated_cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
