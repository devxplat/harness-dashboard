import RtkPage from "@/app/rtk/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const base = { install_url: "x", summary: null, daily: [], weekly: [], monthly: [] };

describe("RtkPage", () => {
  it("shows the not-installed state", async () => {
    installFetch({ "/api/rtk": { ...base, available: false } });
    renderWithRange(<RtkPage />);
    await waitFor(() => expect(screen.getByText(/RTK is not installed/)).toBeInTheDocument());
  });

  it("shows the detected state", async () => {
    installFetch({ "/api/rtk": { ...base, available: true } });
    renderWithRange(<RtkPage />);
    await waitFor(() => expect(screen.getByText(/RTK detected/)).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<RtkPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
