import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildRuntimePerformanceSummary } from "./performance.ts";

describe("agent testing live eval performance", () => {
  it("summarizes framework runtime durations", () => {
    const summary = buildRuntimePerformanceSummary([
      { runtime: "framework", durationMs: 10 },
      { runtime: "framework", durationMs: 30 },
    ]);

    assertEquals(summary.framework, {
      count: 2,
      avgDurationMs: 20,
      p50DurationMs: 10,
      p95DurationMs: 30,
      minDurationMs: 10,
      maxDurationMs: 30,
    });
  });
});
