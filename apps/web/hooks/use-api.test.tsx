import { act, renderHook, waitFor } from "@testing-library/react";
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

  it("shows loading and preserves stale data until a changed path resolves", async () => {
    const resolvers = new Map<string, (response: unknown) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const path = String(url);
        return new Promise((resolve) => {
          resolvers.set(path, resolve);
        });
      }),
    );
    const ok = (body: unknown) => ({ ok: true, json: async () => body });
    const { result, rerender } = renderHook(({ path }) => useApi<{ v: number }>(path), {
      initialProps: { path: "/a" },
    });

    await waitFor(() => expect(resolvers.size).toBe(1));
    const firstUrl = [...resolvers.keys()].find((url) => url.includes("/a"));
    expect(firstUrl).toBeTruthy();
    await act(async () => resolvers.get(firstUrl!)?.(ok({ v: 1 })));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ v: 1 });

    rerender({ path: "/b" });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual({ v: 1 });
    await waitFor(() => expect([...resolvers.keys()].some((url) => url.includes("/b"))).toBe(true));
    const secondUrl = [...resolvers.keys()].find((url) => url.includes("/b"));
    expect(secondUrl).toBeTruthy();
    await act(async () => resolvers.get(secondUrl!)?.(ok({ v: 2 })));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ v: 2 });
  });
});
