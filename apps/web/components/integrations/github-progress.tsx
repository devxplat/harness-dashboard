"use client";

// Live GitHub-sync progress: a bar + counts + rate-limit budget chip. Driven by the
// SSE progress snapshot (from ScanSyncContext); pure formatting lives in lib/github.
import { progressPercent, rateBudgetLabel, rateBudgetTone } from "@/lib/github";
import type { GithubProgress } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
};

export function GithubSyncProgress({ progress }: { progress: GithubProgress | null }) {
  const { t } = useTranslation();
  if (!progress || !progress.running) return null;
  const pct = progressPercent(progress);
  const tone = rateBudgetTone(progress.rate_remaining, progress.rate_limit);
  const budget = rateBudgetLabel({
    remaining: progress.rate_remaining,
    limit: progress.rate_limit,
    reset_utc: progress.rate_reset_utc,
  });
  return (
    <div className="space-y-1.5" aria-label={t("components.githubSync.progress")} role="status">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">
          {t("components.githubSync.syncing", {
            current: progress.repo_index,
            total: progress.repo_total,
            repo: progress.current_repo
              ? t("components.githubSync.repoSuffix", { repo: progress.current_repo })
              : "",
          })}
        </span>
        <span className="tabular-nums">
          {t("components.githubSync.summary", {
            prs: progress.pull_requests,
            deploys: progress.deployments,
          })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{t("components.githubSync.apiBudget")}</span>
        <span className={cn("tabular-nums font-medium", TONE[tone])}>{budget}</span>
      </div>
    </div>
  );
}
