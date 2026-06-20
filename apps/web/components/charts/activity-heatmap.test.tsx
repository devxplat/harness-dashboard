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

describe("ActivityHeatmap", () => {
  it("renders the header, totals, day columns and a singular legend", () => {
    const { container } = render(
      <ActivityHeatmap data={[row("2026-06-01", 1, 100), row("2026-06-02", 3, 500)]} />,
    );
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    // The grid is built from small square cells.
    expect(container.querySelectorAll("span.rounded-\\[2px\\]").length).toBeGreaterThan(0);
    expect(screen.getByTitle(/2026-06-02 · 3 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/1 session \(orange\)/)).toBeInTheDocument();
  });

  it("pluralizes the session quantum when data is large", () => {
    render(<ActivityHeatmap data={[row("2026-06-01", 64, 1000)]} />);
    // ceil(64/8) = 8 sessions per square -> plural label.
    expect(screen.getByText(/8 sessions \(orange\)/)).toBeInTheDocument();
  });
});
