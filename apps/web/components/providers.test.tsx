import { Providers } from "@/components/providers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Providers", () => {
  it("renders its children", () => {
    render(
      <Providers>
        <div>child-content</div>
      </Providers>,
    );
    expect(screen.getByText("child-content")).toBeInTheDocument();
  });
});
