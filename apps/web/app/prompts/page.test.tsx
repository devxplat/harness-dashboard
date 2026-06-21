import PromptsPage from "@/app/prompts/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const rows = [
  {
    user_uuid: "u1",
    session_id: "s1",
    project_slug: "p",
    sample_cwd: null,
    timestamp: "2026-06-19T10:00:00Z",
    prompt_text: "hello",
    prompt_chars: 5,
    model: "claude-opus-4-8",
    billable_tokens: 100,
    cache_read_tokens: 5,
    estimated_cost_usd: 1.0,
    cost_estimated: true,
  },
];

describe("PromptsPage", () => {
  it("renders rows and toggles the sort", async () => {
    const fetchMock = installFetch({ "/api/prompts": rows });
    renderWithRange(<PromptsPage />);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.getByText("est.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recent" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("sort=recent"))).toBe(true));
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/prompts": [] });
    renderWithRange(<PromptsPage />);
    await waitFor(() => expect(screen.getByText("No prompts yet.")).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<PromptsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
