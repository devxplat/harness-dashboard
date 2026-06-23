import { CommitsTable } from "@/components/commits-table";
import type { CommitRow } from "@/lib/types";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

const base = (over: Partial<CommitRow>): CommitRow => ({
  sha: "abc1234567",
  repo_key: "r",
  project_slug: "D--Github-alpha",
  sample_cwd: "D:\\Github\\alpha",
  author_name: "Alice",
  author_email: "alice@x.com",
  authored_at_utc: "2026-06-20T10:00:00Z",
  authored_at_local: "2026-06-20T10:00:00Z",
  subject: "feat: alpha thing",
  branch: "main",
  files_changed: 1,
  insertions: 10,
  deletions: 2,
  is_merge: false,
  ai_assisted: false,
  ai_session_overlap: false,
  ai_coauthor_trailer: false,
  coauthors: [],
  ...over,
});

const rows: CommitRow[] = [
  base({ sha: "a1", subject: "feat: alpha thing", author_name: "Alice" }),
  base({
    sha: "b2",
    subject: "fix: beta thing",
    project_slug: "D--Github-beta",
    sample_cwd: "D:\\Github\\beta",
    author_name: "Bob",
    ai_assisted: true,
    ai_coauthor_trailer: true,
    coauthors: ["Claude <noreply@anthropic.com>"],
  }),
];

function body(): HTMLElement {
  const tbody = screen.getAllByRole("rowgroup").at(1); // 0 = thead, 1 = tbody
  if (!tbody) throw new Error("no table body");
  return tbody;
}

describe("CommitsTable", () => {
  it("renders commits and surfaces co-authors", () => {
    render(<CommitsTable commits={rows} />);
    expect(screen.getByText("feat: alpha thing")).toBeInTheDocument();
    expect(screen.getByText("fix: beta thing")).toBeInTheDocument();
    // The co-author name is shown inline on the AI commit.
    expect(screen.getByText(/\+ Claude/)).toBeInTheDocument();
  });

  it("filters by project (autocomplete input)", async () => {
    render(<CommitsTable commits={rows} />);
    await userEvent.type(screen.getByLabelText("Filter by project"), "beta");
    const tbody = body();
    expect(within(tbody).getByText("fix: beta thing")).toBeInTheDocument();
    expect(within(tbody).queryByText("feat: alpha thing")).not.toBeInTheDocument();
  });

  it("filters by author including co-authors", async () => {
    render(<CommitsTable commits={rows} />);
    // "Claude" only appears as a co-author on the beta commit.
    await userEvent.type(screen.getByLabelText("Filter by author"), "Claude");
    const tbody = body();
    expect(within(tbody).getByText("fix: beta thing")).toBeInTheDocument();
    expect(within(tbody).queryByText("feat: alpha thing")).not.toBeInTheDocument();
  });

  it("filters by AI", async () => {
    render(<CommitsTable commits={rows} />);
    await userEvent.click(screen.getByLabelText("Filter by AI"));
    await userEvent.click(screen.getByRole("option", { name: "AI-assisted" }));
    const tbody = body();
    expect(within(tbody).getByText("fix: beta thing")).toBeInTheDocument();
    expect(within(tbody).queryByText("feat: alpha thing")).not.toBeInTheDocument();
  });
});
