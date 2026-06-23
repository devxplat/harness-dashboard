import {
  backfillSummary,
  groupReposByOrg,
  nextAutoSyncLabel,
  progressPercent,
  rateBudgetLabel,
  rateBudgetTone,
} from "@/lib/github";
import type { GithubProgress, GithubRepoItem } from "@/lib/types";
import { describe, expect, it } from "vitest";

describe("rateBudgetLabel", () => {
  it("formats remaining/limit with thousands separators", () => {
    expect(rateBudgetLabel({ remaining: 4870, limit: 5000, reset_utc: null })).toBe("4,870 / 5,000");
  });
  it("is — when unknown", () => {
    expect(rateBudgetLabel(null)).toBe("—");
    expect(rateBudgetLabel({ remaining: null, limit: 5000, reset_utc: null })).toBe("—");
  });
});

describe("rateBudgetTone", () => {
  it("ok / warn / danger by fraction and floor", () => {
    expect(rateBudgetTone(5000, 5000)).toBe("ok");
    expect(rateBudgetTone(1000, 5000)).toBe("warn"); // 20%
    expect(rateBudgetTone(400, 5000)).toBe("danger"); // 8%
    expect(rateBudgetTone(50, 5000)).toBe("danger"); // below floor
  });
  it("ok when unknown", () => {
    expect(rateBudgetTone(null, 5000)).toBe("ok");
    expect(rateBudgetTone(10, 0)).toBe("ok");
  });
});

describe("backfillSummary", () => {
  it("labels all/recent and N units (singularizing 1)", () => {
    expect(backfillSummary(0, "all")).toBe("All history");
    expect(backfillSummary(0, "recent")).toBe("Recent only");
    expect(backfillSummary(90, "days")).toBe("90 days");
    expect(backfillSummary(1, "month")).toBe("1 month");
    expect(backfillSummary(1, "months")).toBe("1 month");
  });
});

describe("progressPercent", () => {
  it("is 0 without a total and clamps to 100", () => {
    expect(progressPercent(null)).toBe(0);
    expect(progressPercent({ repo_index: 0, repo_total: 0 } as GithubProgress)).toBe(0);
    expect(progressPercent({ repo_index: 3, repo_total: 12 } as GithubProgress)).toBe(25);
    expect(progressPercent({ repo_index: 13, repo_total: 12 } as GithubProgress)).toBe(100);
  });
});

describe("nextAutoSyncLabel", () => {
  const now = 1_000_000_000_000;
  it("due now when never synced or overdue", () => {
    expect(nextAutoSyncLabel(null, 60, now)).toBe("due now");
    expect(nextAutoSyncLabel(now - 2 * 3_600_000, 60, now)).toBe("due now");
  });
  it("minutes / hours formatting", () => {
    expect(nextAutoSyncLabel(now - 18 * 60_000, 60, now)).toBe("in 42m");
    expect(nextAutoSyncLabel(now, 125, now)).toBe("in 2h 5m");
    expect(nextAutoSyncLabel(now, 120, now)).toBe("in 2h");
  });
});

describe("groupReposByOrg", () => {
  const repo = (owner: string, name: string, enabled: boolean): GithubRepoItem => ({
    repo_key: `${owner}/${name}`,
    owner,
    repo: name,
    primary_slug: null,
    enabled,
    last_synced_at: null,
  });
  it("groups + sorts + counts enabled", () => {
    const groups = groupReposByOrg([
      repo("rd-station", "beta", true),
      repo("acme", "z", false),
      repo("rd-station", "alpha", true),
      repo("acme", "a", true),
    ]);
    expect(groups.map((g) => g.owner)).toEqual(["acme", "rd-station"]);
    const rd = groups.find((g) => g.owner === "rd-station")!;
    expect(rd.repos.map((r) => r.repo)).toEqual(["alpha", "beta"]);
    expect(rd.enabled_count).toBe(2);
    expect(rd.total).toBe(2);
    expect(groups.find((g) => g.owner === "acme")!.enabled_count).toBe(1);
  });
  it("handles empty", () => {
    expect(groupReposByOrg([])).toEqual([]);
  });
});
