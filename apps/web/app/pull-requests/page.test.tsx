import PullRequestsPage from "@/app/pull-requests/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const prRef = {
  repo_key: "D:/Github/harness-dashboard",
  repo_owner: "acme",
  repo_name: "harness-dashboard",
  repo_full_name: "acme/harness-dashboard",
  number: 145,
  title: "Context-aware routing orchestrator",
  html_url: "https://github.com/acme/harness-dashboard/pull/145",
};

const businessValueIndex = {
  repo_key: "D:/Github/harness-dashboard",
  pr_number: 145,
  index_type: "business_value",
  score: 82,
  grade: "A",
  category: "nps_customer",
  category_scores: { nps_customer: 82, reliability: 20 },
  summary: "Improves a customer-facing routing flow.",
  evidence: ["Touches pull request routing UI."],
  recommendations: ["Link the PR to the customer issue."],
  confidence: 0.78,
  engine: "codex",
  input_hash: "hash-1",
  generated_at_utc: "2026-06-24T12:00:00Z",
};

const aiMaturityIndex = {
  repo_key: "D:/Github/harness-dashboard",
  pr_number: 210,
  index_type: "ai_maturity",
  score: 68,
  grade: "B",
  category: "capable",
  category_scores: { context_quality: 70, iteration_efficiency: 66 },
  summary: "Good review loop with moderate AI evidence.",
  evidence: ["Small file count and completed review."],
  recommendations: ["Capture reusable repo guidance."],
  confidence: 0.7,
  engine: "codex",
  input_hash: "hash-2",
  generated_at_utc: "2026-06-24T12:10:00Z",
};

const sessionCorrelation = {
  repo_key: "D:/Github/harness-dashboard",
  pr_number: 145,
  provider: "codex",
  session_id: "s-pr-145",
  mode: "deterministic",
  score: 91,
  confidence: 0.91,
  summary: "Session overlaps the PR and touched the main changed file.",
  reasons: ["Session overlaps the PR active window.", "Session tool calls touched 1 file."],
  signals: { time: 0.4, file_touch: 0.25, branch: 0.25 },
  session_started_at_utc: "2026-06-24T09:55:00Z",
  session_ended_at_utc: "2026-06-24T11:30:00Z",
  project_slug: "harness-dashboard",
  sample_cwd: "D:/Github/harness-dashboard",
  turns: 8,
  tokens: 12000,
  engine: null,
  input_hash: null,
  generated_at_utc: null,
};

const deterministicInsights = Array.from({ length: 10 }, (_, index) => ({
  id: `insight-${index}`,
  rule_id: index === 0 ? "stale-open-pr" : `rule-${index}`,
  title: index === 0 ? "PR waiting too long" : `Insight ${index}`,
  severity: index % 3 === 0 ? "warning" : "info",
  category: index % 2 === 0 ? "review" : "size",
  scope: index === 9 ? "aggregate" : "pr",
  metric: index % 2 === 0 ? "open_age_hours" : "churn",
  value: 30 + index,
  threshold: 24,
  recommendation: "Route this PR to an available reviewer.",
  affected_prs: [prRef],
}));

