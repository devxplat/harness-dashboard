"use client";

// Settings, organized as a sectioned page (visual base: shadcnblocks
// settings-integrations8 — left section nav + content pane). One "Integrations"
// section holds every integration together; the others cover the rest of the
// settings we need.
import { IngestStatusPanel } from "@/components/ingest/ingest-status-panel";
import { IntegrationsSettings } from "@/components/integrations-settings";
import { IntegrationCard } from "@/components/settings/integration-card";
import { ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { LOCALES } from "@/lib/i18n/config";
import { providerMeta } from "@/lib/providers";
import { RANGES } from "@/lib/range";
import type {
  ProviderCapabilitySet,
  ProviderConfig,
  ProviderSourceConfig,
  SettingsInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Boxes, Plug, Rocket, SlidersHorizontal, User } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const PLANS = ["api", "pro", "max", "max-20x", "team", "team-premium"];

type SectionId = "profile" | "integrations" | "sources" | "general" | "onboarding";

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

function ProfileSettings() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [defaultRange, setDefaultRange] = useState("30d");

  useEffect(() => {
    setMounted(true);
    setDisplayName(localStorage.getItem("harness.displayName") ?? "");
    const saved = localStorage.getItem("harness.defaultRange");
    if (saved && ["7d", "30d", "90d", "all"].includes(saved)) setDefaultRange(saved);
  }, []);

  function save() {
    localStorage.setItem("harness.displayName", displayName);
    localStorage.setItem("harness.defaultRange", defaultRange);
    // Notify app-shell to re-read the display name on next paint.
    window.dispatchEvent(new Event("harness.profile-saved"));
    toast.success(t("settings.profile.saved"));
  }

  const currentLang = i18n.resolvedLanguage ?? i18n.language;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("settings.nav.profile")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldRow label={t("settings.profile.displayName")} hint={t("settings.profile.displayNameHint")}>
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

        <FieldRow label={t("settings.profile.defaultRange")} hint={t("settings.profile.defaultRangeHint")}>
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

        <div className="pt-2">
          <Button onClick={save}>{t("settings.profile.save")}</Button>
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

function usageLabel(capabilities: ProviderCapabilitySet) {
  const usage = capabilities.usage;
  if (usage === "exact") return "exact tokens";
  if (usage === "reported") return "reported tokens";
  return "missing tokens";
}

function costLabel(capabilities: ProviderCapabilitySet) {
  const cost = capabilities.cost;
  if (cost === "estimated") return "estimated cost";
  if (cost === "reported") return "reported cost";
  return "missing cost";
}

function CapabilityBadges({
  label,
  capabilities,
}: {
  label: string;
  capabilities: ProviderCapabilitySet;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Capability enabled={capabilities.tokens} label={usageLabel(capabilities)} />
        <Capability enabled={capabilities.tools} label="tools" />
        <Capability enabled={capabilities.costs} label={costLabel(capabilities)} />
        <Capability enabled={capabilities.prompts} label="prompts" />
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
      toast.success(`${provider.label} settings saved`);
      onSaved();
    } catch {
      toast.error(`Could not save ${provider.label}`);
    } finally {
      setSaving(false);
    }
  }

  const Icon = providerMeta(provider.id).Icon;
  const { messages, sessions } = provider.last_scan_counts;
  const statusText = provider.discovered
    ? `${messages.toLocaleString()} messages - ${sessions.toLocaleString()} sessions`
    : null;

  return (
    <IntegrationCard
      icon={<Icon className="size-5" />}
      name={provider.label}
      description="Local CLI sessions scanned for tokens, tools and cost."
      connected={provider.discovered}
      statusText={statusText}
    >
      <div className="space-y-3">
        <CapabilityBadges label="Supports" capabilities={provider.supported ?? provider.capabilities} />
        <CapabilityBadges label="Observed" capabilities={provider.observed ?? provider.capabilities} />
        {sources.length > 0 && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2">
            <div className="text-xs font-medium text-muted-foreground">Sources</div>
            {sources.map((source) => (
              <div key={source.key} className="space-y-2 rounded-md border bg-background p-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{source.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {source.discovered ? "Discovered" : "Not discovered"}
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
                    Enabled
                  </label>
                </div>
                <input
                  value={source.configured_path ?? ""}
                  onChange={(event) =>
                    updateSource(source.key, { configured_path: event.target.value })
                  }
                  placeholder={source.default_path ?? "Set path"}
                  className="h-8 w-full rounded-md border bg-background px-2 font-mono text-[11px] outline-none transition-colors focus:border-primary"
                  aria-label={`${source.label} path`}
                />
                <p className="break-all text-[11px] text-muted-foreground">
                  Active: {source.active_path ?? "not configured"}
                </p>
                {!source.discovered && source.setup_hint ? (
                  <p className="text-[11px] text-muted-foreground">{source.setup_hint}</p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <CapabilityBadges
                    label="Supports"
                    capabilities={source.supported ?? source.capabilities}
                  />
                  <CapabilityBadges
                    label="Observed"
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
            Enabled
          </label>
          <Button size="sm" onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </IntegrationCard>
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
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Pricing plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select defaultValue={data.plan} onValueChange={onPlan} disabled={saving}>
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
  );
}

function OnboardingSettings() {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Setup wizard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Run the first-run setup again any time — pick your copilots, connect GitHub and your
          calendar, and configure the initial scan + backfill. It opens as a full-screen flow.
        </p>
        <Button asChild>
          <Link href="/onboarding">Open setup wizard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { data, error, loading, refetch } = useApi<SettingsInfo>("/api/settings");
  const [section, setSection] = useState<SectionId>("profile");
  const [saving, setSaving] = useState(false);

  const SECTIONS = useMemo(
    () => [
      { id: "profile" as SectionId, label: t("settings.nav.profile"), icon: User, description: t("settings.nav.profileDesc") },
      { id: "integrations" as SectionId, label: t("settings.nav.integrations"), icon: Plug, description: t("settings.nav.integrationsDesc") },
      { id: "sources" as SectionId, label: t("settings.nav.sources"), icon: Boxes, description: t("settings.nav.sourcesDesc") },
      { id: "general" as SectionId, label: t("settings.nav.general"), icon: SlidersHorizontal, description: t("settings.nav.generalDesc") },
      { id: "onboarding" as SectionId, label: t("settings.nav.onboarding"), icon: Rocket, description: t("settings.nav.onboardingDesc") },
    ],
    [t],
  );

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

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const providers = data.providers ?? [];

  return (
    <>
      <PageTitle title={t("pages.settings.title")} description={t("pages.settings.description")} />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="w-full shrink-0 lg:w-56" aria-label="Settings sections">
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

          {section === "profile" && <ProfileSettings />}

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
              <p className="text-sm text-muted-foreground">No AI sources detected yet.</p>
            ))}

          {section === "general" && <GeneralSettings data={data} onPlan={setPlan} saving={saving} />}

          {section === "onboarding" && <OnboardingSettings />}
        </div>
      </div>
    </>
  );
}
