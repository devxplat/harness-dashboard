"use client";

import { Button } from "@/components/ui/button";
import { ScanSyncContext } from "@/hooks/scan-sync";
import { apiPost } from "@/lib/api";
import { RefreshCw } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { toast } from "sonner";

export function ScanStatus() {
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
      toast.error("Refresh failed");
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={refresh}
      disabled={scanning}
      aria-label="Rescan transcripts"
      title="Rescan transcripts"
    >
      <RefreshCw className={scanning ? "animate-spin" : ""} />
      <span className="hidden sm:inline">{scanning ? "Scanning…" : "Refresh"}</span>
    </Button>
  );
}
