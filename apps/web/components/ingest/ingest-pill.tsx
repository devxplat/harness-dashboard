"use client";

// Minified, animated, real-time ingest status shared across every screen (lives in
// the top bar). Renders only while something is actually ingesting; the label and
// counts are driven live by the shared ingest + SSE state.
import { useIngest } from "@/hooks/ingest";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useContext } from "react";

export function IngestPill({ className }: { className?: string }) {
  const { ingesting, scanning, backfilling } = useIngest();
  const { githubProgress } = useContext(ScanSyncContext);
  if (!ingesting) return null;

  const label =
    backfilling && githubProgress?.running
      ? `Backfilling ${githubProgress.repo_index}/${githubProgress.repo_total}`
      : scanning
        ? "Indexing…"
        : "Syncing…";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3.5 animate-spin" />
      <span className="tabular-nums">{label}</span>
    </span>
  );
}
