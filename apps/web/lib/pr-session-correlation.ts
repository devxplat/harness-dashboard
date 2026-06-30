import type { PrSessionCorrelationConfig } from "@/lib/types";

export const DEFAULT_PR_SESSION_CORRELATION_CONFIG: PrSessionCorrelationConfig = {
  enabled: true,
  time_window_before_minutes: 240,
  time_window_after_minutes: 240,
  min_confidence: 0.4,
  max_sessions_per_pr: 5,
  use_branch: true,
  use_file_touches: true,
  use_title_keywords: true,
  weights: {
    time_overlap: 0.4,
    temporal_proximity: 0.15,
    branch: 0.25,
    file_touch: 0.25,
    title_keyword: 0.1,
  },
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizePrSessionCorrelationConfig(
  value: PrSessionCorrelationConfig | null | undefined,
): PrSessionCorrelationConfig {
  const fallback = DEFAULT_PR_SESSION_CORRELATION_CONFIG;
  const weights = value?.weights ?? fallback.weights;
  return {
    enabled: value?.enabled ?? fallback.enabled,
    time_window_before_minutes: finiteNumber(
      value?.time_window_before_minutes,
      fallback.time_window_before_minutes,
    ),
    time_window_after_minutes: finiteNumber(
      value?.time_window_after_minutes,
      fallback.time_window_after_minutes,
    ),
    min_confidence: finiteNumber(value?.min_confidence, fallback.min_confidence),
    max_sessions_per_pr: finiteNumber(value?.max_sessions_per_pr, fallback.max_sessions_per_pr),
    use_branch: value?.use_branch ?? fallback.use_branch,
    use_file_touches: value?.use_file_touches ?? fallback.use_file_touches,
    use_title_keywords: value?.use_title_keywords ?? fallback.use_title_keywords,
    weights: {
      time_overlap: finiteNumber(weights.time_overlap, fallback.weights.time_overlap),
      temporal_proximity: finiteNumber(
        weights.temporal_proximity,
        fallback.weights.temporal_proximity,
      ),
      branch: finiteNumber(weights.branch, fallback.weights.branch),
      file_touch: finiteNumber(weights.file_touch, fallback.weights.file_touch),
      title_keyword: finiteNumber(weights.title_keyword, fallback.weights.title_keyword),
    },
  };
}
