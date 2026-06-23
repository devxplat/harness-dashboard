import { IngestProvider, useIngest } from "@/hooks/ingest";
import { ScanSyncContext, type ScanSync } from "@/hooks/scan-sync";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { seeded, scanning, backfilling, ingesting, onboardingDone, messages } = useIngest();
  return (
    <div>
      <span>seeded:{String(seeded)}</span>
      <span>scanning:{String(scanning)}</span>
      <span>backfilling:{String(backfilling)}</span>
      <span>ingesting:{String(ingesting)}</span>
      <span>onboarding:{String(onboardingDone)}</span>
      <span>messages:{messages}</span>
    </div>
  );
}

const scanCtx = (over: Partial<ScanSync>): ScanSync => ({
  version: 0,
  live: true,
  setLive: () => {},
  last: null,
  scanning: false,
  githubProgress: null,
  githubSyncVersion: 0,
  ...over,
});

describe("useIngest", () => {
  it("reflects a not-seeded, scanning server snapshot", async () => {
    installFetch({
      "/api/ingest": {
        seeded: false,
        onboarding_done: false,
        scanning: true,
        messages: 0,
        github: { configured: false, syncing: false, progress: null },
      },
    });
    render(
      <IngestProvider>
        <Probe />
      </IngestProvider>,
    );
    await waitFor(() => expect(screen.getByText("seeded:false")).toBeInTheDocument());
    expect(screen.getByText("scanning:true")).toBeInTheDocument();
    expect(screen.getByText("ingesting:true")).toBeInTheDocument();
  });

  it("treats a seeded snapshot as ready and surfaces counts", async () => {
    installFetch({
      "/api/ingest": {
        seeded: true,
        onboarding_done: true,
        scanning: false,
        messages: 1234,
        github: { configured: true, syncing: false, progress: null },
      },
    });
    render(
      <IngestProvider>
        <Probe />
      </IngestProvider>,
    );
    await waitFor(() => expect(screen.getByText("seeded:true")).toBeInTheDocument());
    expect(screen.getByText("onboarding:true")).toBeInTheDocument();
    expect(screen.getByText("messages:1234")).toBeInTheDocument();
  });

  it("derives backfilling from live GitHub progress", async () => {
    installFetch({
      "/api/ingest": {
        seeded: true,
        onboarding_done: true,
        scanning: false,
        messages: 5,
        github: { configured: true, syncing: false, progress: null },
      },
    });
    const progress = {
      running: true,
      repo_index: 1,
      repo_total: 3,
      current_repo: "acme/app",
      pull_requests: 0,
      deployments: 0,
      rate_remaining: null,
      rate_limit: null,
      rate_reset_utc: null,
      last_error: null,
      finished_at: null,
    };
    render(
      <ScanSyncContext.Provider value={scanCtx({ githubProgress: progress })}>
        <IngestProvider>
          <Probe />
        </IngestProvider>
      </ScanSyncContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("backfilling:true")).toBeInTheDocument());
    expect(screen.getByText("ingesting:true")).toBeInTheDocument();
  });

  it("treats an unknown response as seeded (no false blur)", async () => {
    installFetch({}); // /api/ingest → [] (no seeded field)
    render(
      <IngestProvider>
        <Probe />
      </IngestProvider>,
    );
    await waitFor(() => expect(screen.getByText("seeded:true")).toBeInTheDocument());
  });
});
