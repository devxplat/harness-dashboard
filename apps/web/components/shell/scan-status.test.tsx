import { ScanStatus } from "@/components/shell/scan-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeES {
  onmessage: ((e: { data: string }) => void) | null;
  close: () => void;
}
const esInstances: FakeES[] = [];
class ES implements FakeES {
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(_url: string) {
    esInstances.push(this);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("ScanStatus", () => {
  it("refreshes on click and reacts to scan events", async () => {
    vi.stubGlobal("EventSource", ES as unknown as typeof EventSource);
    const fetchMock = vi.fn((_url: string) => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TooltipProvider>
        <ScanStatus />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rescan transcripts" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/refresh"))).toBe(true),
    );

    act(() => {
      esInstances.at(-1)?.onmessage?.({
        data: JSON.stringify({ type: "scan", n: { files: 1, messages: 2, tools: 3 } }),
      });
    });
  });

  it("handles a refresh failure", async () => {
    vi.stubGlobal("EventSource", ES as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500, statusText: "err" })),
    );
    render(
      <TooltipProvider>
        <ScanStatus />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rescan transcripts" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rescan transcripts" })).toBeEnabled());
  });
});
