import ProjectsPage from "@/app/projects/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const rows = [
  {
    project_slug: "myproj",
    sample_cwd: "/p",
    sessions: 1,
    turns: 2,
    input_tokens: 10,
    output_tokens: 20,
    billable_tokens: 30,
    cache_read_tokens: 5,
  },
];

describe("ProjectsPage", () => {
  it("renders rows", async () => {
    installFetch({ "/api/projects": rows });
    renderWithRange(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText("myproj")).toBeInTheDocument());
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
