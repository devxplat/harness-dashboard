import DoraPage from "@/app/dora/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const metrics = [
  {
    key: "throughput",
    label: "Throughput",
    value: 12.5,
    unit: "commits / week",
    detail: "25 commits over ~2.0 weeks",
    source: "local git",
    exact: true,
  },
  {
    key: "lead_time",
    label: "Lead time to merge",
    value: null,
    unit: "hours",
    detail: "Connect GitHub to measure PR lead time",
    source: "GitHub (not configured)",
    exact: false,
  },
];

describe("DoraPage", () => {
  it("renders metrics with exact/approx labels and handles unavailable values", async () => {
    installFetch({ "/api/dora": metrics });
    renderWithRange(<DoraPage />);
    await waitFor(() => expect(screen.getByText("Throughput")).toBeInTheDocument());
    expect(screen.getByText("12.5")).toBeInTheDocument();
    expect(screen.getByText("exact")).toBeInTheDocument();
    // The unavailable metric shows a dash and an "approx" chip.
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("approx")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/dora": [] });
    renderWithRange(<DoraPage />);
    await waitFor(() => expect(screen.getByText(/No data yet/)).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<DoraPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
