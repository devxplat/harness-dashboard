import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import type { DailyRow } from "@/lib/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function row(day: string, sessions: number, tokens: number): DailyRow {
  return {
    day,
    sessions,
    input_tokens: tokens,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
  };
}

// Smoke test only: this is a recharts chart whose SVG draw callbacks need a real
// layout (jsdom gives zero size), so the grid/bars/cursor can't render here. The
// geometry is unit-tested in lib/activity-grid.test.ts; the file is excluded from
// coverage. We just assert the static chrome renders without throwing.
describe("ActivityHeatmap", () => {
  it("renders the header, totals and legend", () => {
    render(<ActivityHeatmap data={[row("2026-06-01", 1, 100), row("2026-06-02", 3, 500)]} />);
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText(/Blue squares = tokens/)).toBeInTheDocument();
  });
});
