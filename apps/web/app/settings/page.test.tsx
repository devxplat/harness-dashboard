import SettingsPage from "@/app/settings/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const settings = {
  claude_dir: "/home/.claude",
  projects_dir: "/home/.claude/projects",
  projects_overridden: false,
  claude_dirs: ["/home/.claude"],
  plan: "api",
  providers: [],
};
const integrations = {
  github: { configured: false, repo_count: 0, last_sync: null },
  google: { configured: false, last_sync: null },
};

describe("SettingsPage", () => {
  it("shows Integrations by default and switches sections", async () => {
    installFetch({ "/api/settings": settings, "/api/integrations": integrations });
    renderWithRange(<SettingsPage />);
    // Integrations is the default section → the GitHub integration card is shown.
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /AI sources/ }));
    expect(screen.getByText(/No AI sources detected yet/)).toBeInTheDocument();
  });

  it("changes the plan from the General section", async () => {
    const fetchMock = installFetch({
      "/api/settings": settings,
      "/api/integrations": integrations,
      "/api/plan": { ok: true },
    });
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /General/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /General/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "Pricing plan" }));
    await userEvent.click(screen.getByRole("option", { name: "pro" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) => String(u).includes("/api/plan") && (o as RequestInit)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("offers re-running the wizard from the Onboarding section", async () => {
    installFetch({ "/api/settings": settings, "/api/integrations": integrations });
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Onboarding/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Onboarding/ }));
    expect(screen.getByRole("link", { name: /Open setup wizard/ })).toHaveAttribute(
      "href",
      "/onboarding",
    );
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
