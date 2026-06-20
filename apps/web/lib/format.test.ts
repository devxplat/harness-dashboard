import { describe, expect, it } from "vitest";
import { formatDate, formatInt, formatTokens, formatUSD, shortId } from "./format";

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
