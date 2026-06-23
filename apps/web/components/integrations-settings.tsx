"use client";

// Integrations panel. Three views, all in the same right pane (visual base:
// shadcnblocks settings-integrations8 + integration10):
//   • list    — connected integrations as IntegrationCards + "Add new integration".
//   • browse  — a gallery of integrations you can still add (shown straight away when
//               nothing is connected yet).
//   • connect — the chosen integration's connect flow, inside the same card shell.
// Tokens are stored encrypted at rest by the server; this panel only ever POSTs them.
// Every async action gives toast feedback; GitHub also surfaces login, rate budget,
// live progress, a per-org repo picker, and backfill/auto-sync settings.
import { GoogleConnect } from "@/components/google-connect";
import { IntegrationLogo } from "@/components/integration-logo";
import { GithubRepoPicker } from "@/components/integrations/github-repo-picker";
import { GithubSyncProgress } from "@/components/integrations/github-progress";
import { GithubSyncSettings } from "@/components/integrations/github-sync-settings";
import { IntegrationGallery, type GalleryItem } from "@/components/integrations/integration-gallery";
import { IntegrationCard } from "@/components/settings/integration-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { useApi } from "@/hooks/use-api";
import { apiDelete, apiPost } from "@/lib/api";
import { formatDateShort } from "@/lib/format";
import { rateBudgetLabel, rateBudgetTone } from "@/lib/github";
import type { GithubIntegration, GithubProgress, IntegrationsInfo } from "@/lib/types";
import { ArrowLeft, Plus } from "lucide-react";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

interface ConnectResult {
  login?: string;
  scopes?: string[];
  has_repo_scope?: boolean;
}
interface SyncStarted {
  started: boolean;
  reason?: string;
}

type IntegrationId = "github" | "google";
type View = "list" | "browse" | "connect-github" | "connect-google";

const META: Record<IntegrationId, { name: string; description: string; icon: ReactNode }> = {
  github: {
    name: "GitHub",
    description: "Pull requests, releases, and CI runs for your repos.",
    icon: <IntegrationLogo id="github" className="size-5" />,
  },
  google: {
    name: "Google Calendar",
    description: "Overlay meetings on your activity and measure their impact.",
    icon: <IntegrationLogo id="google-calendar" className="size-6" />,
  },
};

const TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
};

function RateChip({ gh }: { gh: GithubIntegration }) {
  if (!gh.rate || gh.rate.remaining == null) return null;
  const tone = rateBudgetTone(gh.rate.remaining, gh.rate.limit);
  return (
    <span className="text-xs text-muted-foreground">
      API budget{" "}
      <span className={`font-medium tabular-nums ${TONE[tone]}`}>{rateBudgetLabel(gh.rate)}</span>
    </span>
  );
}

/** GitHub connect flow: validate + store a PAT. On success the parent returns to the list. */
function GithubConnectForm({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!token.trim()) return;
    setBusy(true);
    const p = apiPost<ConnectResult>("/api/integrations/github", { token: token.trim() });
    toast.promise(p, {
      loading: "Validating token…",
      success: (r) =>
        r.login
          ? `Connected as ${r.login}${r.has_repo_scope === false ? " (no repo scope — private repos won't sync)" : ""}`
          : "GitHub connected",
      error: (e) => `Could not connect: ${String(e).replace(/^Error:\s*/, "")}`,
    });
    try {
      await p;
      setToken("");
      onConnected();
    } catch {
      /* reported by toast.promise */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          placeholder="ghp_… (repo read scope)"
          aria-label="GitHub token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="max-w-xs"
        />
        <Button size="sm" onClick={connect} disabled={busy || !token.trim()}>
          Connect
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A fine-grained or classic PAT with read access to your repos. Stored encrypted at rest;
        used only to fetch pull requests, releases, and Actions runs.
      </p>
    </div>
  );
}

