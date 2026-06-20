"use client";

import { API_BASE } from "@/lib/api-base";
import { useEffect, useRef, useState } from "react";

export interface ScanEvent {
  type: string;
  n?: { files: number; messages: number; tools: number };
  reason?: string;
  message?: string;
}

/** Subscribe to the server's SSE scan stream. Calls `onScan` on every event. */
export function useStream(onScan?: (e: ScanEvent) => void): ScanEvent | null {
  const [last, setLast] = useState<ScanEvent | null>(null);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/stream`);
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as ScanEvent;
        setLast(e);
        cb.current?.(e);
      } catch {
        /* ignore keep-alive / malformed frames */
      }
    };
    return () => es.close();
  }, []);

  return last;
}
