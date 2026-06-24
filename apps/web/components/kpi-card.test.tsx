import { render, screen } from "@testing-library/react";
import { Coins } from "lucide-react";
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

  it("renders a positive delta with an up trend", () => {
    render(<KpiCard label="Input" value="100" delta={0.2} />);
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
    expect(screen.getByText("vs prev")).toBeInTheDocument();
  });

  it("renders a negative delta", () => {
    render(<KpiCard label="Input" value="100" delta={-0.1} />);
    expect(screen.getByText("-10.0%")).toBeInTheDocument();
  });

  it("omits the delta row when delta is null", () => {
    render(<KpiCard label="Input" value="100" delta={null} />);
    expect(screen.queryByText("vs prev")).toBeNull();
  });

  it("renders an icon when provided", () => {
    const { container } = render(<KpiCard label="Cost" value="$5" icon={Coins} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
