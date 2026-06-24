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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <p className="font-medium">{t("components.ingestStatus.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("components.ingestStatus.subtitle")}
        </p>
      </div>
      <ul className="space-y-2">
        <Row label={t("components.ingestStatus.initialScan")}>
          {scanning ? (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
              {t("components.ingestStatus.indexing")}
            </Badge>
          ) : seeded ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">
              {t("components.ingestStatus.seeded", { count: formatInt(messages) })}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("components.ingestStatus.notStarted")}
            </Badge>
          )}
        </Row>
        <Row label={t("components.ingestStatus.githubBackfill")}>
          {!githubConfigured ? (
            <Badge variant="outline" className="text-muted-foreground">
              {t("components.ingestStatus.notConnected")}
            </Badge>
          ) : backfilling ? (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
              {t("components.ingestStatus.running")}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("components.ingestStatus.idle")}
            </Badge>
          )}
        </Row>
        <Row label={t("components.ingestStatus.realtime")}>
          {onboardingDone ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">
              {t("components.ingestStatus.on")}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("components.ingestStatus.paused")}
            </Badge>
          )}
        </Row>
      </ul>
      {githubProgress?.running ? <GithubSyncProgress progress={githubProgress} /> : null}
    </div>
  );
}
