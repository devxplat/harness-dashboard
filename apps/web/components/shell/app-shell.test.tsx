import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

class ES {
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(_url: string) {}
}

afterEach(() => vi.restoreAllMocks());

describe("AppShell", () => {
  it("renders the header and the page body", async () => {
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
    expect(await screen.findByText("Your local AI coding usage")).toBeInTheDocument();
    expect(screen.getByText("page-body")).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it("blocks provider-scoped content when every vendor is deselected", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("EventSource", ES as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const path = String(url);
        if (path.includes("/api/settings")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              providers: [{ id: "claude", label: "Claude Code", enabled: true, discovered: true }],
              onboarding_done: true,
            }),
          });
        }
        if (path.includes("/api/ingest")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              seeded: true,
              onboarding_done: true,
              scanning: false,
              messages: 1,
              github: { configured: false, syncing: false, progress: null },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ available: false }) });
      }),
    );

    render(
      <Providers>
        <AppShell>
          <div>page-body</div>
        </AppShell>
      </Providers>,
    );

    const vendor = await screen.findByRole("button", { name: "Claude Code" });
    expect(vendor).toHaveAttribute("aria-pressed", "true");
    await user.click(vendor);
    expect(await screen.findByText("Select at least one vendor")).toBeInTheDocument();
    expect(vendor).toHaveAttribute("aria-pressed", "false");

    await user.click(vendor);
    expect(screen.queryByText("Select at least one vendor")).not.toBeInTheDocument();
    expect(vendor).toHaveAttribute("aria-pressed", "true");
  });
});
