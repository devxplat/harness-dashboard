import { describe, expect, it } from "vitest";
import {
  baseName,
  formatDate,
  formatDateShort,
  formatInt,
  formatPct,
  formatTokens,
  formatUSD,
  projectLabel,
  shortId,
  tidyPath,
} from "./format";

describe("formatTokens", () => {
  it("handles null/undefined", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(undefined)).toBe("—");
  });
  it("scales by magnitude", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(2_000_000)).toBe("2.00M");
    expect(formatTokens(3_000_000_000)).toBe("3.00B");
  });
});

describe("formatUSD", () => {
  it("formats and handles null", () => {
    expect(formatUSD(null)).toBe("—");
    expect(formatUSD(12.5)).toBe("$12.50");
    expect(formatUSD(1234.5)).toBe("$1,234.50");
  });
});

describe("formatInt", () => {
  it("groups thousands", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("passes through invalid, formats valid, handles null", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("2026-06-20T10:00:00Z")).toContain("2026");
  });
});

describe("shortId", () => {
  it("truncates to 8 and handles null", () => {
    expect(shortId("abcdef1234567")).toBe("abcdef12");
    expect(shortId(null)).toBe("—");
  });
});

describe("formatPct", () => {
  it("signs and scales fractions", () => {
    expect(formatPct(0.201)).toBe("+20.1%");
    expect(formatPct(-0.05)).toBe("-5.0%");
    expect(formatPct(0)).toBe("0.0%");
  });
});

describe("formatDateShort", () => {
  it("handles null, passes through invalid, formats valid", () => {
    expect(formatDateShort(null)).toBe("—");
    expect(formatDateShort("nope")).toBe("nope");
    expect(formatDateShort("2026-06-20T10:00:00Z")).toContain("Jun");
  });
});

describe("baseName", () => {
  it("returns the last segment of any path style", () => {
    expect(baseName("D:\\Github\\harness-dashboard")).toBe("harness-dashboard");
    expect(baseName("/home/me/proj/")).toBe("proj");
    expect(baseName("solo")).toBe("solo");
    expect(baseName(null)).toBe("—");
  });
});

describe("tidyPath", () => {
  it("strips the Windows extended-length prefix, leaving others untouched", () => {
    expect(tidyPath("\\\\?\\D:\\Github\\proj")).toBe("D:\\Github\\proj");
    expect(tidyPath("\\\\?\\UNC\\server\\share")).toBe("\\\\server\\share");
    expect(tidyPath("D:\\Github\\proj")).toBe("D:\\Github\\proj");
  });
});

describe("projectLabel", () => {
  it("prefers cwd, falls back to slug, and can shorten", () => {
    expect(projectLabel("D:\\Github\\harness-dashboard", "D--Github-harness-dashboard")).toBe(
      "D:\\Github\\harness-dashboard",
    );
    expect(projectLabel("D:\\Github\\harness-dashboard", null, true)).toBe("harness-dashboard");
    expect(projectLabel(null, "D--Github-token-dashboard-community")).toBe(
      "D--Github-token-dashboard-community",
    );
    expect(projectLabel(null, null)).toBe("—");
  });

  it("tidies the extended-length prefix in the full path", () => {
    expect(projectLabel("\\\\?\\D:\\Github\\proj", null)).toBe("D:\\Github\\proj");
    expect(projectLabel("\\\\?\\D:\\Github\\proj", null, true)).toBe("proj");
  });
});
