"use client";

import { Button } from "@/components/ui/button";
import { useStream } from "@/hooks/use-stream";
import { apiPost } from "@/lib/api";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function ScanStatus() {
  const [scanning, setScanning] = useState(false);

  useStream((e) => {
    if (e.type === "scan") {
      setScanning(false);
      if (e.n && e.n.messages > 0) {
        toast.success(`Scanned ${e.n.files} files, ${e.n.messages} new messages`);
      }
    }
  });

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
