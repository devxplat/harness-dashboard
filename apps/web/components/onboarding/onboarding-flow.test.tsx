import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { ScanSyncContext, type ScanSync } from "@/hooks/scan-sync";
import { installFetch } from "@/lib/test-utils";
import type { ProviderConfig } from "@/lib/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

afterEach(() => {
  vi.restoreAllMocks();
  nav.push.mockClear();
  nav.replace.mockClear();
});

function mkProvider(id: string, label: string, over: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    label,
    enabled: false,
    default_path: "",
    configured_path: null,
    active_path: "",
    discovered: false,
    capabilities: { tokens: true, tools: true, costs: true, prompts: true },
    last_scan_counts: { sessions: 0, messages: 0, tools: 0 },
    ...over,
  };
}

const settings = {
  claude_dir: "/c",
  projects_dir: "/p",
  projects_overridden: false,
  claude_dirs: ["/c"],
  plan: "api",
  onboarding_done: false,
  pr_ai_default_generation_mode: "per_pr",
  providers: [
    mkProvider("claude", "Claude Code", { discovered: true, enabled: true }),
    mkProvider("codex", "Codex"),
  ],
};
const notConnected = {
  github: { configured: false, repo_count: 0, last_sync: null },
  google: { configured: false, last_sync: null },
};
const connectedRoutes = {
  "/api/integrations/github/repos": { total_repos: 0, enabled_repos: 0, orgs: [] },
  "/api/integrations/github/settings": {
    backfill: { value: 90, unit: "days" },
    autosync: { enabled: false, interval_min: 60 },
  },
  "/api/integrations/github/sync": { started: true },
  "/api/integrations": {
    github: { configured: true, repo_count: 2, last_sync: null, login: "octocat" },
    google: { configured: false, last_sync: null },
  },
  "/api/refresh": { ok: true },
  "/api/settings": settings,
};

const progressCtx: ScanSync = {
  version: 0,
  live: true,
  setLive: () => {},
  last: { type: "scan", n: { files: 12, messages: 3400, tools: 88 } },
  githubProgress: {
    running: true,
    repo_index: 1,
    repo_total: 3,
    current_repo: "acme/app",
    pull_requests: 5,
    deployments: 2,
    rate_remaining: 4900,
    rate_limit: 5000,
    rate_reset_utc: null,
    last_error: null,
    finished_at: null,
  },
  githubSyncVersion: 0,
};

describe("OnboardingFlow", () => {
  it("seeds detected copilots, lets you toggle, and saves on Next", async () => {
    const fetchMock = installFetch({ "/api/settings": settings, "/api/integrations": notConnected });
    render(<OnboardingFlow />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your copilots" })).toBeInTheDocument(),
    );
    // Detected provider (Claude) is pre-selected (after the seed effect runs);
    // an undetected one (Codex) is not.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Claude Code/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    const codex = screen.getByRole("button", { name: /Codex/ });
    expect(codex).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(codex); // turn Codex on
    await userEvent.click(screen.getByRole("button", { name: /Claude Code/ })); // turn Claude off
    expect(codex).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) => String(u).includes("/api/settings") && (o as RequestInit)?.method === "POST",
        ),
      ).toBe(true),
    );
    // Advanced to the Connect step → the GitHub integration card is shown.
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
  }, 15000);

  it("walks to the sync step and finishes (no GitHub connected)", async () => {
    const fetchMock = installFetch({
      "/api/settings": settings,
      "/api/integrations": notConnected,
      "/api/refresh": { ok: true },
    });
    render(<OnboardingFlow />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your copilots" })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" })); // → Connect
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Next" })); // → First sync

    // The seed does NOT auto-start; the user starts it explicitly.
    await waitFor(() => expect(screen.getByText("Local sessions")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/refresh"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Start initial scan" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/refresh"))).toBe(true),
    );

    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/settings") &&
            (o as RequestInit)?.method === "POST" &&
            String((o as RequestInit)?.body).includes("onboarding_done"),
        ),
      ).toBe(true),
    );
    expect(nav.push).toHaveBeenCalledWith("/");
  });

  it("shows scan counts and a GitHub backfill bar when connected", async () => {
    const fetchMock = installFetch(connectedRoutes);
    render(
      <ScanSyncContext.Provider value={progressCtx}>
        <OnboardingFlow />
      </ScanSyncContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your copilots" })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" })); // → Connect
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Next" })); // → First sync

    // GitHub backfill options are offered (no counts/progress until the user starts).
    await waitFor(() => expect(screen.getByText("GitHub backfill")).toBeInTheDocument());
    expect(screen.queryByText("3,400")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start initial scan" }));
    // Counts from the scan event render…
    await waitFor(() => expect(screen.getByText("3,400")).toBeInTheDocument());
    // …and the live progress bar (role=status) is shown for the running backfill.
    expect(screen.getByLabelText("GitHub sync progress")).toBeInTheDocument();
    // Both the scan and the backfill were triggered.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/integrations/github/sync")),
      ).toBe(true),
    );
  });

  it("skips setup and still marks onboarding done", async () => {
    // GET succeeds so the wizard loads; every POST fails — exercises the catch paths.
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 500, statusText: "err" });
      }
      const u = String(url);
      const body = u.includes("/api/integrations") ? notConnected : settings;
      return Promise.resolve({ ok: true, json: async () => body });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your copilots" })).toBeInTheDocument(),
    );
    // Next with a failing save: catch is hit, flow still advances.
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
  });

  it("renders the loading state while settings load", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    render(<OnboardingFlow />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });
});
