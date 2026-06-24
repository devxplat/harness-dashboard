import { TooltipProvider } from "@/components/ui/tooltip";
import { IngestContext, type IngestState } from "@/hooks/ingest";
import { ScanSyncContext, type ScanSync } from "@/hooks/scan-sync";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeToggle } from "./realtime-toggle";

const setLive = vi.fn();
function wrap(live: boolean) {
  const value: ScanSync = {
    version: 0,
    live,
    setLive,
    last: null,
    githubProgress: null,
    githubSyncVersion: 0,
  };
  return render(
    <TooltipProvider>
      <ScanSyncContext.Provider value={value}>
        <RealtimeToggle />
      </ScanSyncContext.Provider>
    </TooltipProvider>,
  );
}

afterEach(() => setLive.mockClear());

describe("RealtimeToggle", () => {
  it("shows Live and pauses on click", async () => {
    wrap(true);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toHaveAttribute("title");
    await userEvent.click(screen.getByRole("button"));
    expect(setLive).toHaveBeenCalledWith(false);
  });

  it("shows Paused and resumes on click", async () => {
    wrap(false);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(setLive).toHaveBeenCalledWith(true);
  });

  it("swaps the live dot for a spinner while ingesting, keeping the Live label", () => {
    const scanSync: ScanSync = {
      version: 0,
      live: true,
      setLive,
      last: null,
      githubProgress: null,
      githubSyncVersion: 0,
    };
    const ingest: IngestState = {
      seeded: true,
      onboardingDone: true,
      scanning: true,
      backfilling: false,
      ingesting: true,
      messages: 0,
      githubConfigured: false,
      loading: false,
    };
    render(
      <TooltipProvider>
        <ScanSyncContext.Provider value={scanSync}>
          <IngestContext.Provider value={ingest}>
            <RealtimeToggle />
          </IngestContext.Provider>
        </ScanSyncContext.Provider>
      </TooltipProvider>,
    );
    // Label is unchanged; the dot is replaced by a spinning icon.
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByText("Indexing…")).not.toBeInTheDocument();
    expect(screen.getByRole("button").querySelector(".animate-spin")).not.toBeNull();
  });
});
