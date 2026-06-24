"use client";

// Whole-app ingest status, shared by the data-screen gate and the topbar status
// pill. It blends a fetched snapshot (`/api/ingest`, re-fetched on each scan via
// useApi) with the live SSE signals (scan-in-flight, GitHub backfill progress) so
// the in-flight flags update instantly without waiting for a poll.
import { ScanSyncContext } from "@/hooks/scan-sync";
import { useApi } from "@/hooks/use-api";
import type { IngestStatus } from "@/lib/types";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface IngestState {
  /** Any local data indexed yet. Unknown (no server answer) → treated as seeded. */
  seeded: boolean;
  /** Onboarding complete — background (real-time) scanning is active. */
  onboardingDone: boolean;
  /** A local-transcript scan is in flight. */
  scanning: boolean;
  /** A GitHub backfill is in flight. */
  backfilling: boolean;
  /** Any ingest work (scan or backfill) is running. */
  ingesting: boolean;
  messages: number;
  githubConfigured: boolean;
  loading: boolean;
}

const DEFAULT: IngestState = {
  seeded: true,
  onboardingDone: false,
  scanning: false,
  backfilling: false,
  ingesting: false,
  messages: 0,
  githubConfigured: false,
  loading: true,
};

export const IngestContext = createContext<IngestState>(DEFAULT);

export function IngestProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useApi<IngestStatus>("/api/ingest");
  const { scanning: liveScanning, githubProgress } = useContext(ScanSyncContext);

  // Live SSE signals win over the fetched snapshot for the in-flight flags.
  const scanning = !!liveScanning || !!data?.scanning;
  const backfilling = !!githubProgress?.running || !!data?.github?.syncing;
  const value: IngestState = useMemo(
    () => ({
      // Only treat as "not seeded" when the server explicitly says so; unknown →
      // seeded (never flash a blur on a malformed/empty response).
      seeded: data?.seeded ?? true,
      onboardingDone: !!data?.onboarding_done,
      scanning,
      backfilling,
      ingesting: scanning || backfilling,
      messages: data?.messages ?? 0,
      githubConfigured: !!data?.github?.configured,
      loading,
    }),
    [data, scanning, backfilling, loading],
  );

  return <IngestContext.Provider value={value}>{children}</IngestContext.Provider>;
}

export function useIngest(): IngestState {
  return useContext(IngestContext);
}