const bundle = {
  grain: "week",
  active_author: "alice",
  default_author: "alice",
  authors: [
    { login: "__all", pull_requests: 2, is_default: false },
    { login: "alice", pull_requests: 2, is_default: true },
    { login: "bob", pull_requests: 1, is_default: false },
  ],
  pagination: {
    page: 0,
    page_size: 25,
    total_rows: 2,
  },
  filter_options: {
    authors: ["__all", "alice", "bob"],
    repos: ["acme/harness-dashboard"],
    orgs: ["acme"],
    statuses: ["awaiting_review", "merged"],
    insight_categories: ["review", "size"],
    insight_severities: ["info", "warning"],
    insight_scopes: ["aggregate", "pr"],
  },
  summary: {
    total: 2,
    ai_assisted: 1,
    open: 1,
    awaiting_review: 1,
    awaiting_merge: 0,
    high_review_time: 1,
    merged: 1,
    closed: 0,
    no_ai_signal: 1,
    avg_cycle_hours: 32,
    avg_review_wait_hours: 26,
    avg_churn: 361,
    merge_frequency_per_week: 1,
  },
  rows: [
    {
      repo_key: "D:/Github/harness-dashboard",
      repo_owner: "acme",
      repo_name: "harness-dashboard",
      repo_full_name: "acme/harness-dashboard",
      number: 145,
      title: "Context-aware routing orchestrator",
      state: "open",
      status_bucket: "awaiting_review",
      author: "alice",
      created_at_utc: "2026-06-24T10:00:00Z",
      merged_at_utc: null,
      closed_at_utc: null,
      first_review_at_utc: null,
      head_branch: "feat/pr-routing",
      base_branch: "main",
      additions: 420,
      deletions: 37,
      size: 457,
      changed_files: 8,
      review_count: 0,
      merge_commit_sha: null,
      head_sha: "head145abcdef",
      html_url: "https://github.com/acme/harness-dashboard/pull/145",
      ai_session_overlap: true,
      churn: 457,
      age_hours: 30,
      cycle_hours: null,
      review_wait_hours: null,
      files: [
        {
          path: "apps/web/app/pull-requests/page.tsx",
          status: "modified",
          additions: 120,
          deletions: 12,
          changes: 132,
          previous_path: null,
          blob_url:
            "https://github.com/acme/harness-dashboard/blob/main/apps/web/app/pull-requests/page.tsx",
        },
      ],
      session_correlations: [sessionCorrelation],
      related_commits: [
        {
          sha: "head145abcdef",
          authored_at_utc: "2026-06-24T10:30:00Z",
          author_name: "Alice",
          author_email: "alice@example.com",
          subject: "feat: context aware routing",
          branch: "feat/pr-routing",
          files_changed: 3,
          insertions: 120,
          deletions: 12,
          ai_assisted: true,
          match_reason: "head_sha",
        },
      ],
      related_deployments: [],
      related_incidents: [],
      business_value_index: businessValueIndex,
      ai_maturity_index: null,
      timeline: [
        {
          event_type: "created",
          title: "Opened",
          actor: "alice",
          body: null,
          state: null,
          conclusion: null,
          created_at_utc: "2026-06-24T10:00:00Z",
          html_url: null,
        },
        {
          event_type: "check",
          title: "Static Code Review",
          actor: "typo-app[bot]",
          body: "70 quality checks failed.",
          state: "completed",
          conclusion: "failure",
          created_at_utc: "2026-06-24T10:20:00Z",
          html_url: "https://github.com/acme/harness-dashboard/actions/runs/1",
        },
      ],
    },
    {
      repo_key: "D:/Github/harness-dashboard",
      repo_owner: "acme",
      repo_name: "harness-dashboard",
      repo_full_name: "acme/harness-dashboard",
      number: 210,
      title: "Ship billing export",
      state: "merged",
      status_bucket: "merged",
      author: "alice",
      created_at_utc: "2026-06-23T10:00:00Z",
      merged_at_utc: "2026-06-24T18:00:00Z",
      closed_at_utc: null,
      first_review_at_utc: "2026-06-24T12:00:00Z",
      head_branch: "feat/billing-export",
      base_branch: "main",
      additions: 290,
      deletions: 12,
      size: 302,
      changed_files: 5,
      review_count: 2,
      merge_commit_sha: "abc123",
      head_sha: "def456",
      html_url: null,
      ai_session_overlap: false,
      churn: 302,
      age_hours: 40,
      cycle_hours: 32,
      review_wait_hours: 26,
      files: [],
      session_correlations: [],
      related_commits: [
        {
          sha: "def456",
          authored_at_utc: "2026-06-23T11:00:00Z",
          author_name: "Alice",
          author_email: "alice@example.com",
          subject: "feat: ship billing export",
          branch: "feat/billing-export",
          files_changed: 4,
          insertions: 290,
          deletions: 12,
          ai_assisted: false,
          match_reason: "head_sha",
        },
      ],
      related_deployments: [
        {
          kind: "run",
          ext_id: "deploy-210",
          name: "production",
          created_at_utc: "2026-06-24T20:00:00Z",
          status: "success",
          sha: "abc123",
          html_url: "https://github.com/acme/harness-dashboard/actions/runs/210",
          lead_time_hours: 2,
          match_reason: "merge_sha",
        },
      ],
      related_incidents: [
        {
          source: "github_issue",
          ext_id: "991",
          title: "Billing export timeout",
          severity: "high",
          opened_at_utc: "2026-06-25T10:00:00Z",
          resolved_at_utc: "2026-06-25T13:00:00Z",
          state: "resolved",
          html_url: "https://github.com/acme/harness-dashboard/issues/991",
          deploy_ext_id: "deploy-210",
          mttr_hours: 3,
          hours_after_merge: 16,
          match_reason: "linked_deployment",
        },
      ],
      business_value_index: null,
      ai_maturity_index: aiMaturityIndex,
      timeline: [],
    },
  ],
  periods: [
    {
      period: "2026-W26",
      opened: 2,
      merged: 1,
      ai_assisted: 1,
      avg_cycle_hours: 32,
      avg_review_wait_hours: 26,
    },
  ],
  tiles: [
    {
      key: "cycle_time",
      label: "PR cycle time",
      value: "32.0",
      unit: "hours",
      detail: "Created to merged for merged PRs.",
      severity: "info",
    },
    {
      key: "review_wait",
      label: "Review wait",
      value: "26.0",
      unit: "hours",
      detail: "Created to first review when available.",
      severity: "critical",
    },
  ],
  deterministic_insights: deterministicInsights,
  rules: [
    {
      id: "stale-open-pr",
      title: "PR waiting too long",
      description: "Open PRs older than the threshold.",
      enabled: true,
      severity: "warning",
      category: "review",
      scope: "pr",
      metric: "open_age_hours",
      operator: "gte",
      threshold: 24,
      recommendation: "Route this PR to an available reviewer.",
      custom: false,
    },
  ],
  session_correlation_config: {
    enabled: true,
    time_window_before_minutes: 240,
    time_window_after_minutes: 240,
    min_confidence: 0.4,
    max_sessions_per_pr: 5,
    use_branch: true,
    use_file_touches: true,
    use_title_keywords: true,
    weights: {
      time_overlap: 0.4,
      temporal_proximity: 0.15,
      branch: 0.25,
      file_touch: 0.25,
      title_keyword: 0.1,
    },
  },
};

