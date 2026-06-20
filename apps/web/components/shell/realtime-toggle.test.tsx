import { ScanSyncContext, type ScanSync } from "@/hooks/scan-sync";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeToggle } from "./realtime-toggle";

const setLive = vi.fn();
function wrap(live: boolean) {
  const value: ScanSync = { version: 0, live, setLive, last: null };
  return render(
    <ScanSyncContext.Provider value={value}>
      <RealtimeToggle />
    </ScanSyncContext.Provider>,
  );
}

afterEach(() => setLive.mockClear());

describe("RealtimeToggle", () => {
  it("shows Live and pauses on click", async () => {
    wrap(true);
    expect(screen.getByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(setLive).toHaveBeenCalledWith(false);
  });

  it("shows Paused and resumes on click", async () => {
    wrap(false);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(setLive).toHaveBeenCalledWith(true);
  });
});
