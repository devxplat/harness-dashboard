import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanSyncProvider } from "./scan-sync";
import { useApi } from "./use-api";

interface FakeES {
  onmessage: ((e: { data: string }) => void) | null;
  close: () => void;
}

function installFakeEventSource(): { current: FakeES | null } {
  const ref: { current: FakeES | null } = { current: null };
  class ES implements FakeES {
    onmessage: ((e: { data: string }) => void) | null = null;
    close = vi.fn();
    constructor(_url: string) {
      ref.current = this;
    }
  }
  vi.stubGlobal("EventSource", ES as unknown as typeof EventSource);
  return ref;
}

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { data } = useApi<{ n: number }>("/api/thing");
  return <span>n={data?.n ?? "-"}</span>;
}

describe("ScanSyncProvider + useApi live refresh", () => {
  it("silently refetches when a scan event arrives", async () => {
    const es = installFakeEventSource();
    let n = 1;
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ n }) }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScanSyncProvider>
        <Probe />
      </ScanSyncProvider>,
    );
    await waitFor(() => expect(screen.getByText("n=1")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    n = 2;
    act(() => es.current?.onmessage?.({ data: JSON.stringify({ type: "scan" }) }));
    await waitFor(() => expect(screen.getByText("n=2")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed and non-scan frames", async () => {
    const es = installFakeEventSource();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ n: 1 }) }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScanSyncProvider>
        <Probe />
      </ScanSyncProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => es.current?.onmessage?.({ data: "not json" }));
    act(() => es.current?.onmessage?.({ data: JSON.stringify({ type: "keep-alive" }) }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
