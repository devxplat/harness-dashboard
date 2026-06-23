import { GithubRepoPicker } from "@/components/integrations/github-repo-picker";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const repos = {
  total_repos: 3,
  enabled_repos: 2,
  orgs: [
    {
      owner: "rd-station",
      enabled_count: 1,
      total: 2,
      repos: [
        { repo_key: "k1", owner: "rd-station", repo: "core", primary_slug: null, enabled: true, last_synced_at: null },
        { repo_key: "k2", owner: "rd-station", repo: "runner", primary_slug: null, enabled: false, last_synced_at: null },
      ],
    },
    {
      owner: "acme",
      enabled_count: 1,
      total: 1,
      repos: [
        { repo_key: "k3", owner: "acme", repo: "site", primary_slug: null, enabled: true, last_synced_at: "2026-06-20T10:00:00Z" },
      ],
    },
  ],
};

describe("GithubRepoPicker", () => {
  it("lists repos grouped by org and toggles a repo", async () => {
    const fetchMock = installFetch({
      "/api/integrations/github/repos": repos,
      "/api/integrations/github/repos/toggle": { ok: true },
    });
    render(<GithubRepoPicker />);
    await waitFor(() => expect(screen.getByText("rd-station")).toBeInTheDocument());
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 repos enabled for sync")).toBeInTheDocument();

    // Enable repos through the visible org action.
    await userEvent.click(screen.getAllByText("Enable all")[0]!);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes("/api/integrations/github/repos/toggle") &&
            (o as RequestInit)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("enables a whole org", async () => {
    const fetchMock = installFetch({
      "/api/integrations/github/repos": repos,
      "/api/integrations/github/repos/toggle": { ok: true },
    });
    render(<GithubRepoPicker />);
    await waitFor(() => expect(screen.getAllByText("Enable all").length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByText("Enable all")[0]!);
    await userEvent.click(screen.getAllByText("Disable all")[0]!);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes("/repos/toggle")).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("shows the empty state when no repos discovered", async () => {
    installFetch({ "/api/integrations/github/repos": { total_repos: 0, enabled_repos: 0, orgs: [] } });
    render(<GithubRepoPicker />);
    await waitFor(() => expect(screen.getByText(/No GitHub repos discovered/)).toBeInTheDocument());
  });
});
