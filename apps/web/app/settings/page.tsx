"use client";

import { ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import type { SettingsInfo } from "@/lib/types";
import { useState } from "react";
import { toast } from "sonner";

const PLANS = ["api", "pro", "max", "max-20x", "team", "team-premium"];

export default function SettingsPage() {
  const { data, error, loading, refetch } = useApi<SettingsInfo>("/api/settings");
  const [saving, setSaving] = useState(false);

  async function setPlan(plan: string) {
    setSaving(true);
    try {
      await apiPost("/api/plan", { plan });
      toast.success(`Plan set to ${plan}`);
      refetch();
    } catch {
      toast.error("Could not update plan");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Settings" description="Pricing plan and scan locations." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Pricing plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select defaultValue={data.plan} onValueChange={setPlan} disabled={saving}>
            <SelectTrigger className="w-56" aria-label="Pricing plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLANS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Claude dir</dt>
              <dd className="font-mono text-xs">{data.claude_dir}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Projects dir</dt>
              <dd className="font-mono text-xs">{data.projects_dir}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
