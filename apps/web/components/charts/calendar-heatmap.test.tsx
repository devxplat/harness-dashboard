import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import type { DailyRow } from "@/lib/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const data = [row("2026-06-10", 5, 1000), row("2026-06-15", 20, 8000)];

describe("CalendarHeatmap", () => {
  it("opens on the latest data month with session intensity", () => {
    render(<CalendarHeatmap data={data} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByTitle("2026-06-15 · 20 sessions")).toBeInTheDocument();
  });

  it("switches the metric to tokens", async () => {
    render(<CalendarHeatmap data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "tokens" }));
    expect(screen.getByTitle(/2026-06-15 · .*tokens/)).toBeInTheDocument();
  });

  it("navigates between months", async () => {
    render(<CalendarHeatmap data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("June 2026")).toBeInTheDocument();
  });

  it("falls back to the current month with no data", () => {
    render(<CalendarHeatmap data={[]} />);
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });
});
