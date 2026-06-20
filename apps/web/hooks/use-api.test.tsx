import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApi } from "./use-api";

afterEach(() => vi.restoreAllMocks());

describe("useApi", () => {
  it("loads data from the path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ v: 1 }) }));
    const { result } = renderHook(() => useApi<{ v: number }>("/x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ v: 1 });
    expect(result.current.error).toBeNull();
  });

  it("skips fetching when path is null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useApi(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "x" }));
    const { result } = renderHook(() => useApi("/x"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
