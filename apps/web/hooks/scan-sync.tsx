"use client";

import { API_BASE } from "@/lib/api-base";
import { createContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface ScanEvent {
  type: string;
  n?: { files: number; messages: number; tools: number };
  reason?: string;
  message?: string;
}

export interface ScanSync {
  /** Bumps (throttled) when the server reports new data; `useApi` refetches silently. */
  version: number;
  /** Whether live updates are applied. When false, the screen stays frozen. */
  live: boolean;
  setLive: (v: boolean) => void;
  /** The most recent scan event (for status / counts). */
  last: ScanEvent | null;
}

export const ScanSyncContext = createContext<ScanSync>({
  version: 0,
  live: true,
  setLive: () => {},
  last: null,
});

// Coalesce bursts of scans (you may be actively writing transcripts) into at most
// one refetch per window, so the UI updates smoothly instead of thrashing.
const THROTTLE_MS = 4000;

export function ScanSyncProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState(true);
  const [last, setLast] = useState<ScanEvent | null>(null);

  const liveRef = useRef(live);
  liveRef.current = live;
  const lastBumpRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    // A single app-wide SSE connection (multiple long-lived ones exhaust the
    // browser's per-host connection budget and stall ordinary fetches).
    const es = new EventSource(`${API_BASE}/api/stream`);
    es.onmessage = (ev) => {
      let e: ScanEvent;
      try {
        e = JSON.parse(ev.data) as ScanEvent;
      } catch {
        return; // keep-alive / malformed
      }
      if (e.type !== "scan") return;
      setLast(e);
      if (!liveRef.current) return; // paused → don't trigger refetches

      const now = Date.now();
      const elapsed = now - lastBumpRef.current;
      if (elapsed >= THROTTLE_MS) {
        lastBumpRef.current = now;
        setVersion((v) => v + 1);
      } else if (!pendingRef.current) {
        pendingRef.current = setTimeout(() => {
          pendingRef.current = null;
          lastBumpRef.current = Date.now();
          setVersion((v) => v + 1);
        }, THROTTLE_MS - elapsed);
      }
    };
    return () => {
      es.close();
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  return (
    <ScanSyncContext.Provider value={{ version, live, setLive, last }}>
      {children}
    </ScanSyncContext.Provider>
  );
}
