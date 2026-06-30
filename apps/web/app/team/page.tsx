"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
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
import type { AuthorDoraRow, AuthorRow } from "@/lib/types";
import { useTranslation } from "react-i18next";

function authorLabel(a: { author_name: string | null; author_email: string }): string {
  return a.author_name ?? a.author_email;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

function num1(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

export default function TeamPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const { data, error, loading } = useApi<AuthorRow[]>(withRange("/api/authors", since, until));
  const { data: doraData } = useApi<AuthorDoraRow[]>(withRange("/api/authors/dora", since, until));

  if (error) return <ErrorBlock error={error} />;
  const authors = Array.isArray(data) ? data : null;
  if (loading || !authors) return <LoadingBlock />;
  const dora = Array.isArray(doraData) ? doraData : [];

  return (
    <>
      <PageTitle
        title={t("pages.team.title")}
        description={t("pages.team.description")}
      />

      {authors.length === 0 ? (
        <EmptyBlock message={t("pages.team.noAuthoredCommits")} />
      ) : authors.length === 1 ? (
        <p className="text-xs text-muted-foreground">
          {t("pages.team.singleAuthorNote")}
        </p>
      ) : null}

      {authors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("pages.team.contributors")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.team.author")}</TableHead>
                  <TableHead className="text-right">{t("pages.team.commits")}</TableHead>
                  <TableHead className="text-right">{t("pages.team.aiShare")}</TableHead>
                  <TableHead className="text-right">{t("pages.team.activeDays")}</TableHead>
                  <TableHead className="text-right">{t("pages.team.lines")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authors.slice(0, 100).map((a) => (
                  <TableRow key={a.author_email}>
                    <TableCell className="max-w-[280px] truncate" title={a.author_email}>
                      {authorLabel(a)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(a.commits)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.ai_commits > 0 ? (
                        <Badge variant="outline">{pct(a.ai_commits, a.commits)}</Badge>
                      ) : (
                        pct(a.ai_commits, a.commits)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(a.active_days)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{formatInt(a.insertions)}
                      </span>{" "}
                      /{" "}
                      <span className="text-red-600 dark:text-red-400">
                        −{formatInt(a.deletions)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {dora.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("pages.team.perAuthorDora")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.team.author")}</TableHead>
                  <TableHead className="text-right">{t("pages.team.throughput")}</TableHead>
                  <TableHead className="text-right">{t("pages.team.changeFailureProxy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dora.slice(0, 100).map((a) => (
                  <TableRow key={a.author_email}>
                    <TableCell className="max-w-[280px] truncate" title={a.author_email}>
                      {authorLabel(a)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num1(a.throughputPerWeek)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.changeFailurePct == null ? "—" : `${Math.round(a.changeFailurePct)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="pt-2 text-xs text-muted-foreground">
              {t("pages.team.changeFailureNote")}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
