import SessionsPage from "@/app/sessions/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  id: null as string | null,
  provider: null as string | null,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "id" ? nav.id : key === "provider" ? nav.provider : null),
  }),
}));

afterEach(() => {
  nav.id = null;
  nav.provider = null;
  vi.restoreAllMocks();
});

const sessions = [
  {
    session_id: "s1",
    project_slug: "myproj",
    sample_cwd: null,
    started: "2026-06-19T10:00:00Z",
    ended: null,
    turns: 2,
    tokens: 100,
    cost_usd: 1,
    cost_estimated: false,
  },
];

const detail = [
  {
    provider: "claude",
    uuid: "m1",
    parent_uuid: null,
    type: "user",
    timestamp: "2026-06-19T10:00:00Z",
    model: null,
    is_sidechain: false,
    agent_id: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_5m_tokens: 0,
    cache_create_1h_tokens: 0,
    usage_source: "exact",
    reported_cost_usd: null,
    cost_source: "api_estimate",
    prompt_text: "hello world",
    prompt_chars: 11,
    tool_calls_json: null,
    project_slug: "myproj",
    cwd: null,
  },
];

const bundle = {
  session: {
    ...sessions[0],
    provider: "claude",
    reported_cost_usd: null,
  },
  messages: detail,
  context_window: {
    provider: "claude",
    session_id: "s1",
    captured_at: "2026-06-19T10:00:00Z",
    source: "statusline",
    model: "claude-sonnet-4-6",
    context_window_size: 200000,
    used_tokens: 1000,
    used_pct: 0.5,
    remaining_pct: 99.5,
    current_usage: {},
    components: [
      {
        key: "messages",
        label: "Messages",
        tokens: 1000,
        pct: 0.5,
        source: "statusline",
        confidence: "high",
      },
    ],
    supported: true,
    observed: true,
    note: null,
  },
  plan_usage: [
    {
      provider: "claude",
      account_scope: "default",
      window_key: "five_hour",
      label: "5-hour limit",
      captured_at: "2026-06-19T10:00:00Z",
      source: "statusline",
      used_pct: 40,
      resets_at: "2026-06-19T15:00:00Z",
      used_amount: null,
      limit_amount: null,
      unit: null,
      details: {},
      supported: true,
      observed: true,
      note: null,
    },
  ],
};

describe("SessionsPage", () => {
  it("lists sessions and filters to empty", async () => {
    nav.id = null;
    installFetch({ "/api/sessions": { rows: sessions, total: 1 } });
    renderWithRange(<SessionsPage />);
    await waitFor(() => expect(screen.getByText("myproj")).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText("Filter this page…"), "no-match");
    await waitFor(() => expect(screen.getByText("No sessions match.")).toBeInTheDocument());
  });

  it("renders a session detail thread", async () => {
    nav.id = "s1";
    nav.provider = "claude";
    installFetch({ "/api/sessions/s1/bundle": bundle });
    renderWithRange(<SessionsPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session" })).toBeInTheDocument());
    expect(screen.getByText("Context window")).toBeInTheDocument();
    expect(screen.getByText("Plan usage")).toBeInTheDocument();
    expect(screen.getByText("5-hour limit")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders session detail unavailable states from a partial bundle", async () => {
    nav.id = "s1";
    nav.provider = "claude";
    installFetch({
      "/api/sessions/s1/bundle": {
        session: null,
        messages: [],
        plan_usage: [
          {
            provider: "claude",
            account_scope: "default",
            window_key: "unavailable",
            label: "Plan usage",
            captured_at: null,
            source: "unavailable",
            used_pct: null,
            resets_at: null,
            used_amount: null,
            limit_amount: null,
            unit: null,
            details: {},
            supported: false,
            observed: false,
            note: "No reliable local plan-usage source has been observed for this provider.",
          },
        ],
      },
    });
    renderWithRange(<SessionsPage />);
    await waitFor(() =>
      expect(screen.getByText(/No reliable local plan-usage source/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Unknown model/)).toBeInTheDocument();
  });

  it("renders the error state", async () => {
    nav.id = null;
    installFailingFetch();
    renderWithRange(<SessionsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