const engines = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    available: true,
    notes: "Uses codex exec in a read-only sandbox.",
  },
];

function prBundleForUrl(path: string) {
  const url = new URL(path, "http://localhost");
  const status = url.searchParams.get("status");
  const query = url.searchParams.get("query")?.toLowerCase() ?? "";
  const page = Number(url.searchParams.get("page") ?? 0);
  const pageSize = Number(url.searchParams.get("page_size") ?? 25);
  const rows = bundle.rows.filter((row) => {
    if (status && row.status_bucket !== status) return false;
    if (!query) return true;
    return [row.title, row.repo_full_name, row.author, String(row.number)]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const start = page * pageSize;
  return {
    ...bundle,
    rows: rows.slice(start, start + pageSize).map((row) => ({
      ...row,
      files: [],
      timeline: [],
      related_commits: [],
      related_deployments: [],
      related_incidents: [],
    })),
    pagination: {
      page,
      page_size: pageSize,
      total_rows: rows.length,
    },
  };
}

function prDetailForUrl(path: string) {
  const url = new URL(path, "http://localhost");
  const number = Number(url.searchParams.get("number"));
  return bundle.rows.find((row) => row.number === number) ?? bundle.rows[0];
}

function deterministicInsightsForUrl(path: string) {
  const url = new URL(path, "http://localhost");
  const category = url.searchParams.get("category");
  const severity = url.searchParams.get("severity");
  const scope = url.searchParams.get("scope");
  const repo = url.searchParams.get("repo");
  const org = url.searchParams.get("org");
  const page = Number(url.searchParams.get("page") ?? 0);
  const pageSize = Number(url.searchParams.get("page_size") ?? 8);
  const rows = deterministicInsights.filter((insight) => {
    if (category && insight.category !== category) return false;
    if (severity && insight.severity !== severity) return false;
    if (scope && insight.scope !== scope) return false;
    if (repo && !insight.affected_prs.some((pr) => pr.repo_full_name === repo)) return false;
    if (org && !insight.affected_prs.some((pr) => pr.repo_owner === org)) return false;
    return true;
  });
  const start = page * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: {
      page,
      page_size: pageSize,
      total_rows: rows.length,
    },
    filter_options: bundle.filter_options,
  };
}

describe("PullRequestsPage", () => {
  it("renders the overview, applies author/search filters, and opens the PR detail sheet", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch({
      "/api/pull-requests/deterministic-insights": deterministicInsightsForUrl,
      "/api/pull-requests/detail": prDetailForUrl,
      "/api/pull-requests/bundle": prBundleForUrl,
      "/api/pull-requests/ai-engines": engines,
      "/api/settings": {
        pr_ai_default_engine: "codex",
        pr_ai_default_generation_mode: "batch",
        pr_session_correlation_config: bundle.session_correlation_config,
        pr_session_correlation_prompt: "Correlate PRs to sessions.",
      },
    });
    renderWithRange(<PullRequestsPage />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Pull Requests" })).toBeInTheDocument(),
    );
    expect(screen.getByText("AI-assisted")).toBeInTheDocument();
    expect(screen.getByText("Context-aware routing orchestrator")).toBeInTheDocument();
    expect(screen.getAllByText("acme/harness-dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("82 A")).toBeInTheDocument();
    expect(screen.getByText("nps customer")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Select visible pull requests"));
    expect(screen.getByLabelText("Select PR 145")).toBeChecked();

    await user.click(screen.getByRole("combobox", { name: "PR author" }));
    await user.click(screen.getByRole("option", { name: /All contributors/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("author=__all"))).toBe(true),
    );

    await user.click(screen.getByRole("combobox", { name: "PR status" }));
    await user.type(screen.getByRole("textbox", { name: "Search PR status" }), "merged");
    await user.click(screen.getByRole("option", { name: "Merged" }));
    await waitFor(() =>
      expect(screen.queryByText("Context-aware routing orchestrator")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("combobox", { name: "PR status" }));
    await user.click(screen.getByRole("option", { name: "All statuses" }));
    await waitFor(() =>
      expect(screen.getByText("Context-aware routing orchestrator")).toBeInTheDocument(),
    );

    await user.type(screen.getByRole("textbox", { name: "Search pull requests" }), "billing");
    await waitFor(() =>
      expect(screen.queryByText("Context-aware routing orchestrator")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Ship billing export")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Search pull requests" }));
    await waitFor(() =>
      expect(screen.getByText("Context-aware routing orchestrator")).toBeInTheDocument(),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Open PR 145" }), { key: "Enter" });
    expect(screen.getByRole("dialog")).toHaveTextContent("#145 Context-aware routing orchestrator");
    expect(screen.getByRole("dialog")).toHaveTextContent("acme/harness-dashboard");
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Static Code Review"));
    expect(screen.getByRole("dialog")).toHaveTextContent("typo-app[bot]");
    expect(screen.getByRole("dialog")).toHaveTextContent("Business Value Index");
    expect(screen.getByRole("dialog")).toHaveTextContent("Correlated sessions");
    expect(screen.getByRole("dialog")).toHaveTextContent("codex:s-pr-145");
    expect(screen.getByRole("dialog")).toHaveTextContent("Related commits");
    expect(screen.getByRole("dialog")).toHaveTextContent("feat: context aware routing");
    expect(screen.getByRole("dialog")).toHaveTextContent("Deployments");
    expect(screen.getByRole("dialog")).toHaveTextContent("Post-merge incidents");
    expect(screen.getByRole("dialog")).toHaveTextContent("apps/web/app/pull-requests/page.tsx");
    expect(screen.getByRole("link", { name: "codex:s-pr-145" })).toHaveAttribute(
      "href",
      "/sessions?id=s-pr-145&provider=codex",
    );
    expect(screen.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/acme/harness-dashboard/pull/145",
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }, 15000);

  it("paginates and filters deterministic insights, then generates AI insights", async () => {
    const user = userEvent.setup();
    installFetch({
      "/api/pull-requests/deterministic-insights": deterministicInsightsForUrl,
      "/api/pull-requests/detail": prDetailForUrl,
      "/api/pull-requests/bundle": prBundleForUrl,
      "/api/pull-requests/ai-engines": engines,
      "/api/settings": {
        pr_ai_default_engine: "codex",
        pr_ai_default_generation_mode: "batch",
        pr_session_correlation_config: bundle.session_correlation_config,
        pr_session_correlation_prompt: "Correlate PRs to sessions.",
      },
      "/api/pull-requests/ai-insights/jobs/job-1": {
        id: "job-1",
        engine: "codex_cli",
        analysis_type: "business_value",
        scope: "selected_prs",
        status: "succeeded",
        created_at_utc: "2026-06-24T12:00:00Z",
        finished_at_utc: "2026-06-24T12:00:02Z",
        input_hash: "hash-1",
        error: null,
        result: {
          summary: "The review queue needs one targeted reviewer assignment.",
          insights: [
            {
              title: "Review queue risk",
              severity: "warning",
              evidence: "PR #145 has waited 30 hours without review.",
              recommendation: "Assign a reviewer today.",
              affected_prs: ["acme/harness-dashboard#145"],
            },
          ],
          indexes: [businessValueIndex],
          session_correlations: [sessionCorrelation],
        },
      },
      "/api/pull-requests/ai-insights/jobs": {
        id: "job-1",
        engine: "codex_cli",
        analysis_type: "business_value",
        scope: "selected_prs",
        status: "running",
        created_at_utc: "2026-06-24T12:00:00Z",
        finished_at_utc: null,
        input_hash: "",
        error: null,
        result: null,
      },
    });
    renderWithRange(<PullRequestsPage />);

    await user.click(await screen.findByLabelText("Select PR 145"));
    await user.click(screen.getAllByRole("button", { name: "Generate AI Maturity" })[0]!);
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, init]) =>
              String(url).includes("/api/pull-requests/ai-insights/jobs") &&
              String((init as RequestInit)?.body).includes('"analysis_type":"ai_maturity"') &&
              String((init as RequestInit)?.body).includes('"scope":"single_pr"') &&
              String((init as RequestInit)?.body).includes('"number":145'),
          ),
      ).toBe(true),
    );

    await user.click(await screen.findByRole("tab", { name: "PR AI Insights" }));
    expect(screen.getByText("PR cycle time")).toBeInTheDocument();
    expect(screen.getByText("PR waiting too long")).toBeInTheDocument();
    expect(screen.queryByText("Insight 9")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("Insight 9")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Insight type" }));
    await user.type(screen.getByRole("textbox", { name: "Search Insight type" }), "siz");
    await user.click(screen.getByRole("option", { name: "size" }));
    expect(screen.queryByText("PR waiting too long")).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "PR AI index type" }));
    await user.click(screen.getByRole("option", { name: "AI Maturity" }));
    expect(screen.getByRole("button", { name: "Generate AI Maturity" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "PR AI index type" }));
    await user.click(screen.getByRole("option", { name: "Business Value Index" }));
    await user.click(screen.getByRole("combobox", { name: "PR AI index scope" }));
    await user.click(screen.getByRole("option", { name: /Current author/ }));
    await user.click(screen.getByRole("combobox", { name: "PR AI index scope" }));
    await user.click(screen.getByRole("option", { name: /Selected PRs/ }));

    fireEvent.change(screen.getByLabelText("Session minutes before PR"), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByLabelText("Session minutes after PR"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Session min confidence"), {
      target: { value: "0.7" },
    });
    fireEvent.change(screen.getByLabelText("Max sessions per PR"), {
      target: { value: "6" },
    });
    await user.click(screen.getByLabelText("Branch"));
    await user.click(screen.getByText("Signal weights"));
    fireEvent.change(screen.getByLabelText("Time overlap weight"), {
      target: { value: "0.5" },
    });
    await user.click(screen.getByRole("button", { name: "Save deterministic config" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, init]) =>
              String(url).includes("/api/settings") &&
              String((init as RequestInit)?.body).includes("pr_session_correlation_config") &&
              String((init as RequestInit)?.body).includes('"time_window_before_minutes":120'),
          ),
      ).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: "Generate Business Value" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, init]) =>
              String(url).includes("/api/pull-requests/ai-insights/jobs") &&
              String((init as RequestInit)?.body).includes('"analysis_type":"business_value"') &&
              String((init as RequestInit)?.body).includes('"scope":"selected_prs"') &&
              String((init as RequestInit)?.body).includes('"number":145'),
          ),
      ).toBe(true),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Generate AI Insights" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Generate AI Insights" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("The review queue needs one targeted reviewer assignment.").length,
      ).toBeGreaterThan(0),
    );

    await user.click(screen.getByRole("button", { name: "Generate AI correlation" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, init]) =>
              String(url).includes("/api/pull-requests/ai-insights/jobs") &&
              String((init as RequestInit)?.body).includes('"analysis_type":"session_correlation"'),
          ),
      ).toBe(true),
    );
    expect(screen.getByRole("link", { name: "Open PR Rules settings" })).toHaveAttribute(
      "href",
      "/settings?section=rules",
    );
  }, 30000);

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
