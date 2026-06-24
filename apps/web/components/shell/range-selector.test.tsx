import { RangeSelector } from "@/components/shell/range-selector";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RangeProvider } from "@/lib/range";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

describe("RangeSelector", () => {
  it("marks the clicked range as pressed", async () => {
    render(
      <TooltipProvider>
        <RangeProvider>
          <RangeSelector />
        </RangeProvider>
      </TooltipProvider>,
    );
    const sevenDay = screen.getByRole("button", { name: "7d" });
    await userEvent.click(sevenDay);
    expect(sevenDay).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "false");
  });
});
