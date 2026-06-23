import ProjectsPage from "@/app/projects/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const rows = [
  {
    provider: "claude",
    project_slug: "D--Github-myproj",
    repo_key: "d:/github/myproj/.git",
    repo_root: "D:\\Github\\myproj",
    sample_cwd: "D:\\Github\\myproj",
    sessions: 1,
    turns: 2,
    input_tokens: 10,
    output_tokens: 20,
    billable_tokens: 30,
    cache_read_tokens: 5,
  },
  {
    provider: "codex",
    project_slug: "myproj",
    repo_key: "d:/github/myproj/.git",
    repo_root: "D:\\Github\\myproj",
    sample_cwd: "D:\\Github\\myproj\\apps\\web",
    sessions: 3,
    turns: 4,
    input_tokens: 100,
    output_tokens: 200,
    billable_tokens: 300,
    cache_read_tokens: 50,
  },
  {
    provider: "codex",
    project_slug: "web",
    repo_key: "d:/github/myproj/.git",
    repo_root: "D:\\Github\\myproj",
    sample_cwd: "D:\\Github\\myproj\\apps\\web",
    sessions: 2,
    turns: 5,
    input_tokens: 20,
    output_tokens: 30,
    billable_tokens: 50,
    cache_read_tokens: 10,
  },
  {
    provider: "codex",
    project_slug: "other-worktree",
    repo_key: "d:/github/myproj/.git",
    repo_root: "D:\\Github\\other-worktree",
    sample_cwd: "D:\\Github\\other-worktree",
    sessions: 4,
    turns: 8,
    input_tokens: 40,
    output_tokens: 50,
    billable_tokens: 90,
    cache_read_tokens: 0,
  },
];

describe("ProjectsPage", () => {
  it("renders rows", async () => {
    installFetch({ "/api/projects": rows });
    renderWithRange(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText("myproj")).toBeInTheDocument());
    expect(screen.getAllByText("myproj")).toHaveLength(1);
    expect(screen.getByText("other-worktree")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Codex")).toHaveLength(2);
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/projects": [] });
    renderWithRange(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText("No projects in range.")).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<ProjectsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
