"use client";

import { Button } from "@/components/ui/button";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { useContext } from "react";

export function RealtimeToggle() {
  const { live, setLive } = useContext(ScanSyncContext);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setLive(!live)}
      aria-pressed={live}
      aria-label={live ? "Pause live updates" : "Resume live updates"}
      title={live ? "Live — updates apply automatically. Click to pause." : "Paused. Click to go live."}
    >
      <span
        className={`size-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"}`}
        aria-hidden
      />
      <span className="hidden sm:inline">{live ? "Live" : "Paused"}</span>
    </Button>
  );
}
