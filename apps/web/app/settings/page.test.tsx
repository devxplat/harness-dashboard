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
const providerPlans = {
  catalog: {
    claude: [
      {
        plan_id: "claude:api",
        label: "API / pay-per-token",
        audience: "individual",
        billing_unit: "usage",
        monthly_usd: 0,
        annual_monthly_usd: null,
        price_note: null,
        selectable: true,
        source_url: "https://claude.com/pricing",
      },
      {
        plan_id: "claude:pro",
        label: "Pro",
        audience: "individual",
        billing_unit: "user_month",
        monthly_usd: 20,
        annual_monthly_usd: 17,
        price_note: null,
        selectable: true,
        source_url: "https://claude.com/pricing",
      },
    ],
  },
  selections: [{ provider: "claude", plan_id: "claude:api", updated_at: "2026-06-29T00:00:00Z" }],
  snapshot_status: [
    {
      provider: "claude",
      context_observed: false,
      context_captured_at: null,
      plan_usage_observed: false,
      plan_usage_captured_at: null,
      windows: [],
    },
  ],
  source_checked_at: "2026-06-29",
};

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
    fireEvent.change(screen.getByLabelText("Default session minutes before PR"), {
      target: { value: "180" },
    });
    fireEvent.change(screen.getByLabelText("Default session min confidence"), {
      target: { value: "0.55" },
    });
    fireEvent.change(screen.getByLabelText("PR-session correlation prompt"), {
      target: { value: "Match PRs to the strongest local coding sessions." },
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
            String((init as RequestInit)?.body).includes("Score revenue") &&
            String((init as RequestInit)?.body).includes("pr_session_correlation_config") &&
            String((init as RequestInit)?.body).includes("Match PRs"),
        ),
      ).toBe(true),
    );
  }, 15000);

  it("renders Plans & Usage and saves a provider plan", async () => {
    const fetchMock = installFetch({
      "/api/settings": settings,
      "/api/integrations": integrations,
      "/api/provider-plans": (path: string, init?: RequestInit) =>
        init?.method === "POST" ? { ok: true } : providerPlans,
    });
    renderWithRange(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Plans & Usage/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /Plans & Usage/ }));
    expect(await screen.findByText(/Plan catalog checked 2026-06-29/)).toBeInTheDocument();
    expect(screen.getByText("snapshot missing")).toBeInTheDocument();
    expect(document.querySelector('a[href="https://claude.com/pricing"]')).toBeTruthy();

    await userEvent.click(screen.getByRole("combobox", { name: "Current plan" }));
    await userEvent.click(screen.getByRole("option", { name: "Pro" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/api/provider-plans") &&
            (init as RequestInit)?.method === "POST" &&
            String((init as RequestInit)?.body).includes("claude:pro"),
        ),
      ).toBe(true),
    );
  }, 15000);

  it("shows observed Claude snapshot windows in Plans & Usage", async () => {
    installFetch({
      "/api/settings": settings,
      "/api/integrations": integrations,
      "/api/provider-plans": {
        ...providerPlans,
        snapshot_status: [
          {
            provider: "claude",
            context_observed: true,
            context_captured_at: new Date().toISOString(),
            plan_usage_observed: true,
            plan_usage_captured_at: new Date().toISOString(),
            windows: [
              {
                window_key: "five_hour",
                label: "5-hour limit",
                captured_at: new Date().toISOString(),
                used_pct: 40,
              },
            ],
          },
        ],
      },
    });
    renderWithRange(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Plans & Usage/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /Plans & Usage/ }));
    expect(await screen.findByText("snapshot observed")).toBeInTheDocument();
    expect(screen.getByText(/5-hour limit/)).toBeInTheDocument();
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
