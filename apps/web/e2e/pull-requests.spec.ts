import { expect, test } from "@playwright/test";
import { seedConfiguredFixture } from "./support";

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
      html_url: null,
      ai_session_overlap: false,
      churn: 302,
      age_hours: 40,
      cycle_hours: 32,
      review_wait_hours: 26,
      files: [],
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

let lastAiJobBody = "";

test.beforeEach(async ({ request, page }) => {
  await seedConfiguredFixture(request);
  lastAiJobBody = "";

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      json: {
        claude_dir: "/home/.claude",
        projects_dir: "/home/.claude/projects",
        projects_overridden: false,
        claude_dirs: ["/home/.claude"],
        plan: "api",
        github_login: "alice",
        pr_ai_default_engine: "codex",
        pr_ai_default_generation_mode: "batch",
        pr_business_value_prompt: "Score business impact.",
        pr_ai_maturity_prompt: "Score AI maturity.",
        providers: [],
      },
    });
  });

  await page.route("**/api/pull-requests/bundle**", async (route) => {
    await route.fulfill({ json: bundle });
  });
  await page.route("**/api/pull-requests/ai-engines", async (route) => {
    await route.fulfill({
      json: [
        {
          id: "codex",
          label: "Codex CLI",
          command: "codex",
          available: true,
          notes: "Uses codex exec in a read-only sandbox.",
        },
      ],
    });
  });
  await page.route("**/api/pull-requests/ai-insights/jobs/job-1", async (route) => {
    await route.fulfill({
      json: {
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
        },
      },
    });
  });
  await page.route("**/api/pull-requests/ai-insights/jobs", async (route) => {
    lastAiJobBody = route.request().postData() ?? "";
    await route.fulfill({
      json: {
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
  });
});

test("pull request overview, AI insights, and rule settings are functional", async ({ page }) => {
  let savedRulesBody = "";
  await page.route("**/api/pull-requests/insight-rules", async (route) => {
    if (route.request().method() === "POST") {
      savedRulesBody = route.request().postData() ?? "";
      await route.fulfill({ json: prRules });
      return;
    }
    await route.fulfill({ json: prRules });
  });

  await page.goto("/pull-requests/");
  const main = page.getByRole("main");

  await expect(main.getByRole("heading", { name: "Pull Requests" })).toBeVisible();
  await expect(main.getByText("AI-assisted")).toBeVisible();
  await expect(main.getByText("Context-aware routing orchestrator")).toBeVisible();
  await expect(main.getByText("acme/harness-dashboard").first()).toBeVisible();
  await expect(main.getByText("82 A")).toBeVisible();
  await expect(main.getByText("nps customer")).toBeVisible();
  await expect(main.getByRole("group", { name: "PR grain" })).toHaveCount(0);

  await main.getByLabel("PR author autocomplete").fill("All contributors");
  await main.getByRole("button", { name: "Apply" }).click();

  await main.getByLabel("Select PR 145").check();
  await main.getByText("Context-aware routing orchestrator").click();
  await expect(page.getByRole("dialog")).toContainText("#145 Context-aware routing orchestrator");
  await expect(page.getByRole("dialog")).toContainText("acme/harness-dashboard");
  await expect(page.getByRole("dialog")).toContainText("Static Code Review");
  await expect(page.getByRole("dialog")).toContainText("typo-app[bot]");
  await expect(page.getByRole("dialog")).toContainText("apps/web/app/pull-requests/page.tsx");
  await page.getByRole("button", { name: "Close" }).click();

  await main.getByRole("textbox", { name: "Search pull requests" }).fill("billing");
  await expect(main.getByText("Context-aware routing orchestrator")).toHaveCount(0);
  await expect(main.getByText("Ship billing export")).toBeVisible();
  await main.getByRole("textbox", { name: "Search pull requests" }).fill("");

  await main.getByRole("tab", { name: "PR AI Insights" }).click();
  await expect(main.getByText("PR cycle time")).toBeVisible();
  await expect(main.getByText("PR waiting too long")).toBeVisible();
  await expect(main.getByText("Insight 9")).toHaveCount(0);
  await main.getByRole("button", { name: /Next/ }).click();
  await expect(main.getByText("Insight 9")).toBeVisible();

  await main.getByRole("combobox", { name: "Insight type" }).click();
  await page.getByRole("option", { name: "size" }).click();
  await expect(main.getByText("PR waiting too long")).toHaveCount(0);

  await main.getByRole("button", { name: "Generate Business Value" }).click();
  await expect.poll(() => lastAiJobBody).toContain('"analysis_type":"business_value"');
  expect(lastAiJobBody).toContain('"scope":"selected_prs"');
  expect(lastAiJobBody).toContain('"number":145');

  await main.getByRole("button", { name: "Generate AI Insights" }).click();
  await expect(
    main.getByText("The review queue needs one targeted reviewer assignment.").first(),
  ).toBeVisible();

  await main.getByRole("link", { name: "Open PR Rules settings" }).click();
  await expect(page).toHaveURL(/\/settings\/?\?section=rules/);
  await expect(page.getByText("Deterministic PR Rules")).toBeVisible();
  await expect(page.getByText("Large PR size")).toBeVisible();

  await page.getByRole("textbox", { name: "Rule id" }).fill("custom-review-sla");
  await page.getByRole("textbox", { name: "Rule title" }).fill("Custom review SLA");
  await page.getByLabel("Rule recommendation").fill("Escalate stale PRs.");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect.poll(() => savedRulesBody).toContain("custom-review-sla");
});
