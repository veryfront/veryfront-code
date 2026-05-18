/** Public API contract for live eval runtime. */
export type LiveEvalRuntime = "framework";

/** Public API contract for live eval result for performance. */
export interface LiveEvalResultForPerformance {
  runtime: LiveEvalRuntime;
  durationMs: number;
}

/** Public API contract for runtime performance summary. */
export interface RuntimePerformanceSummary {
  count: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

function calculateDurationPercentile(
  sortedDurations: number[],
  percentile: number,
): number {
  if (sortedDurations.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedDurations.length) - 1),
  );

  return sortedDurations[index] ?? 0;
}

/** Builds runtime performance summary. */
export function buildRuntimePerformanceSummary(
  results: LiveEvalResultForPerformance[],
): Record<LiveEvalRuntime, RuntimePerformanceSummary> {
  const durations = results.map((result) => result.durationMs).sort((
    left,
    right,
  ) => left - right);
  const totalDuration = durations.reduce((sum, value) => sum + value, 0);

  return {
    framework: {
      count: durations.length,
      avgDurationMs: durations.length > 0 ? Math.round(totalDuration / durations.length) : 0,
      p50DurationMs: calculateDurationPercentile(durations, 50),
      p95DurationMs: calculateDurationPercentile(durations, 95),
      minDurationMs: durations[0] ?? 0,
      maxDurationMs: durations.at(-1) ?? 0,
    },
  };
}
