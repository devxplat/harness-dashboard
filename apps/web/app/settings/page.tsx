"use client";

// Settings, organized as a sectioned page (visual base: shadcnblocks
// settings-integrations8 — left section nav + content pane). One "Integrations"
// section holds every integration together; the others cover the rest of the
// settings we need.
import { IngestStatusPanel } from "@/components/ingest/ingest-status-panel";
import { IntegrationsSettings } from "@/components/integrations-settings";
import { IntegrationCard } from "@/components/settings/integration-card";
import { ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import { formatDate, formatUSD } from "@/lib/format";
import { LOCALES } from "@/lib/i18n/config";
import { normalizePrSessionCorrelationConfig } from "@/lib/pr-session-correlation";
import { providerMeta } from "@/lib/providers";
import { RANGES } from "@/lib/range";
import type {
  PrAiEngine,
  PrInsightRule,
  PrSessionCorrelationConfig,
  ProviderCapabilitySet,
  ProviderConfig,
  ProviderPlan,
  ProviderPlansBundle,
  ProviderSourceConfig,
  SettingsInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type { TFunction } from "i18next";
import {
  Boxes,
  Copy,
  CreditCard,
  ExternalLink,
  GitPullRequest,
  Plug,
  Plus,
  Rocket,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const PLANS = ["api", "pro", "max", "max-20x", "team", "team-premium"];
const STATUSLINE_COMMAND = "harness-dashboard statusline-snapshot";
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000;

type SectionId =
  | "profile"
  | "integrations"
  | "sources"
  | "plans_usage"
  | "rules"
  | "ai_features"
  | "general"
  | "onboarding";

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium leading-none">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ProfileSettings({ data, onSaved }: { data: SettingsInfo; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [defaultRange, setDefaultRange] = useState("30d");
  const [githubLogin, setGithubLogin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDisplayName(localStorage.getItem("harness.displayName") ?? "");
    setGithubLogin(data.github_login ?? "");
    const saved = localStorage.getItem("harness.defaultRange");
    if (saved && ["7d", "30d", "90d", "all"].includes(saved)) setDefaultRange(saved);
  }, [data.github_login]);

  async function save() {
    setSaving(true);
    localStorage.setItem("harness.displayName", displayName);
    localStorage.setItem("harness.defaultRange", defaultRange);
    try {
      await apiPost("/api/settings", { github_login: githubLogin.trim() });
      // Notify app-shell to re-read the display name on next paint.
      window.dispatchEvent(new Event("harness.profile-saved"));
      onSaved();
      toast.success(t("settings.profile.saved"));
    } catch {
      toast.error(t("settings.profile.githubUserSaveError"));
    } finally {
      setSaving(false);
    }
  }

  const currentLang = i18n.resolvedLanguage ?? i18n.language;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("settings.nav.profile")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldRow
          label={t("settings.profile.displayName")}
          hint={t("settings.profile.displayNameHint")}
        >
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("settings.profile.displayNamePlaceholder")}
            className="max-w-xs"
          />
        </FieldRow>

        <FieldRow label={t("settings.profile.language")} hint={t("settings.profile.languageHint")}>
          <Select value={currentLang} onValueChange={(v) => void i18n.changeLanguage(v)}>
            <SelectTrigger className="w-48" aria-label={t("settings.profile.language")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        {mounted && (
          <FieldRow label={t("settings.profile.theme")} hint={t("settings.profile.themeHint")}>
            <Select value={theme ?? "system"} onValueChange={setTheme}>
              <SelectTrigger className="w-48" aria-label={t("settings.profile.theme")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.profile.themeSystem")}</SelectItem>
                <SelectItem value="light">{t("settings.profile.themeLight")}</SelectItem>
                <SelectItem value="dark">{t("settings.profile.themeDark")}</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        )}

        <FieldRow
          label={t("settings.profile.defaultRange")}
          hint={t("settings.profile.defaultRangeHint")}
        >
          <Select value={defaultRange} onValueChange={setDefaultRange}>
            <SelectTrigger className="w-48" aria-label={t("settings.profile.defaultRange")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`rangeLabel.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow
          label={t("settings.profile.defaultGithubUser")}
          hint={t("settings.profile.defaultGithubUserHint")}
        >
          <Input
            aria-label={t("settings.profile.defaultGithubUser")}
            value={githubLogin}
            onChange={(e) => setGithubLogin(e.target.value)}
            placeholder={t("settings.profile.githubLoginPlaceholder")}
            className="max-w-xs"
          />
        </FieldRow>

        <div className="pt-2">
          <Button onClick={save} disabled={saving}>
            {t("settings.profile.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Capability({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[11px]",
        !enabled && "text-muted-foreground opacity-60",
      )}
    >
      {label}
    </span>
  );
}

function usageLabel(capabilities: ProviderCapabilitySet, t: (key: string) => string) {
  const usage = capabilities.usage;
  if (usage === "exact") return t("settings.capability.exactTokens");
  if (usage === "reported") return t("settings.capability.reportedTokens");
  return t("settings.capability.missingTokens");
}

function costLabel(capabilities: ProviderCapabilitySet, t: (key: string) => string) {
  const cost = capabilities.cost;
  if (cost === "estimated") return t("settings.capability.estimatedCost");
  if (cost === "reported") return t("settings.capability.reportedCost");
  return t("settings.capability.missingCost");
}

function CapabilityBadges({
  label,
  capabilities,
}: {
  label: string;
  capabilities: ProviderCapabilitySet;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Capability enabled={capabilities.tokens} label={usageLabel(capabilities, t)} />
        <Capability enabled={capabilities.tools} label={t("settings.capability.tools")} />
        <Capability enabled={capabilities.costs} label={costLabel(capabilities, t)} />
        <Capability enabled={capabilities.prompts} label={t("settings.capability.prompts")} />
      </div>
    </div>
  );
}

function ProviderSettingsCard({
  provider,
  onSaved,
}: {
  provider: ProviderConfig;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(provider.enabled);
  const [sources, setSources] = useState<ProviderSourceConfig[]>(provider.sources ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(provider.enabled);
    setSources(provider.sources ?? []);
  }, [provider]);

  function updateSource(
    key: string,
    patch: Partial<Pick<ProviderSourceConfig, "enabled" | "configured_path">>,
  ) {
    setSources((current) =>
      current.map((source) => (source.key === key ? { ...source, ...patch } : source)),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await apiPost("/api/settings", {
        providers: [
          {
            id: provider.id,
            enabled,
            sources: sources.map((source) => ({
              key: source.key,
              enabled: source.enabled,
              path: source.configured_path ?? "",
            })),
          },
        ],
      });
      await apiPost("/api/refresh", {});
      toast.success(t("settings.provider.settingsSaved", { provider: provider.label }));
      onSaved();
    } catch {
      toast.error(t("settings.provider.saveError", { provider: provider.label }));
    } finally {
      setSaving(false);
    }
  }

  const Icon = providerMeta(provider.id).Icon;
  const { messages, sessions } = provider.last_scan_counts;
  const statusText = provider.discovered
    ? t("settings.provider.status", {
        messages: messages.toLocaleString(),
        sessions: sessions.toLocaleString(),
      })
    : null;

  return (
    <IntegrationCard
      icon={<Icon className="size-5" />}
      name={provider.label}
      description={t("settings.provider.description")}
      connected={provider.discovered}
      statusText={statusText}
    >
      <div className="space-y-3">
        <CapabilityBadges
          label={t("settings.provider.supports")}
          capabilities={provider.supported ?? provider.capabilities}
        />
        <CapabilityBadges
          label={t("settings.provider.observed")}
          capabilities={provider.observed ?? provider.capabilities}
        />
        {sources.length > 0 && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("settings.provider.sources")}
            </div>
            {sources.map((source) => (
              <div key={source.key} className="space-y-2 rounded-md border bg-background p-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{source.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {source.discovered
                        ? t("settings.provider.discovered")
                        : t("settings.provider.notDiscovered")}
                      {source.env_var ? ` - ${source.env_var}` : ""}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={(event) =>
                        updateSource(source.key, { enabled: event.target.checked })
                      }
                      className="size-4 accent-primary"
                    />
                    {t("settings.provider.enabled")}
                  </label>
                </div>
                <input
                  value={source.configured_path ?? ""}
                  onChange={(event) =>
                    updateSource(source.key, { configured_path: event.target.value })
                  }
                  placeholder={source.default_path ?? t("settings.provider.setPath")}
                  className="h-8 w-full rounded-md border bg-background px-2 font-mono text-[11px] outline-none transition-colors focus:border-primary"
                  aria-label={t("settings.provider.sourcePath", { source: source.label })}
                />
                <p className="break-all text-[11px] text-muted-foreground">
                  {t("settings.provider.active")}{" "}
                  {source.active_path ?? t("settings.provider.notConfigured")}
                </p>
                {!source.discovered && source.setup_hint ? (
                  <p className="text-[11px] text-muted-foreground">{source.setup_hint}</p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <CapabilityBadges
                    label={t("settings.provider.supports")}
                    capabilities={source.supported ?? source.capabilities}
                  />
                  <CapabilityBadges
                    label={t("settings.provider.observed")}
                    capabilities={source.observed ?? source.capabilities}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4 accent-primary"
            />
            {t("settings.provider.enabled")}
          </label>
          <Button size="sm" onClick={save} disabled={saving}>
            {t("settings.provider.save")}
          </Button>
        </div>
      </div>
    </IntegrationCard>
  );
}

function planPrice(plan: ProviderPlan, t: TFunction) {
  if (typeof plan.annual_monthly_usd === "number") {
    return t("settings.plans.annualMonthly", {
      price: formatUSD(plan.annual_monthly_usd),
    });
  }
  if (typeof plan.monthly_usd === "number") {
    return plan.monthly_usd === 0
      ? formatUSD(0)
      : t("settings.plans.monthly", {
          price: formatUSD(plan.monthly_usd),
        });
  }
  return plan.price_note ?? t("settings.plans.seeSource");
}

function latestSnapshotAt(contextAt: string | null, usageAt: string | null) {
  return [contextAt, usageAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function PlansUsageSettings({ data }: { data: SettingsInfo }) {
  const { t } = useTranslation();
  const { data: plans, error, loading, refetch } = useApi<ProviderPlansBundle>("/api/provider-plans");
  const [saving, setSaving] = useState<string | null>(null);

  async function save(provider: string, planId: string) {
    setSaving(provider);
    try {
      await apiPost("/api/provider-plans", { provider, plan_id: planId });
      await refetch();
      toast.success(t("settings.plans.saved"));
    } catch {
      toast.error(t("settings.plans.saveError"));
    } finally {
      setSaving(null);
    }
  }

  async function copyStatuslineCommand() {
    try {
      await navigator.clipboard.writeText(STATUSLINE_COMMAND);
      toast.success(t("settings.plans.commandCopied"));
    } catch {
      toast.error(t("settings.plans.commandCopyError"));
    }
  }

  if (error) return <ErrorBlock error={error} />;
  if (loading || !plans) return <LoadingBlock />;

  const selectionByProvider = new Map((plans.selections ?? []).map((item) => [item.provider, item]));
  const snapshotByProvider = new Map(
    (plans.snapshot_status ?? []).map((item) => [item.provider, item]),
  );
  const providers = data.providers?.length
    ? data.providers
    : Object.keys(plans.catalog ?? {}).map((id) => ({
        id,
        label: providerMeta(id).label,
      })) as Pick<ProviderConfig, "id" | "label">[];

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
        {t("settings.plans.sourceChecked", {
          date: plans.source_checked_at ?? t("settings.plans.unknownDate"),
        })}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {providers.map((provider) => {
          const catalog = plans.catalog?.[provider.id] ?? [];
          const selectable = catalog.filter((plan) => plan.selectable);
          const selected = selectionByProvider.get(provider.id)?.plan_id ?? selectable[0]?.plan_id ?? "";
          const selectedPlan = catalog.find((plan) => plan.plan_id === selected);
          const snapshot = snapshotByProvider.get(provider.id);
          const snapshotAt = snapshot
            ? latestSnapshotAt(snapshot.context_captured_at, snapshot.plan_usage_captured_at)
            : null;
          const snapshotObserved = Boolean(
            snapshot?.context_observed || snapshot?.plan_usage_observed,
          );
          const snapshotStale = snapshotAt
            ? Date.now() - Date.parse(snapshotAt) > SNAPSHOT_STALE_MS
            : false;
          const Icon = providerMeta(provider.id).Icon;
          return (
            <Card key={provider.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-5 shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{provider.label}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {selectedPlan
                          ? planPrice(selectedPlan, t)
                          : t("settings.plans.noSelectable")}
                      </p>
                    </div>
                  </div>
                  {selectedPlan?.source_url ? (
                    <Button size="icon" variant="ghost" asChild>
                      <a href={selectedPlan.source_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FieldRow label={t("settings.plans.currentPlan")}>
                  <Select
                    value={selected}
                    onValueChange={(value) => void save(provider.id, value)}
                    disabled={saving === provider.id || selectable.length === 0}
                  >
                    <SelectTrigger
                      aria-label={t("settings.plans.currentPlan")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectable.map((plan) => (
                        <SelectItem key={plan.plan_id} value={plan.plan_id}>
                          {plan.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
                {selectedPlan ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      {selectedPlan.audience ?? t("settings.plans.audienceFallback")}
                    </Badge>
                    {selectedPlan.billing_unit ? (
                      <Badge variant="outline">{selectedPlan.billing_unit}</Badge>
                    ) : null}
                    {selectedPlan.price_note ? (
                      <Badge variant="outline">{selectedPlan.price_note}</Badge>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <CapabilityBadges
                    label={t("settings.provider.supports")}
                    capabilities={data.providers?.find((item) => item.id === provider.id)?.supported ?? {
                      tokens: false,
                      tools: false,
                      costs: false,
                      prompts: false,
                      usage: "missing",
                      cost: "missing",
                    }}
                  />
                  <CapabilityBadges
                    label={t("settings.provider.observed")}
                    capabilities={data.providers?.find((item) => item.id === provider.id)?.observed ?? {
                      tokens: false,
                      tools: false,
                      costs: false,
                      prompts: false,
                      usage: "missing",
                      cost: "missing",
                    }}
                  />
                </div>
                {provider.id === "claude" ? (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium">
                        {t("settings.plans.claudeSnapshot")}
                      </div>
                      <Badge
                        variant={snapshotObserved && !snapshotStale ? "default" : "secondary"}
                      >
                        {snapshotObserved
                          ? snapshotStale
                            ? t("settings.plans.snapshotStale")
                            : t("settings.plans.snapshotObserved")
                          : t("settings.plans.snapshotMissing")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.plans.claudeSnapshotBody")}
                      {snapshotAt
                        ? ` / ${t("common.lastSynced", {
                            date: formatDate(snapshotAt),
                          })}`
                        : ""}
                    </p>
                    {snapshot?.windows.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {snapshot.windows.map((window) => (
                          <Badge key={window.window_key} variant="outline">
                            {window.label}
                            {typeof window.used_pct === "number"
                              ? ` ${Math.round(window.used_pct)}%`
                              : ""}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <code className="block min-w-0 flex-1 overflow-x-auto rounded-sm bg-background p-2 text-[11px]">
                        {t("settings.plans.claudeSnapshotCommand")}
                      </code>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={t("settings.plans.copyCommand")}
                        onClick={() => void copyStatuslineCommand()}
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function GeneralSettings({
  data,
  onPlan,
  saving,
}: {
  data: SettingsInfo;
  onPlan: (plan: string) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("settings.general.pricingPlan")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select defaultValue={data.plan} onValueChange={onPlan} disabled={saving}>
          <SelectTrigger className="w-56" aria-label={t("settings.general.pricingPlan")}>
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
            <dt className="text-muted-foreground">{t("settings.general.claudeDir")}</dt>
            <dd className="font-mono text-xs">{data.claude_dir}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("settings.general.projectsDir")}</dt>
            <dd className="font-mono text-xs">{data.projects_dir}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function OnboardingSettings() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("settings.onboarding.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("settings.onboarding.description")}</p>
        <Button asChild>
          <Link href="/onboarding">{t("settings.onboarding.openWizard")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const RULE_METRICS = [
  "open_age_hours",
  "open_no_review_age_hours",
  "awaiting_merge_age_hours",
  "churn",
  "additions",
  "deletions",
  "changed_files",
  "churn_per_file",
  "additions_per_file",
  "single_file_churn",
  "deletion_ratio_pct",
  "additions_without_cleanup",
  "reviews_per_kloc",
  "large_pr_low_reviews",
  "merge_without_review",
  "review_wait_large_churn",
  "review_wait_hours",
  "cycle_hours",
  "title_length",
  "title_too_short",
  "missing_conventional_prefix",
  "missing_ticket",
  "branch_length",
  "branch_missing_ticket",
  "generic_branch_name",
  "non_standard_base",
  "head_equals_base",
  "no_ai_large_churn",
  "awaiting_review_count",
  "awaiting_merge_count",
  "open_count",
  "high_review_time_count",
  "ai_share_pct",
  "avg_cycle_hours",
  "avg_review_wait_hours",
  "avg_churn",
];

function normalizePrAiEngineId(value: string | null | undefined): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "codex":
    case "codex-cli":
    case "codex_cli":
      return "codex_cli";
    case "claude":
    case "claude-cli":
    case "claude_cli":
      return "claude_cli";
    case "gemini":
    case "gemini-cli":
    case "gemini_cli":
      return "gemini_cli";
    default:
      return value ?? "";
  }
}

function cloneCorrelationConfig(config: PrSessionCorrelationConfig): PrSessionCorrelationConfig {
  return {
    ...config,
    weights: { ...config.weights },
  };
}

const RULE_CATEGORIES = [
  "flow",
  "review",
  "size",
  "risk",
  "ai",
  "dry",
  "kiss",
  "solid",
  "yagni",
  "naming",
  "traceability",
];

function newRule(): PrInsightRule {
  return {
    id: "",
    title: "",
    description: null,
    enabled: true,
    severity: "warning",
    category: "flow",
    scope: "pr",
    metric: "churn",
    operator: "gte",
    threshold: 500,
    recommendation: "",
    custom: true,
  };
}

function DeterministicRulesSettings() {
  const { t } = useTranslation();
  const { data, error, loading, refetch } = useApi<PrInsightRule[]>(
    "/api/pull-requests/insight-rules",
  );
  const [draft, setDraft] = useState<PrInsightRule>(newRule);
  const [saving, setSaving] = useState(false);
  const rules = Array.isArray(data) ? data : [];
  const customCount = rules.filter((rule) => rule.custom).length;

  function patchDraft(patch: Partial<PrInsightRule>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function upsert(rule: PrInsightRule) {
    const id = rule.id.trim();
    if (!id) {
      toast.error(t("settings.rules.idRequired", { defaultValue: "Rule id is required" }));
      return;
    }
    if (!rule.title.trim() || !rule.recommendation.trim()) {
      toast.error(
        t("settings.rules.titleRecommendationRequired", {
          defaultValue: "Title and recommendation are required",
        }),
      );
      return;
    }
    setSaving(true);
    try {
      const next = [
        ...rules.filter((item) => item.custom && item.id !== id),
        {
          ...rule,
          id,
          title: rule.title.trim(),
          category: rule.category.trim() || "flow",
          recommendation: rule.recommendation.trim(),
          custom: true,
        },
      ];
      await apiPost<PrInsightRule[]>("/api/pull-requests/insight-rules", { rules: next });
      await refetch();
      setDraft(newRule());
      toast.success(t("settings.rules.saved", { defaultValue: "Deterministic rule saved" }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: PrInsightRule) {
    setSaving(true);
    try {
      await apiPost<PrInsightRule[]>("/api/pull-requests/insight-rules", {
        rules: rules.filter((item) => item.custom && item.id !== rule.id),
      });
      await refetch();
      if (draft.id === rule.id) setDraft(newRule());
      toast.success(rule.custom ? t("settings.rules.removed") : t("settings.rules.overrideRemoved"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBlock error={error} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.rules.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>{t("settings.rules.totalRules", { count: rules.length })}</span>
            <span>{t("settings.rules.customOverrides", { count: customCount })}</span>
          </div>
          {loading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-lg border p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{rule.title}</span>
                        <Badge variant={rule.custom ? "default" : "outline"}>
                          {rule.custom ? t("common.custom") : t("common.builtIn")}
                        </Badge>
                        <Badge variant="outline">{rule.category}</Badge>
                        <Badge variant="outline">{rule.severity}</Badge>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {rule.id}: {rule.scope}.{rule.metric} {rule.operator} {rule.threshold}
                      </p>
                      <p className="text-sm text-muted-foreground">{rule.recommendation}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => upsert({ ...rule, enabled: !rule.enabled, custom: true })}
                        disabled={saving}
                      >
                        {rule.enabled ? t("settings.rules.disable") : t("settings.rules.enable")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDraft({ ...rule, custom: true })}
                      >
                        {t("settings.rules.edit")}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={t("settings.rules.clone", { id: rule.id })}
                        onClick={() =>
                          setDraft({
                            ...rule,
                            id: `${rule.id}-custom`,
                            title: t("settings.rules.copySuffix", { title: rule.title }),
                            custom: true,
                          })
                        }
                      >
                        <Copy className="size-4" />
                      </Button>
                      {rule.custom ? (
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={t("settings.rules.delete", { id: rule.id })}
                          onClick={() => remove(rule)}
                          disabled={saving}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {draft.id ? t("settings.rules.editTitle") : t("settings.rules.createTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow
            label={t("settings.rules.id")}
            hint={t("settings.rules.idHint")}
          >
            <Input
              aria-label={t("settings.rules.id")}
              value={draft.id}
              onChange={(e) => patchDraft({ id: e.target.value })}
              placeholder={t("settings.rules.placeholders.id")}
            />
          </FieldRow>
          <FieldRow label={t("settings.rules.titleField")}>
            <Input
              aria-label={t("settings.rules.titleField")}
              value={draft.title}
              onChange={(e) => patchDraft({ title: e.target.value })}
              placeholder={t("settings.rules.placeholders.title")}
            />
          </FieldRow>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow label={t("settings.rules.category")}>
              <Select
                value={draft.category}
                onValueChange={(value) => patchDraft({ category: value })}
              >
                <SelectTrigger aria-label={t("settings.rules.category")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label={t("settings.rules.severity")}>
              <Select
                value={draft.severity}
                onValueChange={(value) => patchDraft({ severity: value })}
              >
                <SelectTrigger aria-label={t("settings.rules.severity")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">{t("enums.severity.info")}</SelectItem>
                  <SelectItem value="warning">{t("enums.severity.warning")}</SelectItem>
                  <SelectItem value="critical">{t("enums.severity.critical")}</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow label={t("settings.rules.scope")}>
              <Select value={draft.scope} onValueChange={(value) => patchDraft({ scope: value })}>
                <SelectTrigger aria-label={t("settings.rules.scope")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pr">{t("enums.ruleScope.pr")}</SelectItem>
                  <SelectItem value="aggregate">{t("enums.ruleScope.aggregate")}</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label={t("settings.rules.metric")}>
              <Select value={draft.metric} onValueChange={(value) => patchDraft({ metric: value })}>
                <SelectTrigger aria-label={t("settings.rules.metric")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_METRICS.map((metric) => (
                    <SelectItem key={metric} value={metric}>
                      {metric}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <FieldRow label={t("settings.rules.operator")}>
              <Select
                value={draft.operator}
                onValueChange={(value) => patchDraft({ operator: value })}
              >
                <SelectTrigger aria-label={t("settings.rules.operator")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gt">{t("enums.operator.gt")}</SelectItem>
                  <SelectItem value="gte">{t("enums.operator.gte")}</SelectItem>
                  <SelectItem value="lt">{t("enums.operator.lt")}</SelectItem>
                  <SelectItem value="lte">{t("enums.operator.lte")}</SelectItem>
                  <SelectItem value="eq">{t("enums.operator.eq")}</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label={t("settings.rules.threshold")}>
              <Input
                aria-label={t("settings.rules.threshold")}
                type="number"
                value={draft.threshold}
                onChange={(e) => patchDraft({ threshold: Number(e.target.value) })}
              />
            </FieldRow>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => patchDraft({ enabled: e.target.checked })}
                className="size-4 accent-primary"
              />
              {t("settings.rules.enabled")}
            </label>
          </div>
          <FieldRow label={t("settings.rules.description")}>
            <textarea
              aria-label={t("settings.rules.description")}
              value={draft.description ?? ""}
              onChange={(e) => patchDraft({ description: e.target.value || null })}
              className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </FieldRow>
          <FieldRow label={t("settings.rules.recommendation")}>
            <textarea
              aria-label={t("settings.rules.recommendation")}
              value={draft.recommendation}
              onChange={(e) => patchDraft({ recommendation: e.target.value })}
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </FieldRow>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => upsert(draft)} disabled={saving}>
              <Plus className="size-4" />
              {t("settings.rules.save")}
            </Button>
            <Button variant="outline" onClick={() => setDraft(newRule())}>
              {t("settings.rules.clear")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AiFeaturesSettings({ data, onSaved }: { data: SettingsInfo; onSaved: () => void }) {
  const { t } = useTranslation();
  const engines = useApi<PrAiEngine[]>("/api/pull-requests/ai-engines");
  const [engine, setEngine] = useState("");
  const [mode, setMode] = useState("per_pr");
  const [businessPrompt, setBusinessPrompt] = useState("");
  const [maturityPrompt, setMaturityPrompt] = useState("");
  const [sessionPrompt, setSessionPrompt] = useState("");
  const [sessionConfig, setSessionConfig] = useState<PrSessionCorrelationConfig>(() =>
    normalizePrSessionCorrelationConfig(null),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const normalized = normalizePrAiEngineId(data.pr_ai_default_engine);
    const options = Array.isArray(engines.data) ? engines.data : [];
    setEngine(
      options.some((item) => item.id === normalized)
        ? normalized
        : (data.pr_ai_default_engine ?? ""),
    );
    setMode(data.pr_ai_default_generation_mode ?? "per_pr");
    setBusinessPrompt(data.pr_business_value_prompt ?? "");
    setMaturityPrompt(data.pr_ai_maturity_prompt ?? "");
    setSessionPrompt(data.pr_session_correlation_prompt ?? "");
    setSessionConfig(
      cloneCorrelationConfig(
        normalizePrSessionCorrelationConfig(data.pr_session_correlation_config),
      ),
    );
  }, [
    data.pr_ai_default_engine,
    data.pr_ai_default_generation_mode,
    data.pr_business_value_prompt,
    data.pr_ai_maturity_prompt,
    data.pr_session_correlation_config,
    data.pr_session_correlation_prompt,
    engines.data,
  ]);

  async function save() {
    setSaving(true);
    try {
      await apiPost("/api/settings", {
        pr_ai_default_engine: engine,
        pr_ai_default_generation_mode: mode,
        pr_business_value_prompt: businessPrompt,
        pr_ai_maturity_prompt: maturityPrompt,
        pr_session_correlation_prompt: sessionPrompt,
        pr_session_correlation_config: sessionConfig,
      });
      onSaved();
      toast.success(t("settings.aiFeatures.saved"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  const engineOptions = [
    {
      value: "__auto",
      label: t("pages.pullRequests.aiIndexes.autoEngine"),
      description: t("pages.pullRequests.aiIndexes.autoEngineDescription"),
    },
    ...(Array.isArray(engines.data) ? engines.data : []).map((item) => ({
      value: item.id,
      label: item.available
        ? item.label
        : t("pages.pullRequests.aiIndexes.notInstalled", { name: item.label }),
      description: item.notes,
    })),
  ];
  const modeOptions = [
    { value: "per_pr", label: t("enums.generationMode.per_pr") },
    { value: "all_mine", label: t("enums.generationMode.all_mine") },
    { value: "repo", label: t("enums.generationMode.repo") },
    { value: "org", label: t("enums.generationMode.org") },
    { value: "batch", label: t("enums.generationMode.batch") },
  ];

  function patchSessionConfig(patch: Partial<PrSessionCorrelationConfig>) {
    setSessionConfig((current) => cloneCorrelationConfig({ ...current, ...patch }));
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.aiFeatures.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FieldRow
            label={t("settings.aiFeatures.defaultEngine")}
            hint={t("settings.aiFeatures.defaultEngineHint")}
          >
            <SearchableSelect
              label={t("settings.aiFeatures.defaultEngineLabel")}
              value={engine || "__auto"}
              onValueChange={(value) => setEngine(value === "__auto" ? "" : value)}
              options={engineOptions}
            />
          </FieldRow>

          <FieldRow
            label={t("settings.aiFeatures.defaultMode")}
            hint={t("settings.aiFeatures.defaultModeHint")}
          >
            <SearchableSelect
              label={t("settings.aiFeatures.defaultModeLabel")}
              value={mode}
              onValueChange={setMode}
              options={modeOptions}
            />
          </FieldRow>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("settings.aiFeatures.correlationTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.aiFeatures.correlationDescription")}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sessionConfig.enabled}
                onChange={(event) => patchSessionConfig({ enabled: event.target.checked })}
                className="size-4 accent-primary"
              />
              {t("common.enabled")}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow label={t("settings.aiFeatures.beforeMinutes")}>
                <Input
                  aria-label={t("settings.aiFeatures.beforeMinutesAria")}
                  type="number"
                  min={0}
                  max={10080}
                  value={sessionConfig.time_window_before_minutes}
                  onChange={(event) =>
                    patchSessionConfig({
                      time_window_before_minutes: Number(event.target.value),
                    })
                  }
                />
              </FieldRow>
              <FieldRow label={t("settings.aiFeatures.afterMinutes")}>
                <Input
                  aria-label={t("settings.aiFeatures.afterMinutesAria")}
                  type="number"
                  min={0}
                  max={10080}
                  value={sessionConfig.time_window_after_minutes}
                  onChange={(event) =>
                    patchSessionConfig({
                      time_window_after_minutes: Number(event.target.value),
                    })
                  }
                />
              </FieldRow>
              <FieldRow label={t("settings.aiFeatures.minConfidence")}>
                <Input
                  aria-label={t("settings.aiFeatures.minConfidenceAria")}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sessionConfig.min_confidence}
                  onChange={(event) =>
                    patchSessionConfig({ min_confidence: Number(event.target.value) })
                  }
                />
              </FieldRow>
              <FieldRow label={t("settings.aiFeatures.maxSessions")}>
                <Input
                  aria-label={t("settings.aiFeatures.maxSessionsAria")}
                  type="number"
                  min={1}
                  max={25}
                  value={sessionConfig.max_sessions_per_pr}
                  onChange={(event) =>
                    patchSessionConfig({ max_sessions_per_pr: Number(event.target.value) })
                  }
                />
              </FieldRow>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            {t("settings.aiFeatures.localOnlyNote")}
          </div>

          <Button onClick={save} disabled={saving}>
            <Sparkles className="size-4" />
            {t("settings.aiFeatures.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.aiFeatures.promptsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FieldRow
            label={t("settings.aiFeatures.businessPrompt")}
            hint={t("settings.aiFeatures.businessPromptHint")}
          >
            <textarea
              aria-label={t("settings.aiFeatures.businessPrompt")}
              value={businessPrompt}
              onChange={(event) => setBusinessPrompt(event.target.value)}
              className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </FieldRow>
          <FieldRow
            label={t("settings.aiFeatures.maturityPrompt")}
            hint={t("settings.aiFeatures.maturityPromptHint")}
          >
            <textarea
              aria-label={t("settings.aiFeatures.maturityPrompt")}
              value={maturityPrompt}
              onChange={(event) => setMaturityPrompt(event.target.value)}
              className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </FieldRow>
          <FieldRow
            label={t("settings.aiFeatures.sessionPrompt")}
            hint={t("settings.aiFeatures.sessionPromptHint")}
          >
            <textarea
              aria-label={t("settings.aiFeatures.sessionPrompt")}
              value={sessionPrompt}
              onChange={(event) => setSessionPrompt(event.target.value)}
              className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </FieldRow>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { data, error, loading, refetch } = useApi<SettingsInfo>("/api/settings");
  const [section, setSection] = useState<SectionId>("profile");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "section",
    ) as SectionId | null;
    if (
      requested &&
      [
        "profile",
        "integrations",
        "sources",
        "plans_usage",
        "rules",
        "ai_features",
        "general",
        "onboarding",
      ].includes(requested)
    ) {
      setSection(requested);
    }
  }, []);

  const SECTIONS = useMemo(
    () => [
      {
        id: "profile" as SectionId,
        label: t("settings.nav.profile"),
        icon: User,
        description: t("settings.nav.profileDesc"),
      },
      {
        id: "integrations" as SectionId,
        label: t("settings.nav.integrations"),
        icon: Plug,
        description: t("settings.nav.integrationsDesc"),
      },
      {
        id: "sources" as SectionId,
        label: t("settings.nav.sources"),
        icon: Boxes,
        description: t("settings.nav.sourcesDesc"),
      },
      {
        id: "plans_usage" as SectionId,
        label: t("settings.nav.plansUsage"),
        icon: CreditCard,
        description: t("settings.nav.plansUsageDesc"),
      },
      {
        id: "rules" as SectionId,
        label: t("settings.nav.rules"),
        icon: GitPullRequest,
        description: t("settings.nav.rulesDesc"),
      },
      {
        id: "ai_features" as SectionId,
        label: t("settings.nav.aiFeatures"),
        icon: Sparkles,
        description: t("settings.nav.aiFeaturesDesc"),
      },
      {
        id: "general" as SectionId,
        label: t("settings.nav.general"),
        icon: SlidersHorizontal,
        description: t("settings.nav.generalDesc"),
      },
      {
        id: "onboarding" as SectionId,
        label: t("settings.nav.onboarding"),
        icon: Rocket,
        description: t("settings.nav.onboardingDesc"),
      },
    ],
    [t],
  );

  async function setPlan(plan: string) {
    setSaving(true);
    try {
      await apiPost("/api/plan", { plan });
      toast.success(t("settings.general.planSet", { plan }));
      refetch();
    } catch {
      toast.error(t("settings.general.planError"));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const providers = data.providers ?? [];

  return (
    <>
      <PageTitle title={t("pages.settings.title")} description={t("pages.settings.description")} />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="w-full shrink-0 lg:w-56" aria-label={t("pages.settings.sections")}>
          <div className="sticky top-4 space-y-1">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === section;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                    isActive && "bg-muted font-medium",
                  )}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{active.label}</h2>
            <p className="text-sm text-muted-foreground">{active.description}</p>
          </div>

          {section === "profile" && <ProfileSettings data={data} onSaved={refetch} />}

          {section === "integrations" && (
            <div className="space-y-4">
              <IngestStatusPanel />
              <IntegrationsSettings />
            </div>
          )}

          {section === "sources" &&
            (providers.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {providers.map((provider) => (
                  <ProviderSettingsCard key={provider.id} provider={provider} onSaved={refetch} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.provider.noSources")}</p>
            ))}

          {section === "plans_usage" && <PlansUsageSettings data={data} />}

          {section === "rules" && <DeterministicRulesSettings />}

          {section === "ai_features" && <AiFeaturesSettings data={data} onSaved={refetch} />}

          {section === "general" && (
            <GeneralSettings data={data} onPlan={setPlan} saving={saving} />
          )}

          {section === "onboarding" && <OnboardingSettings />}
        </div>
      </div>
    </>
  );
}
