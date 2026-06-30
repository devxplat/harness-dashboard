import ProductivityPage from "@/app/productivity/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const prod = {
  hours: [
    { dow: 3, hour: 22, commits: 5, messages: 4 },
    { dow: 1, hour: 9, commits: 1, messages: 0 },
  ],
  aiByDay: [{ key: "2026-06-20", ai_commits: 2, human_commits: 1 }],
  aiByProject: [{ key: "proj", ai_commits: 2, human_commits: 1 }],
};

const insights = {
  grain: "day",
  summary: {
    commits: 3,
    ai_commits: 2,
    messages: 8,
    meeting_minutes: 90,
    focus_minutes: 180,
    flow_minutes: 120,
    pr_count: 2,
    merged_pr_count: 1,
    avg_warmup_minutes: 18,
    estimated: true,
  },
  periods: [
    {
      period: "2026-06-20",
      commits: 3,
      ai_commits: 2,
      messages: 8,
      pr_count: 2,
      merged_pr_count: 1,
      meeting_minutes: 90,
      focus_minutes: 180,
      flow_minutes: 120,
      avg_warmup_minutes: 18,
    },
  ],
  focusBlocks: [
    {
      period: "2026-06-20",
      started_at: "2026-06-20T10:00:00Z",
      ended_at: "2026-06-20T11:15:00Z",
      duration_minutes: 75,
      events: 3,
      commits: 1,
      messages: 2,
      flow: true,
    },
  ],
  warmup: [
    { bucket: "0-15", count: 1, avg_minutes: 10 },
    { bucket: "15-30", count: 1, avg_minutes: 18 },
    { bucket: "30-60", count: 0, avg_minutes: null },
    { bucket: "60-120", count: 0, avg_minutes: null },
    { bucket: "120+", count: 0, avg_minutes: null },
  ],
  prCorrelation: [
    {
      repo_key: "r",
      pr_count: 2,
      merged_pr_count: 1,
      avg_lead_hours: 4,
      avg_review_wait_hours: 1.5,
      churn: 42,
      ai_overlap_prs: 1,
      commits: 3,
      messages: 8,
    },
  ],
};

const emptyInsights = {
  grain: "day",
  summary: {
    commits: 0,
    ai_commits: 0,
    messages: 0,
    meeting_minutes: 0,
    focus_minutes: 0,
    flow_minutes: 0,
    pr_count: 0,
    merged_pr_count: 0,
    avg_warmup_minutes: null,
    estimated: true,
  },
  periods: [],
  focusBlocks: [],
  warmup: [
    { bucket: "0-15", count: 0, avg_minutes: null },
    { bucket: "15-30", count: 0, avg_minutes: null },
    { bucket: "30-60", count: 0, avg_minutes: null },
    { bucket: "60-120", count: 0, avg_minutes: null },
    { bucket: "120+", count: 0, avg_minutes: null },
  ],
  prCorrelation: [],
};

const commit = (over: Record<string, unknown>) => ({
  sha: "abc1234567",
  repo_key: "r",
  project_slug: "D--Github-myproj",
  sample_cwd: "D:\\Github\\myproj",
  author_name: "Dev",
  author_email: "d@e.com",
  authored_at_utc: "2026-06-20T10:00:00Z",
  authored_at_local: "2026-06-20T10:00:00Z",
  subject: "feat: a thing",
  branch: "main",
  files_changed: 2,
  insertions: 10,
  deletions: 3,
  is_merge: false,
  ai_assisted: true,
  ai_session_overlap: true,
  ai_coauthor_trailer: false,
  coauthors: [],
  ...over,
});

const commits = [
  commit({}),
  commit({ subject: "fix: b", ai_session_overlap: false, ai_coauthor_trailer: true }),
  commit({
    subject: null,
    author_name: null,
    ai_assisted: false,
    ai_session_overlap: false,
    ai_coauthor_trailer: false,
  }),
];

