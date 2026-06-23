"use client";

// Repo picker: locally-discovered GitHub repos grouped by org, each toggleable
// (and a per-org enable/disable). Only enabled repos are synced. Every toggle gives
// toast feedback and re-reads the list.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import { formatDateShort } from "@/lib/format";
import type { GithubReposResponse } from "@/lib/types";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function GithubRepoPicker({ onChange }: { onChange?: () => void }) {
  const { data, error, loading, refetch } = useApi<GithubReposResponse>(
    "/api/integrations/github/repos",
  );
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(body: { repo_key?: string; owner?: string; enabled: boolean }, key: string) {
    setPending(key);
    const p = apiPost("/api/integrations/github/repos/toggle", body);
    toast.promise(p, {
      loading: "Updating…",
      success: body.enabled ? "Repo enabled for sync" : "Repo disabled",
      error: "Could not update repo",
    });
    try {
      await p;
      refetch();
      onChange?.();
    } catch {
      /* toast already reported */
    } finally {
      setPending(null);
    }
  }

  if (error) return <p className="text-xs text-destructive">Could not load repos: {error}</p>;
  if (loading || !data) return <p className="text-xs text-muted-foreground">Loading repos…</p>;
  const orgs = data.orgs ?? [];
  const totalRepos = data.total_repos ?? orgs.reduce((n, o) => n + o.total, 0);
  const enabledRepos = data.enabled_repos ?? orgs.reduce((n, o) => n + o.enabled_count, 0);
  if (totalRepos === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No GitHub repos discovered yet — use Claude Code in a repo with a GitHub origin, then rescan.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {enabledRepos} of {totalRepos} repos enabled for sync
      </p>
      {orgs.map((org) => (
        <Collapsible key={org.owner} defaultOpen className="rounded-lg border border-border/60">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-sm font-medium">
              <ChevronDown className="size-4 text-muted-foreground" />
              {org.owner}
              <Badge variant="secondary" className="ml-1 tabular-nums">
                {org.enabled_count}/{org.total}
              </Badge>
            </CollapsibleTrigger>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={pending === `org:${org.owner}`}
                onClick={() => toggle({ owner: org.owner, enabled: true }, `org:${org.owner}`)}
              >
                Enable all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending === `org:${org.owner}`}
                onClick={() => toggle({ owner: org.owner, enabled: false }, `org:${org.owner}`)}
              >
                Disable all
              </Button>
            </div>
          </div>
          <CollapsibleContent>
            <ul className="divide-y divide-border/50 border-t border-border/50">
              {org.repos.map((r) => (
                <li key={r.repo_key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm">{r.repo}</span>
                    {r.last_synced_at ? (
                      <span className="text-[11px] text-muted-foreground">
                        synced {formatDateShort(r.last_synced_at)}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant={r.enabled ? "default" : "outline"}
                    aria-pressed={r.enabled}
                    aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.owner}/${r.repo}`}
                    disabled={pending === r.repo_key}
                    onClick={() => toggle({ repo_key: r.repo_key, enabled: !r.enabled }, r.repo_key)}
                  >
                    {r.enabled ? "On" : "Off"}
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
