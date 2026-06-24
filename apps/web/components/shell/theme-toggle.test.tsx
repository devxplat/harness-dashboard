import { TooltipProvider } from "@/components/ui/tooltip";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
let resolvedTheme = "dark";
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme, setTheme }) }));

// imported after the mock is registered
import { ThemeToggle } from "./theme-toggle";

afterEach(() => setTheme.mockClear());

describe("ThemeToggle", () => {
  it("switches to light when currently dark", async () => {
    resolvedTheme = "dark";
    render(
      <TooltipProvider>
        <ThemeToggle />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("switches to dark when currently light", async () => {
    resolvedTheme = "light";
    render(
      <TooltipProvider>
        <ThemeToggle />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
