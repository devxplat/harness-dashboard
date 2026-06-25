import SettingsPage from "@/app/settings/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

const settings = {
  claude_dir: "/home/.claude",
  projects_dir: "/home/.claude/projects",
  projects_overridden: false,
  claude_dirs: ["/home/.claude"],
  plan: "api",
  github_login: "alice",
  pr_ai_default_engine: "codex",
  pr_ai_default_generation_mode: "per_pr",
  pr_business_value_prompt: "Score business impact.",
  pr_ai_maturity_prompt: "Score AI maturity.",
  providers: [],
};
const integrations = {
  github: { configured: false, repo_count: 0, last_sync: null },
  google: { configured: false, last_sync: null },
};
const prRules = [
  {
    id: "large-pr",
    title: "Large PR size",
    description: null,
    enabled: true,
    severity: "warning",
    category: "size",
    scope: "pr",
    metric: "churn",
    operator: "gte",
    threshold: 500,
    recommendation: "Split future changes into smaller reviewable PRs.",
    custom: false,
  },
];
const engines = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    available: true,
    notes: "Uses codex exec in a read-only sandbox.",
  },
];

describe("SettingsPage", () => {
  it("shows Profile by default and switches sections", async () => {
    installFetch({ "/api/settings": settings, "/api/integrations": integrations });
    renderWithRange(<SettingsPage />);
    // Profile is the default section → the display name input is shown.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Profile/ })).toBeInTheDocument(),
    );

    // Navigate to Integrations → GitHub card appears.
    await userEvent.click(screen.getByRole("button", { name: /Integrations/ }));
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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /General/ })).toBeInTheDocument(),
    );

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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Onboarding/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /Onboarding/ }));
    expect(screen.getByRole("link", { name: /Open setup wizard/ })).toHaveAttribute(
      "href",
      "/onboarding",
    );
  });

  it("creates custom deterministic PR rules from Settings", async () => {
    const fetchMock = installFetch({
      "/api/settings": settings,
      "/api/integrations": integrations,
      "/api/pull-requests/insight-rules": prRules,
    });
    renderWithRange(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /PR Rules/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /PR Rules/ }));
    expect(await screen.findByText("Deterministic PR Rules")).toBeInTheDocument();
    expect(screen.getByText("Large PR size")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Rule id" }), {
      target: { value: "custom-review-sla" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Rule title" }), {
      target: { value: "Custom review SLA" },
    });
    fireEvent.change(screen.getByLabelText("Rule recommendation"), {
      target: { value: "Escalate stale PRs." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/api/pull-requests/insight-rules") &&
            (init as RequestInit)?.method === "POST" &&
            String((init as RequestInit)?.body).includes("custom-review-sla"),
        ),
      ).toBe(true),
    );
  }, 15000);

  it("saves PR AI feature settings", async () => {
    const fetchMock = installFetch({
      "/api/settings": settings,
      "/api/integrations": integrations,
      "/api/pull-requests/ai-engines": engines,
    });
    renderWithRange(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /AI Features/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /AI Features/ }));
    expect(await screen.findByText("PR AI generation")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Default PR AI generation mode" }));
    await userEvent.click(screen.getByRole("option", { name: "Selected PR batch" }));
    fireEvent.change(screen.getByLabelText("Business Value Index prompt"), {
      target: { value: "Score revenue, reliability, and NPS impact." },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save AI settings" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/api/settings") &&
            (init as RequestInit)?.method === "POST" &&
            String((init as RequestInit)?.body).includes("pr_ai_default_generation_mode") &&
            String((init as RequestInit)?.body).includes("batch") &&
            String((init as RequestInit)?.body).includes("Score revenue"),
        ),
      ).toBe(true),
    );
  }, 15000);

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
