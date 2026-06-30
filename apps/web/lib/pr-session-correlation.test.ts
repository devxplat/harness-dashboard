import { describe, expect, it } from "vitest";
import {
  DEFAULT_PR_SESSION_CORRELATION_CONFIG,
  normalizePrSessionCorrelationConfig,
} from "./pr-session-correlation";

describe("normalizePrSessionCorrelationConfig", () => {
  it("fills missing values with deterministic defaults", () => {
    const config = normalizePrSessionCorrelationConfig({
      ...DEFAULT_PR_SESSION_CORRELATION_CONFIG,
      min_confidence: Number.NaN,
      weights: {
        ...DEFAULT_PR_SESSION_CORRELATION_CONFIG.weights,
        branch: Number.NaN,
      },
    });

    expect(config.min_confidence).toBe(DEFAULT_PR_SESSION_CORRELATION_CONFIG.min_confidence);
    expect(config.weights.branch).toBe(DEFAULT_PR_SESSION_CORRELATION_CONFIG.weights.branch);
    expect(config.time_window_before_minutes).toBe(240);
  });
});
