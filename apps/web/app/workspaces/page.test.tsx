import WorkspacesPage from "@/app/workspaces/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("WorkspacesPage", () => {
  it("renders rows", async () => {
    installFetch({
      "/api/workspaces": [
        { workspace: "D--Github-myproj", sample_cwd: "D:\\Github\\myproj", calls: 3, files: 2 },
      ],
    });
    renderWithRange(<WorkspacesPage />);
    await waitFor(() => expect(screen.getByText("myproj")).toBeInTheDocument());
    expect(screen.getByText("File-edit calls")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/workspaces": [] });
    renderWithRange(<WorkspacesPage />);
    await waitFor(() => expect(screen.getByText("No file-editing activity in range.")).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<WorkspacesPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
