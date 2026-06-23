"use client";

import { AiSplitChart } from "@/components/charts/ai-split-chart";
import { ProductiveHoursHeatmap } from "@/components/charts/productive-hours-heatmap";
import { CommitsTable } from "@/components/commits-table";
import { EmptyBlock, ErrorBlock, PageTitle } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { rangeQuery, withRange } from "@/lib/api";
import { formatDateShort, formatInt } from "@/lib/format";
import { aiTotals } from "@/lib/productivity-grid";
import { useRange } from "@/lib/range";
import type {
  CommitRow,
  DeploymentRow,
  MeetingImpact,
  ProductivityBundle,
  PullRequestRow,
} from "@/lib/types";

export default function ProductivityPage() {
  const { since, until } = useRange();

  // Bucket UTC message timestamps into the viewer's local hours; commits carry
  // their own offset and ignore this. getTimezoneOffset() is minutes *behind* UTC,
  // so negate it to get minutes east of UTC.
  const tz = -new Date().getTimezoneOffset();
  const prod = useApi<ProductivityBundle>(
    withRange(`/api/productivity?tz_offset_min=${tz}`, since, until),
  );
  const commits = useApi<CommitRow[]>(`/api/commits${rangeQuery(since, until)}`);
  // Opt-in GitHub enrichment — these sections render only when data is present.
  const prs = useApi<PullRequestRow[]>(`/api/pull-requests${rangeQuery(since, until)}`);
  const deployments = useApi<DeploymentRow[]>(`/api/deployments${rangeQuery(since, until)}`);
  const meetings = useApi<MeetingImpact>(`/api/meetings/impact${rangeQuery(since, until)}`);

  if (prod.error) return <ErrorBlock error={prod.error} />;
  if (commits.error) return <ErrorBlock error={commits.error} />;

  const p = prod.data;
  const ai = p ? aiTotals(p.aiByDay) : null;
  // Only show meeting impact once a calendar is synced (some activity falls in meetings).
  const mi =
    meetings.data && meetings.data.during_commits + meetings.data.during_messages > 0
      ? meetings.data
      : null;
  const pct = (during: number, free: number) =>
    Math.round((during / Math.max(1, during + free)) * 100);

  return (
    <>
      <PageTitle
        title="Productivity"
        description="Git throughput, when you build, and how much is AI-assisted vs by hand."
      />

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>AI-assisted vs by hand</CardTitle>
            {ai && ai.total > 0 ? (
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{Math.round(ai.pct * 100)}%</span> AI-assisted
                · {formatInt(ai.ai)}/{formatInt(ai.total)} commits
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            {!p ? (
              <Skeleton className="h-64 w-full" />
            ) : p.aiByDay.length ? (
              <AiSplitChart data={p.aiByDay} />
            ) : (
              <EmptyBlock message="No commits in range." />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardContent className="pt-6">
            {!p ? <Skeleton className="h-64 w-full" /> : <ProductiveHoursHeatmap data={p.hours} />}
          </CardContent>
        </Card>
      </div>

      {mi ? (
        <Card>
          <CardHeader>
            <CardTitle>Meeting impact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Claude messages during meetings</p>
              <p className="text-2xl font-semibold tabular-nums">
                {pct(mi.during_messages, mi.free_messages)}%
              </p>
              <p className="text-xs text-muted-foreground">
                {formatInt(mi.during_messages)} of {formatInt(mi.during_messages + mi.free_messages)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Commits during meetings</p>
              <p className="text-2xl font-semibold tabular-nums">
                {pct(mi.during_commits, mi.free_commits)}%
              </p>
              <p className="text-xs text-muted-foreground">
                {formatInt(mi.during_commits)} of {formatInt(mi.during_commits + mi.free_commits)}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Commits</CardTitle>
        </CardHeader>
        <CardContent>
          {!commits.data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : commits.data.length === 0 ? (
            <EmptyBlock message="No commits in range. Local git history is read for every project you've used Claude Code in." />
          ) : (
            <CommitsTable commits={commits.data} />
          )}
        </CardContent>
      </Card>

      {prs.data && prs.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pull requests</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">AI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prs.data.slice(0, 50).map((p) => (
                  <TableRow key={`${p.repo_key}#${p.number}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.html_url ? (
                        <a className="hover:underline" href={p.html_url} target="_blank" rel="noreferrer">
                          #{p.number}
                        </a>
                      ) : (
                        `#${p.number}`
                      )}
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate" title={p.title ?? undefined}>
                      {p.title ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs capitalize text-muted-foreground">{p.state ?? "—"}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      <span className="text-emerald-600 dark:text-emerald-400">+{formatInt(p.additions)}</span>{" "}
                      <span className="text-rose-600 dark:text-rose-400">−{formatInt(p.deletions)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.ai_session_overlap ? (
                        <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                          AI
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {deployments.data && deployments.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Deployments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.data.slice(0, 50).map((d) => (
                  <TableRow key={`${d.repo_key}:${d.kind}:${d.ext_id}`}>
                    <TableCell className="max-w-[280px] truncate">
                      {d.html_url ? (
                        <a className="hover:underline" href={d.html_url} target="_blank" rel="noreferrer">
                          {d.name ?? d.ext_id}
                        </a>
                      ) : (
                        (d.name ?? d.ext_id)
                      )}
                    </TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">{d.kind}</TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">{d.status ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateShort(d.created_at_utc)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
