"use client";

// Ingest status at a glance, shown in Settings → Integrations so the state of the
// initial seed, the GitHub backfill, and real-time indexing stays visible even after
// the onboarding wizard is closed. Live, via the shared ingest + SSE state.
import { GithubSyncProgress } from "@/components/integrations/github-progress";
import { Badge } from "@/components/ui/badge";
import { useIngest } from "@/hooks/ingest";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { formatInt } from "@/lib/format";
import { useContext } from "react";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </li>
  );
}

export function IngestStatusPanel() {
  const { seeded, onboardingDone, scanning, backfilling, messages, githubConfigured } = useIngest();
  const { githubProgress } = useContext(ScanSyncContext);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <p className="font-medium">Data ingest</p>
        <p className="text-xs text-muted-foreground">
          Seeding, backfill and real-time indexing status.
        </p>
      </div>
      <ul className="space-y-2">
        <Row label="Initial scan">
          {scanning ? (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
              Indexing…
            </Badge>
          ) : seeded ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">
              Seeded · {formatInt(messages)} messages
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Not started
            </Badge>
          )}
        </Row>
        <Row label="GitHub backfill">
          {!githubConfigured ? (
            <Badge variant="outline" className="text-muted-foreground">
              Not connected
            </Badge>
          ) : backfilling ? (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
              Running
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Idle
            </Badge>
          )}
        </Row>
        <Row label="Real-time">
          {onboardingDone ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">
              On
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Paused until setup completes
            </Badge>
          )}
        </Row>
      </ul>
      {githubProgress?.running ? <GithubSyncProgress progress={githubProgress} /> : null}
    </div>
  );
}
