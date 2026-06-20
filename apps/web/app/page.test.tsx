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

// Previous-window totals (all smaller → positive deltas). turns 3 vs 2 = +50%, cost 1.5 vs 1.2 = +25%.
const prevTotals = {
  sessions: 1,
  turns: 2,
  input_tokens: 50,
  output_tokens: 100,
  cache_read_tokens: 25,
  cache_create_5m_tokens: 5,
  cache_create_1h_tokens: 2,
  cost_usd: 1.2,
  cost_estimated: false,
};

describe("OverviewPage", () => {
  it("renders KPIs, chart, by-model and recent sessions", async () => {
    // Order matters: substring match is first-key-wins. The previous-window URL has
    // "until="; the current-totals URL is plain "/api/overview"; bundle is its own path.
    installFetch({
      "/api/overview-bundle": bundle,
      "until=": prevTotals,
      "/api/overview": bundle.totals,
    });
    renderWithRange(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("Est. cost")).toBeInTheDocument());
    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument();
    expect(screen.getByText("Daily tokens")).toBeInTheDocument();
    // Genuine period-over-period deltas from the previous-window fetch.
    expect(await screen.findByText("+50.0%")).toBeInTheDocument(); // turns 3 vs 2
    expect(screen.getByText("+25.0%")).toBeInTheDocument(); // cost 1.5 vs 1.2
  });

  it("renders the empty chart state when there is no daily data", async () => {
    installFetch({ "/api/overview-bundle": { ...bundle, daily: [] }, "/api/overview": bundle.totals });
    renderWithRange(<OverviewPage />);
    await waitFor(() => expect(screen.getByText("No activity in range.")).toBeInTheDocument());
  });

  it("shows an error state", async () => {
    installFailingFetch();
    renderWithRange(<OverviewPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
