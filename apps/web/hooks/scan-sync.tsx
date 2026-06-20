"use client";

import { API_BASE } from "@/lib/api-base";
import { createContext, useEffect, useState, type ReactNode } from "react";

/** Bumps on every server scan event. `useApi` consumers refetch (silently) when
 * it changes, so views stay live as the watcher/scan ingests new transcripts. */
export const ScanSyncContext = createContext(0);

export function ScanSyncProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`${API_BASE}/api/stream`);
    es.onmessage = (ev) => {
      try {
        if ((JSON.parse(ev.data) as { type?: string }).type === "scan") {
          setVersion((v) => v + 1);
        }
      } catch {
        /* ignore keep-alive / malformed frames */
      }
    };
    return () => es.close();
  }, []);

  return <ScanSyncContext.Provider value={version}>{children}</ScanSyncContext.Provider>;
}
