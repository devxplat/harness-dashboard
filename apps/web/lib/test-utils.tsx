import { RangeProvider } from "@/lib/range";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** Render a component inside the range context (most views need it). */
export function renderWithRange(ui: ReactElement): RenderResult {
  return render(<RangeProvider>{ui}</RangeProvider>);
}

/** Stub `fetch`, routing by URL substring to canned JSON (defaults to `[]`). */
export function installFetch(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn((url: string | URL) => {
    const path = String(url);
    const key = Object.keys(routes).find((k) => path.includes(k));
    return Promise.resolve({ ok: true, json: async () => (key ? routes[key] : []) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Stub `fetch` to always fail, exercising the error states. */
export function installFailingFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 500, statusText: "err" })),
  );
}
