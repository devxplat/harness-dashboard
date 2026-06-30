"use client";

import { authenticatedStreamUrl } from "@/lib/api-auth";
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
    let cancelled = false;
    let es: EventSource | null = null;
    void authenticatedStreamUrl("/api/stream")
      .then((url) => {
        if (cancelled) return;
        es = new EventSource(url);
        es.onmessage = (ev) => {
          try {
            const e = JSON.parse(ev.data) as ScanEvent;
            setLast(e);
            cb.current?.(e);
          } catch {
            /* ignore keep-alive / malformed frames */
          }
        };
      })
      .catch(() => {
        /* auth bootstrap can fail if the API is not reachable yet */
      });
    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  return last;
}
