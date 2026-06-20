"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatInt, formatTokens, formatUSD, shortId } from "@/lib/format";
import type { MessageDetail, SessionRow } from "@/lib/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

function SessionsList() {
  const [q, setQ] = useState("");
  const { data, error, loading } = useApi<SessionRow[]>("/api/sessions?limit=500");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (s) =>
        (s.project_slug ?? "").toLowerCase().includes(needle) ||
        s.session_id.toLowerCase().includes(needle),
    );
  }, [data, q]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, s) => ({
          turns: a.turns + s.turns,
          tokens: a.tokens + s.tokens,
          cost: a.cost + (s.cost_usd ?? 0),
        }),
        { turns: 0, tokens: 0, cost: 0 },
      ),
    [rows],
  );

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by project or session id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
          aria-label="Filter sessions"
        />
        <span className="text-sm text-muted-foreground">{rows.length} sessions</span>
      </div>
      {rows.length === 0 ? (
        <EmptyBlock message="No sessions match." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Turns</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 200).map((s) => (
                  <TableRow key={s.session_id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(s.started)}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate">
                      <Link className="hover:underline" href={`/sessions/?id=${s.session_id}`}>
                        {s.project_slug ?? shortId(s.session_id)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(s.turns)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(s.tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUSD(s.cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              Totals: {formatInt(totals.turns)} turns · {formatTokens(totals.tokens)} tokens ·{" "}
              {formatUSD(totals.cost)}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function SessionDetail({ id }: { id: string }) {
  const { data, error, loading } = useApi<MessageDetail[]>(`/api/sessions/${id}`);
  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <Link className="text-sm text-muted-foreground hover:underline" href="/sessions/">
        ← All sessions
      </Link>
      <PageTitle title="Session" description={id} />
      <div className="space-y-2">
        {data.map((m) => (
          <Card key={m.uuid}>
            <CardContent className="space-y-1 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={m.type === "user" ? "default" : "secondary"}>{m.type}</Badge>
                {m.is_sidechain ? <Badge variant="outline">subagent</Badge> : null}
                {m.model ? <span className="font-mono">{m.model}</span> : null}
                <span className="ml-auto">{formatDate(m.timestamp)}</span>
              </div>
              {m.prompt_text ? (
                <p className="whitespace-pre-wrap text-sm">{m.prompt_text}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {formatTokens(m.input_tokens)} in · {formatTokens(m.output_tokens)} out
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function SessionsContent() {
  const id = useSearchParams().get("id");
  return id ? <SessionDetail id={id} /> : (
    <>
      <PageTitle title="Sessions" description="Browse and drill into individual sessions." />
      <SessionsList />
    </>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SessionsContent />
    </Suspense>
  );
}
