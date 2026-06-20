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
};

describe("SettingsPage", () => {
  it("renders settings and changes the plan", async () => {
    const fetchMock = installFetch({ "/api/settings": settings, "/api/plan": { ok: true } });
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Pricing plan")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Pricing plan" }));
    await userEvent.click(screen.getByRole("option", { name: "pro" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, o]) => String(u).includes("/api/plan") && (o as RequestInit)?.method === "POST"),
      ).toBe(true),
    );
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
