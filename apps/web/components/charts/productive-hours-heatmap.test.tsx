import { ProductiveHoursHeatmap } from "@/components/charts/productive-hours-heatmap";
import type { ProductiveHourRow } from "@/lib/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

const hr = (dow: number, hour: number, commits: number, messages: number): ProductiveHourRow => ({
  dow,
  hour,
  commits,
  messages,
});

describe("ProductiveHoursHeatmap", () => {
  it("summarizes totals and the peak bucket", () => {
    // Wed (dow 3) 22:00 is the busiest bucket under "both" (9 vs 1).
    render(<ProductiveHoursHeatmap data={[hr(1, 9, 1, 0), hr(3, 22, 5, 4)]} />);
    // Default metric is "both": 6 commits / 4 messages.
    expect(screen.getByText(/6 commits/)).toBeInTheDocument();
    expect(screen.getByText(/Peak: Wed 10p/)).toBeInTheDocument();
  });

  it("toggles the active metric", async () => {
    render(<ProductiveHoursHeatmap data={[hr(1, 9, 1, 4)]} />);
    const commitsBtn = screen.getByRole("button", { name: "commits" });
    await userEvent.click(commitsBtn);
    expect(commitsBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "both" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the empty-range note when there is no activity", () => {
    render(<ProductiveHoursHeatmap data={[]} />);
    expect(screen.getByText("No activity in range")).toBeInTheDocument();
  });
});
