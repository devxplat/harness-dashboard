"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { useContext } from "react";

export function RealtimeToggle() {
  const { live, setLive } = useContext(ScanSyncContext);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setLive(!live)}
          aria-pressed={live}
          aria-label={live ? "Pause live updates" : "Resume live updates"}
        >
          <span
            className={`size-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"}`}
            aria-hidden
          />
          <span className="hidden sm:inline">{live ? "Live" : "Paused"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {live ? "Pause live updates" : "Resume live updates"}
      </TooltipContent>
    </Tooltip>
  );
}
