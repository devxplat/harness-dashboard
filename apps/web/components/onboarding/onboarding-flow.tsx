"use client";

// First-run setup wizard. Three steps: pick which AI coding tools (copilots) you
// use, optionally connect GitHub / Google Calendar, then kick off the initial scan
// + backfill with a live progress view. Completing (or skipping) flips the
// `onboarding_done` setting so the first-run gate stops redirecting here.
import { IntegrationsSettings } from "@/components/integrations-settings";
import { GithubSyncProgress } from "@/components/integrations/github-progress";
import { GithubSyncSettings } from "@/components/integrations/github-sync-settings";
import { LoadingBlock } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { normalizePrSessionCorrelationConfig } from "@/lib/pr-session-correlation";
import { PROVIDERS } from "@/lib/providers";
import type { IntegrationsInfo, PrSessionCorrelationConfig, SettingsInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const STEPS = [
  { id: "copilots" },
  { id: "connect" },
  { id: "sync" },
] as const;

function Stepper({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <ol className="flex items-center gap-2" aria-label={t("components.onboarding.progress")}>
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-emerald-500 bg-emerald-500 text-white",
                !active && !done && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span
              className={cn(
                "hidden truncate text-sm sm:inline",
                active ? "font-medium" : "text-muted-foreground",
              )}
            >
              {t(`components.onboarding.steps.${s.id}.title`)}
            </span>
            {i < STEPS.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function CopilotPicker({
  selected,
  onToggle,
  discovered,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  discovered: Set<string>;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {PROVIDERS.map((p) => {
        const Icon = p.Icon;
        const isOn = selected.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            aria-pressed={isOn}
            className={cn(
              "relative flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50",
              isOn && "border-primary ring-2 ring-primary/30",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.label}</span>
              {discovered.has(p.id) ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {t("components.onboarding.detected")}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("components.onboarding.notDetected")}
                </span>
              )}
            </span>
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full border",
                isOn ? "border-primary bg-primary text-primary-foreground" : "text-transparent",
              )}
              aria-hidden
            >
              <Check className="size-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SyncStep({ selectedCount }: { selectedCount: number }) {
  const { t } = useTranslation();
  const { last, scanning, githubProgress } = useContext(ScanSyncContext);
  const { data: integrations } = useApi<IntegrationsInfo>("/api/integrations");
  const githubConnected = !!integrations?.github?.configured;
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const counts = last?.n;

  // The seed is started by the user (not on mount) so they can configure the backfill
  // window first. Both the scan and the GitHub backfill are non-blocking on the
  // server; progress streams over SSE.
  async function start() {
    setBusy(true);
    setStarted(true);
    const p = apiPost("/api/refresh", {});
    toast.promise(p, {
      loading: t("components.onboarding.startingScan"),
      success: t("components.onboarding.scanStarted"),
      error: t("components.onboarding.scanError"),
    });
    try {
      await p;
      if (githubConnected) await apiPost("/api/integrations/github/sync", {});
    } catch {
      /* reported / non-fatal */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <p className="font-medium">{t("components.onboarding.localSessions")}</p>
        <p className="text-xs text-muted-foreground">
          {selectedCount > 0
            ? t("components.onboarding.localSessionsSummary", {
                count: selectedCount,
                label: t("common.source", { count: selectedCount }),
              })
            : t("components.onboarding.noSourcesSelected")}
        </p>
      </div>

      {githubConnected ? (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div>
            <p className="font-medium">{t("components.onboarding.githubBackfill")}</p>
            <p className="text-xs text-muted-foreground">
              {t("components.onboarding.githubBackfillDescription")}
            </p>
          </div>
          <GithubSyncSettings />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("components.onboarding.connectGithubForBackfill")}
        </p>
      )}

      {started ? (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{scanning ? t("components.onboarding.indexingHistory") : t("components.onboarding.initialScan")}</p>
            {scanning ? (
              <span className="size-2.5 animate-pulse rounded-full bg-primary" aria-hidden />
            ) : null}
          </div>
          {counts ? (
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                [t("components.onboarding.messages"), counts.messages],
                [t("components.onboarding.files"), counts.files],
                [t("components.onboarding.toolCalls"), counts.tools],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border bg-background p-2">
                  <dd className="text-lg font-semibold tabular-nums">
                    {formatInt(value as number)}
                  </dd>
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">{t("components.onboarding.waitingResults")}</p>
          )}
          {githubConnected ? <GithubSyncProgress progress={githubProgress} /> : null}
          <p className="text-xs text-muted-foreground">
            {t("components.onboarding.backgroundScan")}
          </p>
        </div>
      ) : (
        <Button onClick={start} disabled={busy}>
          {busy ? t("components.onboarding.starting") : t("components.onboarding.startInitialScan")}
        </Button>
      )}
    </div>
  );
}

export function OnboardingFlow() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, loading } = useApi<SettingsInfo>("/api/settings");
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [githubLogin, setGithubLogin] = useState("");
  const [aiGenerationMode, setAiGenerationMode] = useState("per_pr");
  const [sessionCorrelationConfig, setSessionCorrelationConfig] =
    useState<PrSessionCorrelationConfig>(() => normalizePrSessionCorrelationConfig(null));
  const [busy, setBusy] = useState(false);

  const restored = useRef(false);

  const discovered = useMemo(
    () => new Set((data?.providers ?? []).filter((p) => p.discovered).map((p) => p.id)),
    [data],
  );

  // Seed the copilot selection from what's already enabled or detected on disk, and
  // resume on the step the user last left off (persisted server-side).
  useEffect(() => {
    if (data && !restored.current) {
      restored.current = true;
      const seed = (data.providers ?? []).filter((p) => p.enabled || p.discovered).map((p) => p.id);
      setSelected(new Set(seed));
      setGithubLogin(data.github_login ?? "");
      setAiGenerationMode(data.pr_ai_default_generation_mode ?? "per_pr");
      setSessionCorrelationConfig(
        normalizePrSessionCorrelationConfig(data.pr_session_correlation_config),
      );
      const resume = Math.min(Math.max(data.onboarding_step ?? 0, 0), STEPS.length - 1);
      if (resume) setStep(resume);
    }
  }, [data]);

  const sel = selected ?? new Set<string>();

  // Persist the current step (fire-and-forget) so closing/reopening resumes here.
  function goTo(target: number) {
    const next = Math.min(Math.max(target, 0), STEPS.length - 1);
    setStep(next);
    void apiPost("/api/settings", { onboarding_step: next }).catch(() => {});
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function patchSessionCorrelationConfig(patch: Partial<PrSessionCorrelationConfig>) {
    setSessionCorrelationConfig((current) => ({
      ...current,
      ...patch,
      weights: { ...current.weights },
    }));
  }

  async function saveCopilots() {
    setBusy(true);
    const providers = PROVIDERS.map((p) => ({ id: p.id, enabled: sel.has(p.id) }));
    const p = apiPost("/api/settings", { providers });
    toast.promise(p, {
      loading: t("components.onboarding.savingCopilots", { defaultValue: "Saving your copilots..." }),
      success: t("components.onboarding.copilotsSaved", { defaultValue: "Copilots saved" }),
      error: t("components.onboarding.copilotsSaveError", { defaultValue: "Could not save - you can change this later in Settings" }),
    });
    try {
      await p;
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  async function saveGithubDefaultUser() {
    setBusy(true);
    const p = apiPost("/api/settings", {
      github_login: githubLogin.trim(),
      pr_ai_default_generation_mode: aiGenerationMode,
      pr_session_correlation_config: sessionCorrelationConfig,
    });
    toast.promise(p, {
      loading: t("components.onboarding.savingGithubUser", { defaultValue: "Saving GitHub default user..." }),
      success: t("components.onboarding.githubUserSaved", { defaultValue: "GitHub default user saved" }),
      error: t("components.onboarding.githubUserSaveError", { defaultValue: "Could not save GitHub user - you can change this later in Settings" }),
    });
    try {
      await p;
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      await apiPost("/api/settings", { onboarding_done: true });
    } catch {
      /* non-fatal — gate only redirects while explicitly false */
    } finally {
      setBusy(false);
      router.push("/");
    }
  }

  async function next() {
    if (step === 0) await saveCopilots();
    if (step === 1) await saveGithubDefaultUser();
    if (step === STEPS.length - 1) {
      await complete();
      return;
    }
    goTo(step + 1);
  }

  if (loading || !data) return <LoadingBlock />;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background">
          <Image src="/logo.png" alt="" width={40} height={40} className="size-9" priority />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {t("components.onboarding.title", { defaultValue: "Set up your dashboard" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("components.onboarding.subtitle", {
              defaultValue: "A minute now, then it runs on its own.",
            })}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={complete} disabled={busy}>
          {t("components.onboarding.skip")}
        </Button>
      </div>

      <Stepper step={step} />

      <div className="rounded-2xl border bg-card/40 p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-base font-semibold">
            {t(`components.onboarding.steps.${current.id}.title`)}
          </h2>
          <Badge variant="outline" className="text-muted-foreground">
            {t("components.onboarding.step", { step: step + 1, total: STEPS.length })}
          </Badge>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          {t(`components.onboarding.steps.${current.id}.blurb`)}
        </p>

        {step === 0 && <CopilotPicker selected={sel} onToggle={toggle} discovered={discovered} />}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-background/60 p-4">
              <label className="text-sm font-medium" htmlFor="onboarding-github-login">
                {t("components.onboarding.defaultGithubUser")}
              </label>
              <Input
                id="onboarding-github-login"
                aria-label={t("components.onboarding.defaultGithubUser")}
                value={githubLogin}
                onChange={(event) => setGithubLogin(event.target.value)}
                placeholder={t("settings.profile.githubLoginPlaceholder")}
                className="mt-2 max-w-sm"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {t("components.onboarding.defaultGithubUserHint")}
              </p>
            </div>
            <div className="rounded-lg border bg-background/60 p-4">
              <label className="text-sm font-medium" htmlFor="onboarding-pr-ai-mode">
                {t("components.onboarding.prAiMode")}
              </label>
              <Select value={aiGenerationMode} onValueChange={setAiGenerationMode}>
                <SelectTrigger
                  id="onboarding-pr-ai-mode"
                  aria-label={t("components.onboarding.prAiMode")}
                  className="mt-2 max-w-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_pr">{t("enums.generationMode.per_pr")}</SelectItem>
                  <SelectItem value="all_mine">{t("enums.generationMode.all_mine")}</SelectItem>
                  <SelectItem value="repo">{t("enums.generationMode.repo")}</SelectItem>
                  <SelectItem value="org">{t("enums.generationMode.org")}</SelectItem>
                  <SelectItem value="batch">{t("enums.generationMode.batch")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("components.onboarding.prAiModeHint")}
              </p>
            </div>
            <div className="rounded-lg border bg-background/60 p-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  aria-label={t("components.onboarding.enablePrSessionCorrelation")}
                  checked={sessionCorrelationConfig.enabled}
                  onChange={(event) =>
                    patchSessionCorrelationConfig({ enabled: event.target.checked })
                  }
                  className="size-4 accent-primary"
                />
                {t("components.onboarding.enablePrSessionCorrelation")}
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("components.onboarding.sessionCorrelationHint")}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="onboarding-pr-before">
                    {t("components.onboarding.minutesBeforePr")}
                  </label>
                  <Input
                    id="onboarding-pr-before"
                    aria-label={t("components.onboarding.minutesBeforePrAria")}
                    type="number"
                    min={0}
                    max={10080}
                    value={sessionCorrelationConfig.time_window_before_minutes}
                    onChange={(event) =>
                      patchSessionCorrelationConfig({
                        time_window_before_minutes: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="onboarding-pr-after">
                    {t("components.onboarding.minutesAfterPr")}
                  </label>
                  <Input
                    id="onboarding-pr-after"
                    aria-label={t("components.onboarding.minutesAfterPrAria")}
                    type="number"
                    min={0}
                    max={10080}
                    value={sessionCorrelationConfig.time_window_after_minutes}
                    onChange={(event) =>
                      patchSessionCorrelationConfig({
                        time_window_after_minutes: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="onboarding-pr-confidence"
                  >
                    {t("components.onboarding.minConfidence")}
                  </label>
                  <Input
                    id="onboarding-pr-confidence"
                    aria-label={t("components.onboarding.minConfidenceAria")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sessionCorrelationConfig.min_confidence}
                    onChange={(event) =>
                      patchSessionCorrelationConfig({
                        min_confidence: Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <IntegrationsSettings />
          </div>
        )}
        {step === 2 && <SyncStep selectedCount={sel.size} />}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0 || busy}>
          {t("components.onboarding.back")}
        </Button>
        <Button onClick={next} disabled={busy}>
          {isLast ? t("components.onboarding.finish") : t("components.onboarding.next")}
        </Button>
      </div>
    </div>
  );
}
