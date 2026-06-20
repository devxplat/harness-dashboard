import ToolsPage from "@/app/tools/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("ToolsPage", () => {
  it("renders rows", async () => {
    installFetch({ "/api/tools": [{ tool_name: "Read", calls: 5, result_tokens: 100 }] });
    renderWithRange(<ToolsPage />);
    await waitFor(() => expect(screen.getByText("Read")).toBeInTheDocument());
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/tools": [] });
    renderWithRange(<ToolsPage />);
    await waitFor(() => expect(screen.getByText("No tool calls in range.")).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<ToolsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