/** GitHub management panel shown once connected: sync, disconnect, budget, progress, repos. */
function GithubConnectedPanel({
  gh,
  githubProgress,
  onChange,
}: {
  gh: GithubIntegration;
  githubProgress: GithubProgress | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    const p = apiPost<SyncStarted>("/api/integrations/github/sync", {});
    toast.promise(p, {
      loading: "Starting sync…",
      success: (r) => (r.started ? "Sync started — progress below" : "Sync already running"),
      error: "Could not start sync",
    });
    try {
      await p;
      onChange();
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    const p = apiDelete("/api/integrations/github");
    toast.promise(p, {
      loading: "Disconnecting…",
      success: "GitHub disconnected",
      error: "Could not disconnect",
    });
    try {
      await p;
      onChange();
    } catch {
      /* reported */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={sync} disabled={busy || gh.syncing}>
          {gh.syncing ? "Syncing…" : "Sync now"}
        </Button>
        <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}>
          Disconnect
        </Button>
        {gh.last_sync ? (
          <span className="text-xs text-muted-foreground">
            Last synced {formatDateShort(gh.last_sync)}
          </span>
        ) : null}
        <RateChip gh={gh} />
      </div>
      <GithubSyncProgress progress={githubProgress} />
      <GithubRepoPicker onChange={onChange} />
      <GithubSyncSettings onSaved={onChange} />
    </div>
  );
}

/** A connect-flow view: a back link above the chosen integration's card. */
function ConnectShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-muted-foreground">
        <ArrowLeft className="size-4" /> Back
      </Button>
      {children}
    </div>
  );
}

export function IntegrationsSettings() {
  const { data, refetch } = useApi<IntegrationsInfo>("/api/integrations");
  const { githubProgress, githubSyncVersion } = useContext(ScanSyncContext);
  const [view, setView] = useState<View>("list");
  const gh = data?.github;
  const githubConnected = !!gh?.configured;
  const googleConnected = !!data?.google?.configured;
  const anyConnected = githubConnected || googleConnected;

  // Refetch status when a sync finishes (counts / last-sync / budget change).
  useEffect(() => {
    if (githubSyncVersion > 0) refetch();
  }, [githubSyncVersion, refetch]);

  // With nothing connected yet, open straight onto the gallery instead of an empty list.
  const effectiveView: View = view === "list" && !anyConnected ? "browse" : view;
  const backFromConnect = () => setView(anyConnected ? "list" : "browse");

  if (effectiveView === "connect-github") {
    return (
      <ConnectShell onBack={backFromConnect}>
        <IntegrationCard
          icon={META.github.icon}
          name={META.github.name}
          description={META.github.description}
          connected={false}
        >
          <GithubConnectForm
            onConnected={() => {
              setView("list");
              refetch();
            }}
          />
        </IntegrationCard>
      </ConnectShell>
    );
  }

  if (effectiveView === "connect-google") {
    return (
      <ConnectShell onBack={backFromConnect}>
        <IntegrationCard
          icon={META.google.icon}
          name={META.google.name}
          description={META.google.description}
          connected={false}
        >
          <GoogleConnect connected={false} lastSync={null} onChange={refetch} />
        </IntegrationCard>
      </ConnectShell>
    );
  }

  if (effectiveView === "browse") {
    const items: GalleryItem[] = [];
    if (!githubConnected)
      items.push({ id: "github", ...META.github, onConnect: () => setView("connect-github") });
    if (!googleConnected)
      items.push({ id: "google", ...META.google, onConnect: () => setView("connect-google") });
    return (
      <div className="space-y-4">
        {anyConnected ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("list")}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft className="size-4" /> Back to integrations
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect an integration to enrich your dashboard.
          </p>
        )}
        <IntegrationGallery items={items} />
      </div>
    );
  }

  // list view — at least one integration connected.
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setView("browse")}>
          <Plus className="size-4" /> Add new integration
        </Button>
      </div>
      {githubConnected && gh ? (
        <IntegrationCard
          icon={META.github.icon}
          name={META.github.name}
          description={META.github.description}
          connected
          statusText={gh.login ? `Connected as ${gh.login}` : null}
        >
          <GithubConnectedPanel gh={gh} githubProgress={githubProgress} onChange={refetch} />
        </IntegrationCard>
      ) : null}
      {googleConnected ? (
        <IntegrationCard
          icon={META.google.icon}
          name={META.google.name}
          description={META.google.description}
          connected
        >
          <GoogleConnect
            connected
            lastSync={data?.google?.last_sync ?? null}
            onChange={refetch}
          />
        </IntegrationCard>
      ) : null}
    </div>
  );
}
