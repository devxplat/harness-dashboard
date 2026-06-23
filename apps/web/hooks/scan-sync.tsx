"use client";

import { API_BASE } from "@/lib/api-base";
import type { GithubProgress } from "@/lib/types";
import { createContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface ScanEvent {
  type: string;
  n?: { files: number; messages: number; tools: number };
  reason?: string;
  message?: string;
  progress?: GithubProgress;
}

export interface ScanSync {
  /** Bumps (throttled) when the server reports new data; `useApi` refetches silently. */
  version: number;
  /** Whether live updates are applied. When false, the screen stays frozen. */
  live: boolean;
  setLive: (v: boolean) => void;
  /** The most recent scan event (for status / counts). */
  last: ScanEvent | null;
  /** A local-transcript scan is in flight (live, from `scan-start`/`scan` events).
   *  Optional so existing `ScanSync` literals stay valid; the provider always sets it. */
  scanning?: boolean;
  /** Latest GitHub-sync progress snapshot (live), or null when idle. */
  githubProgress: GithubProgress | null;
  /** Bumps when a GitHub sync finishes; integration views refetch on it. */
  githubSyncVersion: number;
}

export const ScanSyncContext = createContext<ScanSync>({
  version: 0,
  live: true,
  setLive: () => {},
  last: null,
  scanning: false,
  githubProgress: null,
  githubSyncVersion: 0,
});

// Coalesce bursts of scans (you may be actively writing transcripts) into at most
// one refetch per window, so the UI updates smoothly instead of thrashing.
const THROTTLE_MS = 4000;

export function ScanSyncProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState(true);
  const [last, setLast] = useState<ScanEvent | null>(null);
  const [scanning, setScanning] = useState(false);
  const [githubProgress, setGithubProgress] = useState<GithubProgress | null>(null);
  const [githubSyncVersion, setGithubSyncVersion] = useState(0);

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
      // GitHub sync: surface live progress without bumping the global data version
      // (avoids refetch thrash on every tick); the terminal event bumps its own
      // version so integration views refresh once when it's done.
      if (e.type === "github-progress" || e.type === "github-sync") {
        if (e.progress) setGithubProgress(e.progress);
        if (e.type === "github-sync") setGithubSyncVersion((v) => v + 1);
        return;
      }
      // Live scan lifecycle: `scan-start` flips the indexing flag on; the terminal
      // `scan` (or `error` / `scan-skip`) clears it.
      if (e.type === "scan-start") {
        setScanning(true);
        return;
      }
      if (e.type === "error" || e.type === "scan-skip") {
        setScanning(false);
        return;
      }
      if (e.type !== "scan") return;
      setScanning(false);
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

  // Stable identity so consumers (and `useApi`) don't see a new object every render.
  const value = useMemo(
    () => ({ version, live, setLive, last, scanning, githubProgress, githubSyncVersion }),
    [version, live, last, scanning, githubProgress, githubSyncVersion],
  );

  return (
    <ScanSyncContext.Provider value={value}>
      {children}
    </ScanSyncContext.Provider>
  );
}
