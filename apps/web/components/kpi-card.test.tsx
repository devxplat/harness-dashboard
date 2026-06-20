import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./kpi-card";

describe("KpiCard", () => {
  it("renders label and value", () => {
    render(<KpiCard label="Sessions" value="42" />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders an optional hint", () => {
    render(<KpiCard label="Cost" value="$5.00" hint="estimated" />);
    expect(screen.getByText("estimated")).toBeInTheDocument();
  });

  it("omits the hint when not provided", () => {
    const { container } = render(<KpiCard label="Turns" value="10" />);
    expect(container.querySelector("p")).toBeNull();
  });
});
