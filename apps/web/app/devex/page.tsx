"use client";

import { SentimentTrendChart } from "@/components/charts/insight-charts";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { apiPost, withRange } from "@/lib/api";
import { useRange } from "@/lib/range";
import type { SurveyCorrelationBundle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const QUESTIONS = [
  { key: "flow", label: "I was in flow / few interruptions" },
  { key: "productivity", label: "I got meaningful work done" },
  { key: "ai_helpful", label: "AI assistance helped today" },
  { key: "satisfaction", label: "I'm satisfied with how today went" },
] as const;

type AnswerKey = (typeof QUESTIONS)[number]["key"];
type Answers = Partial<Record<AnswerKey, number>>;

function LikertRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex gap-1" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            size="sm"
            variant={value === n ? "default" : "outline"}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className="w-9 tabular-nums"
          >
            {n}
          </Button>
        ))}
      </div>
    </div>
  );
}

function PulseForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiPost("/api/survey", { ...answers, note: note.trim() || null });
      setAnswers({});
      setNote("");
      onSubmitted();
    } finally {
      setSaving(false);
    }
  };

  const hasAny = Object.keys(answers).length > 0;

  return (
    <div className="space-y-4">
      {QUESTIONS.map((q) => (
        <LikertRow
          key={q.key}
          label={q.label}
          value={answers[q.key]}
          onChange={(n) => setAnswers((a) => ({ ...a, [q.key]: n }))}
        />
      ))}
      <Input
        placeholder="Optional note (journal line)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={saving || !hasAny}>
          {saving ? "Saving…" : "Log pulse"}
        </Button>
      </div>
    </div>
  );
}

function rText(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

function score(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

export default function DevExPage() {
  const { t } = useTranslation();
  const { since, until } = useRange();
  const { data, error, loading, refetch } = useApi<SurveyCorrelationBundle>(
    withRange("/api/survey", since, until),
  );

  if (error) return <ErrorBlock error={error} />;
  const b = data && !Array.isArray(data) ? data : null;
  if (loading || !b) return <LoadingBlock />;

  const today = new Date().toISOString().slice(0, 10);
  const loggedToday = b.responses.some((r) => r.submitted_at_utc.slice(0, 10) === today);

  return (
    <>
      <PageTitle
        title={t("pages.devex.title")}
        description={t("pages.devex.description")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{loggedToday ? "Today's pulse logged" : "How was today?"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loggedToday ? (
            <p className="text-sm text-muted-foreground">
              You already logged a pulse today. Add another any time.
            </p>
          ) : null}
          <div className={cn(loggedToday && "pt-3")}>
            <PulseForm onSubmitted={refetch} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sentiment vs commits</CardTitle>
        </CardHeader>
        <CardContent>
          {b.trend.some((t) => t.responses > 0) ? (
            <SentimentTrendChart data={b.trend} />
          ) : (
            <EmptyBlock message="Log a few pulses to see sentiment trends." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Correlations (sentiment × output)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sentiment</TableHead>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">r</TableHead>
                <TableHead className="text-right">n</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.correlations.map((c) => (
                <TableRow key={`${c.sentiment}:${c.metric}`}>
                  <TableCell className="capitalize">{c.sentiment.replace("_", " ")}</TableCell>
                  <TableCell className="capitalize">{c.metric.replace("_", " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{rText(c.r)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.n < 3 ? (
                      <Badge variant="outline" className="text-[10px]">
                        n={c.n}
                      </Badge>
                    ) : (
                      c.n
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="pt-2 text-xs text-muted-foreground">
            Pearson r over the daily series; shown only at n ≥ 3. Directional, not causal.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal</CardTitle>
        </CardHeader>
        <CardContent>
          {b.responses.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Flow</TableHead>
                  <TableHead className="text-right">Prod.</TableHead>
                  <TableHead className="text-right">AI</TableHead>
                  <TableHead className="text-right">Satisf.</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.responses.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{r.submitted_at_utc.slice(0, 10)}</TableCell>
                    <TableCell className="text-right tabular-nums">{score(r.flow)}</TableCell>
                    <TableCell className="text-right tabular-nums">{score(r.productivity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{score(r.ai_helpful)}</TableCell>
                    <TableCell className="text-right tabular-nums">{score(r.satisfaction)}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={r.note ?? ""}>
                      {r.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyBlock message="No pulses logged yet." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
