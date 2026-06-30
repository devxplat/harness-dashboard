"use client";

// Backfill window + auto-sync controls. The user has full control: how far back the
// first/forced backfill reaches, and whether/how often a periodic sync runs.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import { backfillSummary } from "@/lib/github";
import type { GithubSyncSettings } from "@/lib/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const UNITS: GithubSyncSettings["backfill"]["unit"][] = [
  "days",
  "weeks",
  "months",
  "all",
  "recent",
];

function SettingsForm({ initial, onSaved }: { initial: GithubSyncSettings; onSaved: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(initial.backfill.value));
  const [unit, setUnit] = useState(initial.backfill.unit);
  const [autoEnabled, setAutoEnabled] = useState(initial.autosync.enabled);
  const [interval, setIntervalMin] = useState(String(initial.autosync.interval_min));
  const [prScope, setPrScope] = useState<"all" | "mine">(initial.pr_scope ?? "all");
  const [busy, setBusy] = useState(false);
  const windowed = unit !== "all" && unit !== "recent";

  async function save() {
    setBusy(true);
    const body = {
      backfill: { value: Math.max(1, Number(value) || 1), unit },
      autosync: { enabled: autoEnabled, interval_min: Math.max(15, Number(interval) || 60) },
      pr_scope: prScope,
    };
    const p = apiPost("/api/integrations/github/settings", body);
    toast.promise(p, {
      loading: t("components.githubSync.saving"),
      success: t("components.githubSync.saved"),
      error: t("components.githubSync.saveError"),
    });
    try {
      await p;
      onSaved();
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("components.githubSync.backfillWindow")}</label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={1}
            aria-label={t("components.githubSync.backfillAmount")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!windowed}
            className="w-20"
          />
          <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
            <SelectTrigger className="w-32" aria-label={t("components.githubSync.backfillUnit")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u} className="capitalize">
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            → {backfillSummary(Number(value) || 0, unit)}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("components.githubSync.backfillHint")}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("components.githubSync.prsToImport")}</label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={prScope === "all" ? "default" : "outline"}
            aria-pressed={prScope === "all"}
            onClick={() => setPrScope("all")}
          >
            {t("components.githubSync.allRepoPrs")}
          </Button>
          <Button
            size="sm"
            variant={prScope === "mine" ? "default" : "outline"}
            aria-pressed={prScope === "mine"}
            onClick={() => setPrScope("mine")}
          >
            {t("components.githubSync.onlyMine")}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("components.githubSync.prScopeHint")}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("components.githubSync.autoSync")}</label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={autoEnabled ? "default" : "outline"}
            aria-pressed={autoEnabled}
            onClick={() => setAutoEnabled((v) => !v)}
          >
            {autoEnabled ? t("common.on") : t("common.off")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("components.githubSync.every")}</span>
          <Input
            type="number"
            min={15}
            aria-label={t("components.githubSync.interval")}
            value={interval}
            onChange={(e) => setIntervalMin(e.target.value)}
            disabled={!autoEnabled}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">{t("common.minutes")}</span>
        </div>
      </div>

      <Button size="sm" onClick={save} disabled={busy}>
        {t("components.githubSync.save")}
      </Button>
    </div>
  );
}

export function GithubSyncSettings({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation();
  const { data, loading, error } = useApi<GithubSyncSettings>("/api/integrations/github/settings");
  if (error) return <p className="text-xs text-destructive">{t("components.githubSync.loadError", { error })}</p>;
  if (loading || !data || !data.backfill || !data.autosync) {
    return <p className="text-xs text-muted-foreground">{t("components.githubSync.loading")}</p>;
  }
  return <SettingsForm initial={data} onSaved={() => onSaved?.()} />;
}
