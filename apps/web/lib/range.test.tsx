import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RangeProvider, useRange } from "./range";

describe("range context", () => {
  it("defaults to 30d with a since timestamp", () => {
    const { result } = renderHook(() => useRange(), { wrapper: RangeProvider });
    expect(result.current.range).toBe("30d");
    expect(result.current.since).toBeTruthy();
  });

  it("'all' clears the since bound", () => {
    const { result } = renderHook(() => useRange(), { wrapper: RangeProvider });
    act(() => result.current.setRange("all"));
    expect(result.current.range).toBe("all");
    expect(result.current.since).toBeNull();
  });

  it("'7d' produces a more recent since than '90d'", () => {
    const { result } = renderHook(() => useRange(), { wrapper: RangeProvider });
    act(() => result.current.setRange("7d"));
    const seven = result.current.since!;
    act(() => result.current.setRange("90d"));
    const ninety = result.current.since!;
    expect(seven > ninety).toBe(true);
  });
});
