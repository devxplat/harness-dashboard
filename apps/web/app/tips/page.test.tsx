import TipsPage from "@/app/tips/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("TipsPage", () => {
  it("renders tip cards with severities", async () => {
    installFetch({
      "/api/tips": [
        { key: "cache-discipline", category: "cache", severity: "cost", title: "Low cache reuse", body: "..." },
        { key: "repeat-read:x", category: "repeat-file", severity: "info", title: "Repeatedly read file", body: "..." },
      ],
    });
    renderWithRange(<TipsPage />);
    await waitFor(() => expect(screen.getByText("Low cache reuse")).toBeInTheDocument());
    expect(screen.getByText("cache")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/tips": [] });
    renderWithRange(<TipsPage />);
    await waitFor(() => expect(screen.getByText(/No tips right now/)).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<TipsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
