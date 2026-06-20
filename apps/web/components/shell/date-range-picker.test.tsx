import { DateRangePicker } from "@/components/shell/date-range-picker";
import { RangeProvider, useRange } from "@/lib/range";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/** Drives a custom window from inside the provider so the trigger label can be asserted. */
function CustomHarness() {
  const { setCustom } = useRange();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          // Local-midnight dates so the formatted label is timezone-stable.
          setCustom(new Date(2026, 5, 1).toISOString(), new Date(2026, 5, 8).toISOString())
        }
      >
        seed
      </button>
      <DateRangePicker />
    </>
  );
}

describe("DateRangePicker", () => {
  it("shows a prompt label and outline style with no custom window", () => {
    render(
      <RangeProvider>
        <DateRangePicker />
      </RangeProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Pick a custom date range" });
    expect(trigger).toHaveTextContent("Custom range");
    expect(trigger).toHaveAttribute("data-variant", "outline");
  });

  it("renders the inclusive custom window in the trigger", async () => {
    render(
      <RangeProvider>
        <CustomHarness />
      </RangeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "seed" }));
    const trigger = screen.getByRole("button", { name: "Pick a custom date range" });
    // until is exclusive (Jun 8), so the shown end is Jun 7.
    expect(trigger).toHaveTextContent("Jun 1 – Jun 7, 2026");
    expect(trigger).toHaveAttribute("data-variant", "default");
  });

  it("selects a range from the calendar and closes the popover", async () => {
    const user = userEvent.setup();
    render(
      <RangeProvider>
        <DateRangePicker />
      </RangeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Pick a custom date range" }));

    const days = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-day]"));
    expect(days.length).toBeGreaterThan(25);
    const start = days[10];
    const end = days[20];
    if (!start || !end) throw new Error("calendar days not rendered");
    await user.click(start); // sets range start (onSelect early-returns: no end yet)
    await user.click(end); // completes the range -> setCustom + close

    const trigger = screen.getByRole("button", { name: "Pick a custom date range" });
    expect(trigger).not.toHaveTextContent("Custom range");
    expect(trigger).toHaveAttribute("data-variant", "default");
  });
});
