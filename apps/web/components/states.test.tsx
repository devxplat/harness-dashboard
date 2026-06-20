import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "./states";

describe("state blocks", () => {
  it("ErrorBlock has an alert role and shows the message", () => {
    render(<ErrorBlock error="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("EmptyBlock shows its message", () => {
    render(<EmptyBlock message="nothing here" />);
    expect(screen.getByText("nothing here")).toBeInTheDocument();
  });

  it("PageTitle renders heading and description", () => {
    render(<PageTitle title="Overview" description="desc" />);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("desc")).toBeInTheDocument();
  });

  it("LoadingBlock marks itself busy", () => {
    const { container } = render(<LoadingBlock />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
