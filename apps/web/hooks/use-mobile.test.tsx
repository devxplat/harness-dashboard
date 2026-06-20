import { useIsMobile } from "@/hooks/use-mobile";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("useIsMobile", () => {
  it("returns a boolean", () => {
    const { result } = renderHook(() => useIsMobile());
    expect(typeof result.current).toBe("boolean");
  });
});
