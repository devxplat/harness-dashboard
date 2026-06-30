"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { apiPost } from "@/lib/api";
import { RefreshCw } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function ScanStatus() {
  const { t } = useTranslation();
  // Reads the shared SSE (no second EventSource) — `last` updates when a scan ends.
  const { last } = useContext(ScanSyncContext);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (last) setScanning(false);
  }, [last]);

  async function refresh() {
    setScanning(true);
    try {
      await apiPost("/api/refresh", {});
    } catch {
      setScanning(false);
      toast.error(t("components.shell.refreshFailed"));
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={scanning}
          aria-label={t("components.shell.rescan")}
        >
          <RefreshCw className={scanning ? "animate-spin" : ""} />
          <span className="hidden sm:inline">{scanning ? t("components.shell.scanning") : t("components.shell.refresh")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {scanning ? t("components.shell.scanningLocal") : t("components.shell.rescanLocal")}
      </TooltipContent>
    </Tooltip>
  );
}
