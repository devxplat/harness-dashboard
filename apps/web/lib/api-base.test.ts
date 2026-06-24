import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API_BASE", () => {
  it("derives from the page host in dev (works for localhost and LAN)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { API_BASE } = await import("./api-base");
    expect(API_BASE).toBe(`http://${window.location.hostname}:8080`);
  });

  it("honors an explicit NEXT_PUBLIC_API_BASE override", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE", "http://example.test:9000");
    vi.resetModules();
    const { API_BASE } = await import("./api-base");
    expect(API_BASE).toBe("http://example.test:9000");
  });

  it("is same-origin in the packaged production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { API_BASE } = await import("./api-base");
    expect(API_BASE).toBe("");
  });
});
