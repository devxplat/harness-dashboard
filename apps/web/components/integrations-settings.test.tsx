import { IntegrationsSettings } from "@/components/integrations-settings";
import { installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const notConnected = {
  github: { configured: false, repo_count: 0, last_sync: null },
  google: { configured: false, last_sync: null },
};
const connected = {
  github: {
    configured: true,
    repo_count: 3,
    last_sync: "2026-06-20T10:00:00Z",
    login: "octocat",
    rate: { remaining: 4870, limit: 5000, reset_utc: null },
  },
  google: { configured: false, last_sync: null },
};
// The connected panel mounts the repo picker + sync settings, which fetch these.
// Keys are most-specific first because the test fetch stub matches by substring.
const connectedRoutes = {
  "/api/integrations/github/repos": { total_repos: 0, enabled_repos: 0, orgs: [] },
  "/api/integrations/github/settings": {
    backfill: { value: 90, unit: "days" },
    autosync: { enabled: false, interval_min: 60 },
  },
  "/api/integrations/github/sync": { started: true },
  "/api/integrations/github": { ok: true },
  "/api/integrations": connected,
};

describe("IntegrationsSettings", () => {
  it("shows the gallery when nothing is connected and opens the GitHub connect flow", async () => {
    const fetchMock = installFetch({
      "/api/integrations/github": { login: "octocat", scopes: ["repo"], has_repo_scope: true },
      "/api/integrations": notConnected,
    });
    renderWithRange(<IntegrationsSettings />);
    // Nothing connected → the gallery is shown straight away.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("img", { name: "GitHub logo" })).toHaveAttribute(
      "src",
      "/integration-logos/github.svg",
    );
    expect(screen.getByRole("img", { name: "Google Calendar logo" })).toHaveAttribute(
      "src",
      "/integration-logos/google-calendar.svg",
    );

    // Open the GitHub connect flow from the gallery.
    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => expect(screen.getByLabelText("GitHub token")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("GitHub token"), "ghp_abc");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/integrations/github") && (o as RequestInit)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("goes back from the connect flow to the gallery", async () => {
    installFetch({ "/api/integrations": notConnected });
    renderWithRange(<IntegrationsSettings />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => expect(screen.getByLabelText("GitHub token")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    // Back on the gallery.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument(),
    );
  });

  it("shows connected status + rate budget and starts a sync", async () => {
    const fetchMock = installFetch(connectedRoutes);
    renderWithRange(<IntegrationsSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "GitHub logo" })).toHaveAttribute(
      "src",
      "/integration-logos/github.svg",
    );
    expect(screen.getByText("4,870 / 5,000")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/integrations/github/sync")),
      ).toBe(true),
    );
  });

  it("opens the gallery from the connected list, connects another, and navigates back", async () => {
    installFetch(connectedRoutes);
    renderWithRange(<IntegrationsSettings />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add new integration/ })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /Add new integration/ }));
    // The still-unconnected Google integration is offered in the gallery.
    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Calendar" }));
    // → Google connect flow.
    await waitFor(() => expect(screen.getByText(/OAuth via a loopback redirect/)).toBeInTheDocument());
    // Back returns to the connected list (something is connected).
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add new integration/ })).toBeInTheDocument(),
    );

    // Re-open the gallery and step back via "Back to integrations".
    await userEvent.click(screen.getByRole("button", { name: /Add new integration/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Back to integrations/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument());
  });

  it("shows an all-connected message in the gallery when nothing is left to add", async () => {
    installFetch({
      ...connectedRoutes,
      "/api/integrations": {
        github: connected.github,
        google: { configured: true, last_sync: "2026-06-20T10:00:00Z" },
      },
    });
    renderWithRange(<IntegrationsSettings />);
    await userEvent.click(await screen.findByRole("button", { name: /Add new integration/ }));
    await waitFor(() =>
      expect(screen.getByText(/Every available integration is already connected/)).toBeInTheDocument(),
    );
  });

  it("disconnects GitHub", async () => {
    const fetchMock = installFetch(connectedRoutes);
    renderWithRange(<IntegrationsSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/integrations/github") &&
            (o as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  it("opens the Google connect flow from the gallery", async () => {
    installFetch({ "/api/integrations": notConnected });
    renderWithRange(<IntegrationsSettings />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect Google Calendar" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("img", { name: "Google Calendar logo" })).toHaveAttribute(
      "src",
      "/integration-logos/google-calendar.svg",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
    // The Google connect-flow card surfaces the OAuth-start button.
    await waitFor(() =>
      expect(screen.getByText(/OAuth via a loopback redirect/)).toBeInTheDocument(),
    );
  });

  it("surfaces a connect failure without crashing", async () => {
    // Status GET succeeds; the connect POST fails (e.g. invalid token).
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: RequestInit) => {
        const path = String(url);
        if (path.includes("/api/integrations/github") && init?.method === "POST") {
          return Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" });
        }
        return Promise.resolve({ ok: true, json: async () => notConnected });
      }),
    );
    renderWithRange(<IntegrationsSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await userEvent.type(await screen.findByLabelText("GitHub token"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    // Still on the connect form (token input remains) after the failure.
    await waitFor(() => expect(screen.getByLabelText("GitHub token")).toBeInTheDocument());
  });
});
