import { PathToggle, ProjectCell } from "@/components/path-display";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("ProjectCell", () => {
  const cwd = "D:\\Github\\harness-dashboard";

  it("shows the folder name when short, with the full path in the tooltip", () => {
    render(<ProjectCell cwd={cwd} slug="D--Github-harness-dashboard" short />);
    const el = screen.getByText("harness-dashboard");
    expect(el).toHaveAttribute("title", cwd);
  });

  it("shows the full path when not short", () => {
    render(<ProjectCell cwd={cwd} slug="D--Github-harness-dashboard" short={false} />);
    expect(screen.getByText(cwd)).toBeInTheDocument();
  });

  it("renders a link when given an href, a span otherwise", () => {
    const { rerender } = render(<ProjectCell cwd={cwd} short href="/sessions/?id=s1" />);
    expect(screen.getByRole("link").getAttribute("href")).toContain("id=s1");
    rerender(<ProjectCell cwd={cwd} short />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("falls back to the slug when there is no cwd", () => {
    render(<ProjectCell slug="some-slug" short={false} />);
    expect(screen.getByText("some-slug")).toBeInTheDocument();
  });
});

describe("PathToggle", () => {
  it("labels itself by state and fires onToggle on click", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<PathToggle short onToggle={onToggle} />);
    const btn = screen.getByRole("button", { name: "Short names" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<PathToggle short={false} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Full paths" })).toHaveAttribute("aria-pressed", "false");
  });
});
