import DoraPage from "@/app/dora/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const bundle = {
  grain: "week",
  metrics,
  trends: [
    {
      period: "2026-W25",
      commits: 12,
      deploys: 2,
      avg_lead_hours: 4,
      change_failure_rate: 25,
    },
  ],
  leadTimeDistribution: [
    { bucket: "<1h", pull_requests: 0 },
    { bucket: "1-4h", pull_requests: 1 },
    { bucket: "4-24h", pull_requests: 0 },
    { bucket: "1-3d", pull_requests: 0 },
    { bucket: "3d+", pull_requests: 0 },
  ],
  deploymentTimeline: [{ period: "2026-W25", deployments: 2, failures: 1 }],
  repoComparison: [
    {
      repo_key: "r",
      commits: 12,
      deploys: 2,
      pr_count: 3,
      merged_pr_count: 2,
      avg_lead_hours: 4,
      change_failure_rate: 25,
      ai_overlap_prs: 1,
    },
  ],
  prCycleTime: [
    {
      repo_key: "All repos",
      merged_pr_count: 2,
      codingHours: null,
      pickupHours: 2,
      reviewHours: 2,
      mergeHours: null,
    },
  ],
  prSizeDistribution: [
    { bucket: "0-10", pull_requests: 0 },
    { bucket: "11-50", pull_requests: 1 },
  ],
  prChurnSummary: {
    medianChurn: 35,
    p90Churn: 35,
    avgChangedFiles: 2,
    reworkProxyPct: 0,
  },
};

const emptyBundle = {
  grain: "week",
  metrics: [],
  trends: [],
  leadTimeDistribution: [
    { bucket: "<1h", pull_requests: 0 },
    { bucket: "1-4h", pull_requests: 0 },
    { bucket: "4-24h", pull_requests: 0 },
    { bucket: "1-3d", pull_requests: 0 },
    { bucket: "3d+", pull_requests: 0 },
  ],
  deploymentTimeline: [],
  repoComparison: [],
  prCycleTime: [],
  prSizeDistribution: [
    { bucket: "0-10", pull_requests: 0 },
    { bucket: "11-50", pull_requests: 0 },
  ],
  prChurnSummary: {
    medianChurn: null,
    p90Churn: null,
    avgChangedFiles: null,
    reworkProxyPct: null,
  },
};

describe("DoraPage", () => {
  it("renders metrics with exact/approx labels and handles unavailable values", async () => {
    installFetch({ "/api/dora/bundle": bundle });
    renderWithRange(<DoraPage />);
    await waitFor(() => expect(screen.getByText("Throughput")).toBeInTheDocument());
    expect(screen.getByText("12.5")).toBeInTheDocument();
    expect(screen.getAllByText("25%").length).toBeGreaterThan(0);
    expect(screen.getByText("exact")).toBeInTheDocument();
    expect(screen.getByText("approx")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("renders trends, PRs, and deployments tabs", async () => {
    const user = userEvent.setup();
    installFetch({ "/api/dora/bundle": bundle });
    renderWithRange(<DoraPage />);

    await user.click(await screen.findByRole("tab", { name: "Trends" }));
    expect(screen.getByText("Throughput and deploy frequency")).toBeInTheDocument();
    expect(screen.getByText("Lead time trend")).toBeInTheDocument();
    expect(screen.getByText("Trend rows")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "PRs" }));
    expect(screen.getByText("PR lead-time distribution")).toBeInTheDocument();
    expect(screen.getByText("PR comparison")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Deployments" }));
    expect(screen.getByText("Deployment timeline")).toBeInTheDocument();
    expect(screen.getByText("Deployment rows by repo")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/dora/bundle": emptyBundle });
    renderWithRange(<DoraPage />);
    await waitFor(() => expect(screen.getByText(/No DORA data yet/)).toBeInTheDocument());
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<DoraPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
