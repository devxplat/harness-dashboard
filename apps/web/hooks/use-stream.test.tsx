import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStream } from "./use-stream";

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

describe("useStream", () => {
  it("parses events and invokes the callback", async () => {
    const ref = installFakeEventSource();
    const cb = vi.fn();
    const { result } = renderHook(() => useStream(cb));
    await waitFor(() => expect(ref.current).not.toBeNull());
    act(() => {
      ref.current?.onmessage?.({
        data: JSON.stringify({ type: "scan", n: { files: 1, messages: 2, tools: 3 } }),
      });
    });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ type: "scan" }));
    expect(result.current?.type).toBe("scan");
  });

  it("ignores malformed frames", async () => {
    const ref = installFakeEventSource();
    renderHook(() => useStream());
    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(() => act(() => ref.current?.onmessage?.({ data: "not json" }))).not.toThrow();
  });
});
