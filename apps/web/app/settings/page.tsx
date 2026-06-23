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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import { providerMeta } from "@/lib/providers";
import type {
  ProviderCapabilitySet,
  ProviderConfig,
  ProviderSourceConfig,
  SettingsInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Boxes, Plug, Rocket, SlidersHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const PLANS = ["api", "pro", "max", "max-20x", "team", "team-premium"];

type SectionId = "integrations" | "sources" | "general" | "onboarding";
const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; description: string }[] = [
  { id: "integrations", label: "Integrations", icon: Plug, description: "Connect GitHub and Google Calendar." },
  { id: "sources", label: "AI sources", icon: Boxes, description: "Which local AI coding tools to scan." },
  { id: "general", label: "General", icon: SlidersHorizontal, description: "Pricing plan and scan locations." },
  { id: "onboarding", label: "Onboarding", icon: Rocket, description: "Re-run the first-run setup wizard." },
];

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
  const { data, error, loading, refetch } = useApi<SettingsInfo>("/api/settings");
  const [section, setSection] = useState<SectionId>("integrations");
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

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const providers = data.providers ?? [];

  return (
    <>
      <PageTitle title="Settings" description="Integrations, AI sources, plan and scan locations." />
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
