import { GithubSyncSettings } from "@/components/integrations/github-sync-settings";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const settings = {
  backfill: { value: 90, unit: "days" },
  autosync: { enabled: false, interval_min: 60 },
  backfill_done: true,
};

describe("GithubSyncSettings", () => {
  it("loads settings and saves changes", async () => {
    const fetchMock = installFetch({
      "/api/integrations/github/settings": settings,
    });
    render(<GithubSyncSettings />);
    await waitFor(() => expect(screen.getByLabelText("Backfill amount")).toBeInTheDocument());
    expect(screen.getByText("→ 90 days")).toBeInTheDocument();

    // Turn auto-sync on, then save.
    await userEvent.click(screen.getByRole("button", { name: "Off" }));
    await userEvent.click(screen.getByRole("button", { name: "Save sync settings" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/integrations/github/settings") &&
            (o as RequestInit)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("disables the amount input for non-windowed units", async () => {
    installFetch({
      "/api/integrations/github/settings": { ...settings, backfill: { value: 0, unit: "all" } },
    });
    render(<GithubSyncSettings />);
    await waitFor(() => expect(screen.getByText("→ All history")).toBeInTheDocument());
    expect(screen.getByLabelText("Backfill amount")).toBeDisabled();
  });

  it("changes the backfill unit", async () => {
    installFetch({ "/api/integrations/github/settings": settings });
    render(<GithubSyncSettings />);
    await waitFor(() => expect(screen.getByText("→ 90 days")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Backfill unit"));
    await userEvent.click(screen.getByRole("option", { name: "weeks" }));
    expect(screen.getByText("→ 90 weeks")).toBeInTheDocument();
  });

  it("defaults to all-repo PRs and saves the chosen scope", async () => {
    const fetchMock = installFetch({
      "/api/integrations/github/settings": { ...settings, pr_scope: "all" },
    });
    render(<GithubSyncSettings />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "All repo PRs" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "All repo PRs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Only mine" }));
    expect(screen.getByRole("button", { name: "Only mine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save sync settings" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/integrations/github/settings") &&
            (o as RequestInit)?.method === "POST" &&
            String((o as RequestInit)?.body).includes('"pr_scope":"mine"'),
        ),
      ).toBe(true),
    );
  });
});
