import { IngestGate } from "@/components/ingest/ingest-gate";
import { IngestPill } from "@/components/ingest/ingest-pill";
import { IngestStatusPanel } from "@/components/ingest/ingest-status-panel";
import { IngestProvider } from "@/hooks/ingest";
import { ScanSyncContext, type ScanSync } from "@/hooks/scan-sync";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

interface IngestBody {
  seeded: boolean;
  onboarding_done: boolean;
  scanning: boolean;
  messages: number;
  github: { configured: boolean; syncing: boolean; progress: unknown };
}
const ingest = (over: Partial<IngestBody> = {}): IngestBody => ({
  seeded: true,
  onboarding_done: true,
  scanning: false,
  messages: 10,
  github: { configured: false, syncing: false, progress: null },
  ...over,
});

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

function withProviders(body: IngestBody, ui: ReactNode, scan?: Partial<ScanSync>) {
  installFetch({ "/api/ingest": body });
  return render(
    <ScanSyncContext.Provider value={scanCtx(scan ?? {})}>
      <IngestProvider>{ui}</IngestProvider>
    </ScanSyncContext.Provider>,
  );
}

describe("IngestGate", () => {
  it("blurs and shows the empty-state message + link when not seeded", async () => {
    withProviders(ingest({ seeded: false, onboarding_done: false }), (
      <IngestGate>
        <div>dashboard-body</div>
      </IngestGate>
    ));
    await waitFor(() => expect(screen.getByText("No data yet")).toBeInTheDocument());
    expect(screen.getByText("dashboard-body")).toBeInTheDocument(); // still rendered (blurred)
    expect(screen.getByRole("link", { name: /Go to integrations/ })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("shows the indexing message while the first seed is running", async () => {
    withProviders(ingest({ seeded: false, onboarding_done: false, scanning: true }), (
      <IngestGate>
        <div>dashboard-body</div>
      </IngestGate>
    ));
    await waitFor(() => expect(screen.getByText("Indexing your history…")).toBeInTheDocument());
  });

  it("renders children untouched once seeded", async () => {
    withProviders(ingest({ seeded: true }), (
      <IngestGate>
        <div>dashboard-body</div>
      </IngestGate>
    ));
    await waitFor(() => expect(screen.getByText("dashboard-body")).toBeInTheDocument());
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
  });
});

describe("IngestPill", () => {
  it("is hidden when nothing is ingesting", async () => {
    const { container } = withProviders(ingest({ seeded: true }), <IngestPill />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(container).toBeTruthy();
  });

  it("falls back to a generic syncing label without live progress", async () => {
    withProviders(ingest({ github: { configured: true, syncing: true, progress: null } }), (
      <IngestPill />
    ));
    await waitFor(() => expect(screen.getByText("Syncing…")).toBeInTheDocument());
  });

  it("shows a backfill label from live GitHub progress", async () => {
    withProviders(
      ingest({ github: { configured: true, syncing: true, progress: null } }),
      <IngestPill />,
      {
        githubProgress: {
          running: true,
          repo_index: 2,
          repo_total: 5,
          current_repo: "acme/app",
          pull_requests: 0,
          deployments: 0,
          rate_remaining: null,
          rate_limit: null,
          rate_reset_utc: null,
          last_error: null,
          finished_at: null,
        },
      },
    );
    await waitFor(() => expect(screen.getByText("Backfilling 2/5")).toBeInTheDocument());
  });
});

describe("IngestStatusPanel", () => {
  it("shows seeded / idle / on for a completed setup", async () => {
    withProviders(
      ingest({ seeded: true, onboarding_done: true, messages: 4200, github: { configured: true, syncing: false, progress: null } }),
      <IngestStatusPanel />,
    );
    await waitFor(() => expect(screen.getByText(/Seeded · 4,200 messages/)).toBeInTheDocument());
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("shows not-started / not-connected / paused before setup", async () => {
    withProviders(
      ingest({ seeded: false, onboarding_done: false, messages: 0 }),
      <IngestStatusPanel />,
    );
    await waitFor(() => expect(screen.getByText("Not started")).toBeInTheDocument());
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText(/Paused until setup completes/)).toBeInTheDocument();
  });
});
