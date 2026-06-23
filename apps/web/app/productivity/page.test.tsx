import ProductivityPage from "@/app/productivity/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
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

describe("ProductivityPage", () => {
  it("renders the AI split, peak hour, and the commits table", async () => {
    installFetch({ "/api/productivity": prod, "/api/commits": commits });
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByText("feat: a thing")).toBeInTheDocument());
    // Peak bucket from the productive-hours matrix (Wed 22:00).
    expect(screen.getByText(/Peak: Wed 10p/)).toBeInTheDocument();
    // The AI-assisted summary/legend and at least one AI badge are present.
    expect(screen.getAllByText(/AI-assisted/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI").length).toBeGreaterThan(0);
  });

  it("surfaces pull requests and deployments when present", async () => {
    installFetch({
      "/api/productivity": prod,
      "/api/commits": commits,
      "/api/pull-requests": [
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
      ],
      "/api/deployments": [
        {
          repo_key: "r",
          kind: "release",
          ext_id: "1",
          name: "v1.0.0",
          created_at_utc: "2026-06-20T12:00:00Z",
          status: "success",
          html_url: null,
        },
      ],
    });
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByText("My PR")).toBeInTheDocument());
    expect(screen.getByText("Pull requests")).toBeInTheDocument();
    expect(screen.getByText("Deployments")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("shows meeting impact when a calendar is synced", async () => {
    installFetch({
      "/api/productivity": prod,
      "/api/commits": commits,
      "/api/meetings/impact": {
        during_commits: 1,
        free_commits: 1,
        during_messages: 5,
        free_messages: 15,
      },
    });
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByText("Meeting impact")).toBeInTheDocument());
    expect(screen.getByText("25%")).toBeInTheDocument(); // 5 of 20 messages
    expect(screen.getByText("50%")).toBeInTheDocument(); // 1 of 2 commits
  });

  it("renders empty states when there are no commits", async () => {
    installFetch({
      "/api/productivity": { hours: [], aiByDay: [], aiByProject: [] },
      "/api/commits": [],
    });
    renderWithRange(<ProductivityPage />);
    // The commits card's empty note is uniquely worded (the AI card also shows a
    // short "No commits in range." block).
    await waitFor(() =>
      expect(screen.getByText(/Local git history is read/)).toBeInTheDocument(),
    );
  });

  it("renders the error state when productivity fails", async () => {
    installFailingFetch();
    renderWithRange(<ProductivityPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("renders the error state when only the commits request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const path = String(url);
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
