import SubagentsPage from "@/app/subagents/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const row = {
  group: "main",
  model: "claude-opus-4-8",
  messages: 1,
  sessions: 1,
  input_tokens: 10,
  output_tokens: 20,
  cache_read_tokens: 5,
  cost_usd: 0.1,
  cost_estimated: false,
};

describe("SubagentsPage", () => {
  it("renders by-kind and by-entrypoint tables", async () => {
    installFetch({ "/api/subagents": { by_kind: [row], by_entrypoint: [{ ...row, group: "cli" }] } });
    renderWithRange(<SubagentsPage />);
    await waitFor(() => expect(screen.getByText("By kind")).toBeInTheDocument());
    expect(screen.getByText("By entrypoint")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("cli")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/subagents": { by_kind: [], by_entrypoint: [] } });
    renderWithRange(<SubagentsPage />);
    await waitFor(() => expect(screen.getByText("No assistant activity in range.")).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<SubagentsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
