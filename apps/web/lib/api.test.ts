import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost, rangeQuery } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("apiGet", () => {
  it("returns parsed json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) }));
    expect(await apiGet<{ a: number }>("/x")).toEqual({ a: 1 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/x"),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });
  it("throws on non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "boom" }),
    );
    await expect(apiGet("/x")).rejects.toThrow("500");
  });
});

describe("apiPost", () => {
  it("posts a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await apiPost("/y", { z: 2 });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/y"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ z: 2 }) }),
    );
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get("authorization")).toContain("Bearer ");
  });
});

describe("rangeQuery", () => {
  it("is empty for null and encodes a since", () => {
    expect(rangeQuery(null)).toBe("");
    expect(rangeQuery("2026-01-01T00:00:00Z")).toContain("since=");
  });
});
