import { GithubSyncProgress } from "@/components/integrations/github-progress";
import type { GithubProgress } from "@/lib/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const running: GithubProgress = {
  running: true,
  repo_index: 3,
  repo_total: 12,
  current_repo: "rd-station/core",
  pull_requests: 220,
  deployments: 8,
  rate_remaining: 4870,
  rate_limit: 5000,
  rate_reset_utc: "2026-06-22T13:00:00Z",
  last_error: null,
  finished_at: null,
};

describe("GithubSyncProgress", () => {
  it("renders progress, counts and rate budget while running", () => {
    render(<GithubSyncProgress progress={running} />);
    expect(screen.getByText(/Syncing 3\/12/)).toBeInTheDocument();
    expect(screen.getByText(/220 PRs · 8 deploys/)).toBeInTheDocument();
    expect(screen.getByText("4,870 / 5,000")).toBeInTheDocument();
  });

  it("renders nothing when idle or not running", () => {
    const { container } = render(<GithubSyncProgress progress={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(
      <GithubSyncProgress progress={{ ...running, running: false }} />,
    );
    expect(c2).toBeEmptyDOMElement();
  });
});
