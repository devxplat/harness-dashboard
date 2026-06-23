import { OverviewStats } from "@/components/overview-stats";
import type { Totals } from "@/lib/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const totals: Totals = {
  sessions: 3,
  turns: 6,
  input_tokens: 100,
  output_tokens: 200,
  cache_read_tokens: 50,
  cache_create_5m_tokens: 10,
  cache_create_1h_tokens: 5,
  cost_usd: 2,
  cost_estimated: true,
  reported_cost_usd: null,
};

const prev: Totals = { ...totals, turns: 3, cost_usd: 1 };

describe("OverviewStats", () => {
  it("shows the metric cards, the cost delta, and drill-down links", () => {
    render(<OverviewStats totals={totals} prev={prev} rangeLabel="Last 30 days" />);
    expect(screen.getByText("Usage Overview")).toBeInTheDocument();
    expect(screen.getByText(/Last 30 days/)).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Input Tokens")).toBeInTheDocument();
    expect(screen.getByText("Output Tokens")).toBeInTheDocument();
    expect(screen.getByText("Est. cost")).toBeInTheDocument();
    // turns 6 vs 3 and cost 2 vs 1 both = +100% (trend shown on the cards/stats).
    expect(screen.getAllByText(/\+100%/).length).toBeGreaterThan(0);
    // Cards link to their drill-down pages.
    expect(screen.getByRole("link", { name: /Browse sessions/i })).toHaveAttribute(
      "href",
      "/sessions",
    );
    expect(screen.getByRole("link", { name: /expensive prompts/i })).toHaveAttribute(
      "href",
      "/prompts",
    );
  });

  it("omits the cost delta when there is no comparable prior window", () => {
    render(<OverviewStats totals={totals} prev={null} rangeLabel="All time" />);
    expect(screen.queryByText(/vs prev/)).toBeNull();
  });
});
