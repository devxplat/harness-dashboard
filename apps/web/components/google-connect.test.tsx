import { GoogleConnect } from "@/components/google-connect";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("GoogleConnect", () => {
  it("starts the OAuth flow when not connected", async () => {
    vi.stubGlobal("open", vi.fn());
    const fetchMock = installFetch({
      "/api/integrations/google/start": { auth_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" },
    });
    render(<GoogleConnect connected={false} lastSync={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/integrations/google/start"))).toBe(true),
    );
    expect(window.open).toHaveBeenCalled();
  });

  it("syncs and disconnects when connected", async () => {
    const onChange = vi.fn();
    const fetchMock = installFetch({
      "/api/integrations/google/sync": { events: 12 },
      "/api/integrations/google": { ok: true },
    });
    render(<GoogleConnect connected lastSync="2026-06-20T10:00:00Z" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/integrations/google/sync"))).toBe(true),
    );

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/integrations/google") && (o as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });
});
