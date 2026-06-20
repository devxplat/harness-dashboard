import OverviewPage from "@/app/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const bundle = {
  totals: {
    sessions: 2,
    turns: 3,
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 50,
    cache_create_5m_tokens: 10,
    cache_create_1h_tokens: 5,
    cost_usd: 1.5,
    cost_estimated: true,
  },
  projects: [],
  sessions: [
    {
      session_id: "s1",
      project_slug: "p",
      sample_cwd: null,
      started: null,
      ended: null,
      turns: 2,
      tokens: 300,
      cost_usd: 1,
      cost_estimated: false,
    },
  ],
  tools: [],
  daily: [{ day: "2026-06-19", input_tokens: 100, output_tokens: 200, cache_read_tokens: 50, cache_create_tokens: 15 }],
  byModel: [
    {
      model: "claude-opus-4-8",
      turns: 1,
      input_tokens: 100,
      output_tokens: 200,
      cache_read_tokens: 50,
      cost_usd: 1.5,
      cost_estimated: false,
    },
  ],
};

describe("OverviewPage", () => {
  it("renders KPIs, chart, by-model and recent sessions", async () => {
    installFetch({ "/api/overview-bundle": bundle });
    renderWithRange(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("Est. cost")).toBeInTheDocument());
    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument();
    expect(screen.getByText("Daily tokens")).toBeInTheDocument();
  });

  it("renders the empty chart state when there is no daily data", async () => {
    installFetch({ "/api/overview-bundle": { ...bundle, daily: [] } });
    renderWithRange(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("No activity in range.")).toBeInTheDocument());
  });

  it("shows an error state", async () => {
    installFailingFetch();
    renderWithRange(<OverviewPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
