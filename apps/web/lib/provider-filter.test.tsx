import { ProviderFilterProvider, useProviderFilter } from "@/lib/provider-filter";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { available, queryProviders, settingsLoaded, hasAvailableProviders } = useProviderFilter();
  return (
    <div>
      <div data-testid="loaded">{String(settingsLoaded)}</div>
      <div data-testid="has">{String(hasAvailableProviders)}</div>
      <div data-testid="available">{available.join(",")}</div>
      <div data-testid="query">{queryProviders.join(",")}</div>
    </div>
  );
}

describe("ProviderFilterProvider", () => {
  it("defaults to enabled and discovered providers only", async () => {
    installFetch({
      "/api/settings": {
        providers: [
          { id: "claude", enabled: true, discovered: true },
          { id: "codex", enabled: true, discovered: false },
          { id: "gemini", enabled: false, discovered: true },
        ],
      },
    });
    render(
      <ProviderFilterProvider>
        <Probe />
      </ProviderFilterProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("query")).toHaveTextContent("claude"));
    expect(screen.getByTestId("loaded")).toHaveTextContent("true");
    expect(screen.getByTestId("available")).toHaveTextContent("claude");
  });

  it("uses providers=__none when no provider is discovered", async () => {
    installFetch({
      "/api/settings": {
        providers: [{ id: "claude", enabled: true, discovered: false }],
      },
    });
    render(
      <ProviderFilterProvider>
        <Probe />
      </ProviderFilterProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("query")).toHaveTextContent("__none"));
    expect(screen.getByTestId("has")).toHaveTextContent("false");
    expect(screen.getByTestId("available")).toHaveTextContent("");
  });
});
