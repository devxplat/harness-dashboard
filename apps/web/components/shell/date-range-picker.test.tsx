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

const dayButtons = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-day]"));

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

  it("highlights the active preset window when opened", async () => {
    // Default provider range is 30d, so opening should mark those days as the preset.
    render(
      <RangeProvider>
        <DateRangePicker />
      </RangeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pick a custom date range" }));
    expect(document.querySelector(".rdp-preset")).not.toBeNull();
  });

  it("keeps the popover open after the first click and commits on the second", async () => {
    const user = userEvent.setup();
    render(
      <RangeProvider>
        <DateRangePicker />
      </RangeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Pick a custom date range" }));

    const first = dayButtons();
    expect(first.length).toBeGreaterThan(25);
    const start = first[10];
    if (!start) throw new Error("calendar days not rendered");
    await user.click(start); // start only — must NOT close

    // Popover is still open: day grid is still mounted.
    const second = dayButtons();
    expect(second.length).toBeGreaterThan(25);
    const end = second[20];
    if (!end) throw new Error("calendar days not rendered after first click");
    await user.click(end); // completes the range -> commit + close

    const trigger = screen.getByRole("button", { name: "Pick a custom date range" });
    expect(trigger).not.toHaveTextContent("Custom range");
    expect(trigger).toHaveAttribute("data-variant", "default");
  });
});
