"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
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
import { rangeQuery } from "@/lib/api";
import { formatDate, formatInt } from "@/lib/format";
import { useRange } from "@/lib/range";
import type { SkillRow } from "@/lib/types";

export default function SkillsPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<SkillRow[]>(`/api/skills${rangeQuery(since)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle
        title="Skills & commands"
        description="Slash commands you ran vs. Skill tools Claude invoked."
      />
      {data.length === 0 ? (
        <EmptyBlock message="No skill or slash-command activity in range." />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Skill</TableHead>
                  <TableHead className="text-right">You ran</TableHead>
                  <TableHead className="text-right">Claude invoked</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead>Last used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow key={s.skill}>
                    <TableCell className="font-medium">{s.skill}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(s.manual_sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(s.tool_invocations)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(s.sessions)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(s.last_used)}</TableCell>
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
