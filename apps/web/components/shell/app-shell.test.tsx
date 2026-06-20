import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

class ES {
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(_url: string) {}
}

afterEach(() => vi.restoreAllMocks());

describe("AppShell", () => {
  it("renders the header and the page body", () => {
    vi.stubGlobal("EventSource", ES as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ available: false }) })),
    );
    render(
      <Providers>
        <AppShell>
          <div>page-body</div>
        </AppShell>
      </Providers>,
    );
    expect(screen.getByText("harness-dashboard")).toBeInTheDocument();
    expect(screen.getByText("page-body")).toBeInTheDocument();
  });
});
