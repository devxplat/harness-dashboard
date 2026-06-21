"use client";

import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { formatDate, formatInt, formatTokens, formatUSD } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { MessageDetail, SessionRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

const makeSessionColumns = (short: boolean): ColumnDef<SessionRow>[] => [
  {
    accessorKey: "started",
    header: "Started",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(row.original.started)}
      </span>
    ),
  },
  {
    accessorKey: "project_slug",
    header: "Project",
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.project_slug}
        short={short}
        href={`/sessions/?id=${row.original.session_id}`}
        className="max-w-[240px]"
      />
    ),
  },
  {
    accessorKey: "turns",
    header: "Turns",
    cell: ({ row }) => formatInt(row.original.turns),
    meta: { align: "right" },
  },
  {
    accessorKey: "tokens",
    header: "Tokens",
    cell: ({ row }) => formatTokens(row.original.tokens),
    meta: { align: "right" },
  },
  {
    accessorKey: "cost_usd",
    header: "Cost",
    cell: ({ row }) => formatUSD(row.original.cost_usd),
    meta: { align: "right" },
  },
];

function SessionsList() {
  const [shortNames, setShortNames] = useState(true);
  const columns = useMemo(() => makeSessionColumns(shortNames), [shortNames]);
  const { since, until } = useRange();
  const { data, error, loading } = useApi<SessionRow[]>(
    withRange("/api/sessions?limit=500", since, until),
  );
  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <DataTable
      columns={columns}
      data={data}
      search={{
        fields: ["project_slug", "sample_cwd", "session_id"],
        placeholder: "Filter by project or session id…",
        ariaLabel: "Filter sessions",
      }}
      actions={<PathToggle short={shortNames} onToggle={() => setShortNames((v) => !v)} />}
      pageSize={25}
      emptyMessage="No sessions match."
      footer={(rows) => {
        const turns = rows.reduce((a, s) => a + s.turns, 0);
        const tokens = rows.reduce((a, s) => a + s.tokens, 0);
        const cost = rows.reduce((a, s) => a + (s.cost_usd ?? 0), 0);
        return (
          <p className="text-xs text-muted-foreground">
            Totals: {formatInt(turns)} turns · {formatTokens(tokens)} tokens · {formatUSD(cost)}
          </p>
        );
      }}
    />
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
  return id ? (
    <SessionDetail id={id} />
  ) : (
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
