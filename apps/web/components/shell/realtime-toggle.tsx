"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIngest } from "@/hooks/ingest";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { RefreshCw } from "lucide-react";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

export function RealtimeToggle() {
  const { t } = useTranslation();
  const { live, setLive } = useContext(ScanSyncContext);
  const { ingesting } = useIngest();
  const tip = live ? t("topbar.pauseLive") : t("topbar.resumeLive");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setLive(!live)}
          aria-pressed={live}
          aria-label={tip}
        >
          {/* While indexing, the status dot becomes a subtle spinning update icon
              (same color as the dot it replaces); the label stays Live / Paused. */}
          {ingesting ? (
            <RefreshCw
              className={`size-3 animate-spin ${live ? "text-emerald-500" : "text-muted-foreground"}`}
              aria-hidden
            />
          ) : (
            <span
              className={`size-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"}`}
              aria-hidden
            />
          )}
          <span className="hidden sm:inline">{live ? t("topbar.live") : t("topbar.paused")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
