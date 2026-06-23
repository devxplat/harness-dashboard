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
import { toast } from "sonner";

const UNITS: GithubSyncSettings["backfill"]["unit"][] = [
  "days",
  "weeks",
  "months",
  "all",
  "recent",
];

function SettingsForm({ initial, onSaved }: { initial: GithubSyncSettings; onSaved: () => void }) {
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
      loading: "Saving sync settings…",
      success: "Sync settings saved",
      error: "Could not save settings",
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
        <label className="text-xs font-medium text-muted-foreground">Backfill window</label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={1}
            aria-label="Backfill amount"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!windowed}
            className="w-20"
          />
          <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
            <SelectTrigger className="w-32" aria-label="Backfill unit">
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
          Deepening the window re-backfills the selected repos; a shallower one keeps existing data.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Pull requests to import</label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={prScope === "all" ? "default" : "outline"}
            aria-pressed={prScope === "all"}
            onClick={() => setPrScope("all")}
          >
            All repo PRs
          </Button>
          <Button
            size="sm"
            variant={prScope === "mine" ? "default" : "outline"}
            aria-pressed={prScope === "mine"}
            onClick={() => setPrScope("mine")}
          >
            Only mine
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          All repo PRs gives team baselines for DORA &amp; productivity comparisons; “Only mine”
          stores just your own.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Auto-sync</label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={autoEnabled ? "default" : "outline"}
            aria-pressed={autoEnabled}
            onClick={() => setAutoEnabled((v) => !v)}
          >
            {autoEnabled ? "On" : "Off"}
          </Button>
          <span className="text-xs text-muted-foreground">every</span>
          <Input
            type="number"
            min={15}
            aria-label="Auto-sync interval (minutes)"
            value={interval}
            onChange={(e) => setIntervalMin(e.target.value)}
            disabled={!autoEnabled}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">minutes</span>
        </div>
      </div>

      <Button size="sm" onClick={save} disabled={busy}>
        Save sync settings
      </Button>
    </div>
  );
}

export function GithubSyncSettings({ onSaved }: { onSaved?: () => void }) {
  const { data, loading, error } = useApi<GithubSyncSettings>("/api/integrations/github/settings");
  if (error) return <p className="text-xs text-destructive">Could not load settings: {error}</p>;
  if (loading || !data || !data.backfill || !data.autosync) {
    return <p className="text-xs text-muted-foreground">Loading settings…</p>;
  }
  return <SettingsForm initial={data} onSaved={() => onSaved?.()} />;
}
