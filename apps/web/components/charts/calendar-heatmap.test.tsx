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
  it("opens on the latest data month and summarizes the selected day", () => {
    render(<CalendarHeatmap data={data} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    // The latest data day (Jun 15) is selected; the footer summarizes it (8000 -> 8.0K).
    expect(screen.getByText("15 Jun")).toBeInTheDocument();
    expect(screen.getByText("8.0K")).toBeInTheDocument();
  });

  it("updates the footer to the hovered day's sessions and tokens", async () => {
    const user = userEvent.setup();
    render(<CalendarHeatmap data={data} />);
    await user.hover(screen.getByRole("button", { name: "10" }));
    expect(screen.getByText("10 Jun")).toBeInTheDocument();
    expect(screen.getByText("1.0K")).toBeInTheDocument(); // Jun 10 tokens, unique to its summary
  });

  it("toggles the active metric", async () => {
    render(<CalendarHeatmap data={data} />);
    const tokensBtn = screen.getByRole("button", { name: "tokens" });
    await userEvent.click(tokensBtn);
    expect(tokensBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "sessions" })).toHaveAttribute("aria-pressed", "false");
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
