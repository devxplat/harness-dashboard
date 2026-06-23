"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { withRange } from "@/lib/api";
import { useRange } from "@/lib/range";
import type { Tip } from "@/lib/types";
import { useTranslation } from "react-i18next";

function severityVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "cost") return "destructive";
  if (s === "warning") return "default";
  return "secondary";
}

export default function TipsPage() {
  const { t: tr } = useTranslation();
  const { since, until } = useRange();
  const { data, error, loading } = useApi<Tip[]>(withRange("/api/tips", since, until));

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={tr("pages.tips.title")} description={tr("pages.tips.description")} />
      {data.length === 0 ? (
        <EmptyBlock message="No tips right now — nothing to flag in this range." />
      ) : (
        <div className="space-y-3">
          {data.map((t) => (
            <Card key={t.key}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{t.title}</CardTitle>
                  <Badge variant={severityVariant(t.severity)}>{t.category}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
