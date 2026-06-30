import { ProviderFilterProvider, useProviderFilter } from "@/lib/provider-filter";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function Probe({ clearOnLoad = false }: { clearOnLoad?: boolean }) {
  const {
    available,
    queryProviders,
    settingsLoaded,
    hasAvailableProviders,
    hasSelectedProviders,
    requiresProviderSelection,
    setSelected,
  } = useProviderFilter();
  useEffect(() => {
    if (clearOnLoad && settingsLoaded && available.length > 0 && hasSelectedProviders) {
      setSelected([]);
    }
  }, [available, clearOnLoad, hasSelectedProviders, setSelected, settingsLoaded]);
  return (
    <div>
      <div data-testid="loaded">{String(settingsLoaded)}</div>
      <div data-testid="has">{String(hasAvailableProviders)}</div>
      <div data-testid="selected">{String(hasSelectedProviders)}</div>
      <div data-testid="requires">{String(requiresProviderSelection)}</div>
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

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("true"));
    expect(screen.getByTestId("query")).toHaveTextContent("claude");
    expect(screen.getByTestId("loaded")).toHaveTextContent("true");
    expect(screen.getByTestId("requires")).toHaveTextContent("false");
    expect(screen.getByTestId("available")).toHaveTextContent("claude");
  });

  it("requires a provider selection when available providers are all deselected", async () => {
    installFetch({
      "/api/settings": {
        providers: [{ id: "claude", enabled: true, discovered: true }],
      },
    });
    render(
      <ProviderFilterProvider>
        <Probe clearOnLoad />
      </ProviderFilterProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("query")).toHaveTextContent("__none"));
    expect(screen.getByTestId("has")).toHaveTextContent("true");
    expect(screen.getByTestId("selected")).toHaveTextContent("false");
    expect(screen.getByTestId("requires")).toHaveTextContent("true");
  });

  it("preserves an explicit empty provider selection across reloads", async () => {
    window.localStorage.setItem("harness.providerFilter.selected", "[]");
    installFetch({
      "/api/settings": {
        providers: [{ id: "claude", enabled: true, discovered: true }],
      },
    });
    render(
      <ProviderFilterProvider>
        <Probe />
      </ProviderFilterProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("query")).toHaveTextContent("__none"));
    expect(screen.getByTestId("has")).toHaveTextContent("true");
    expect(screen.getByTestId("selected")).toHaveTextContent("false");
    expect(screen.getByTestId("requires")).toHaveTextContent("true");
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
    expect(screen.getByTestId("loaded")).toHaveTextContent("true");
    expect(screen.getByTestId("has")).toHaveTextContent("false");
    expect(screen.getByTestId("selected")).toHaveTextContent("false");
    expect(screen.getByTestId("requires")).toHaveTextContent("false");
    expect(screen.getByTestId("available")).toHaveTextContent("");
  });
});