const prs = [
  {
    repo_key: "r",
    number: 7,
    title: "My PR",
    state: "merged",
    author: "dev",
    created_at_utc: "2026-06-20T10:00:00Z",
    merged_at_utc: "2026-06-20T11:00:00Z",
    head_branch: "f",
    base_branch: "main",
    additions: 9,
    deletions: 1,
    changed_files: 2,
    review_count: 1,
    html_url: "https://github.com/o/r/pull/7",
    ai_session_overlap: true,
  },
];

const deployments = [
  {
    repo_key: "r",
    kind: "release",
    ext_id: "1",
    name: "v1.0.0",
    created_at_utc: "2026-06-20T12:00:00Z",
    status: "success",
    html_url: null,
  },
];

describe("ProductivityPage", () => {
  it("renders summary cards, AI split, peak hour, and the commits table", async () => {
    installFetch({
      "/api/productivity/insights": insights,
      "/api/productivity": prod,
      "/api/commits": commits,
      "/api/pull-requests": prs,
      "/api/deployments": deployments,
    });
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByText("feat: a thing")).toBeInTheDocument());
    expect(screen.getByText("Post-meeting warm-up")).toBeInTheDocument();
    expect(screen.getByText(/Peak: Wed 10p/)).toBeInTheDocument();
    expect(screen.getAllByText(/AI-assisted/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI").length).toBeGreaterThan(0);
  });

  it("renders focus and PR impact tabs", async () => {
    const user = userEvent.setup();
    installFetch({
      "/api/productivity/insights": insights,
      "/api/productivity": prod,
      "/api/commits": commits,
      "/api/pull-requests": prs,
      "/api/deployments": deployments,
    });
    renderWithRange(<ProductivityPage />);

    await user.click(await screen.findByRole("tab", { name: "Focus" }));
    expect(screen.getByText("Estimated focus active span and flow trend")).toBeInTheDocument();
    expect(screen.getByText("Longest estimated focus blocks")).toBeInTheDocument();
    expect(screen.getByText("flow")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "PR Impact" }));
    expect(screen.getByText("Repo and PR comparison")).toBeInTheDocument();
    expect(screen.getByText("PR impact rows")).toBeInTheDocument();
    expect(screen.getAllByText("Pull requests").length).toBeGreaterThan(0);
    expect(screen.getByText("Deployments")).toBeInTheDocument();
    expect(screen.getByText("My PR")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByTitle("r")).toBeInTheDocument();
  });

  it("shows calendar impact when a calendar is synced", async () => {
    const user = userEvent.setup();
    installFetch({
      "/api/productivity/insights": insights,
      "/api/productivity": prod,
      "/api/commits": commits,
      "/api/pull-requests": prs,
      "/api/deployments": deployments,
      "/api/meetings/impact": {
        during_commits: 1,
        free_commits: 1,
        during_messages: 5,
        free_messages: 15,
      },
    });
    renderWithRange(<ProductivityPage />);
    await user.click(await screen.findByRole("tab", { name: "Calendar Impact" }));
    expect(screen.getByText("Assistant messages during meetings")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Meeting-heavy periods")).toBeInTheDocument();
  });

  it("renders empty states when there are no commits or insight rows", async () => {
    installFetch({
      "/api/productivity/insights": emptyInsights,
      "/api/productivity": { hours: [], aiByDay: [], aiByProject: [] },
      "/api/commits": [],
      "/api/pull-requests": [],
      "/api/deployments": [],
    });
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByText(/No productivity data/)).toBeInTheDocument());
    expect(screen.getAllByText(/Local git history is read/).length).toBeGreaterThan(0);
  });

  it("renders the error state when productivity insights fail", async () => {
    installFailingFetch();
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("renders the error state when only the commits request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const path = String(url);
        if (path.includes("/api/productivity/insights")) {
          return Promise.resolve({ ok: true, json: async () => insights });
        }
        if (path.includes("/api/productivity")) {
          return Promise.resolve({ ok: true, json: async () => prod });
        }
        return Promise.resolve({ ok: false, status: 500, statusText: "err" });
      }),
    );
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
