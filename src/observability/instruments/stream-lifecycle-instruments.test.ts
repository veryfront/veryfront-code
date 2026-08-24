import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "#veryfront/config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";
import { createStreamLifecycleInstruments } from "./stream-lifecycle-instruments.ts";

describe("stream lifecycle instruments", () => {
  it("creates the exact bounded instrument names under the prefix", () => {
    const counters: string[] = [];
    const histograms: string[] = [];
    const histogramOptions = new Map<string, Record<string, unknown> | undefined>();
    const meter = {
      createCounter(name: string) {
        counters.push(name);
        return { name, add() {} };
      },
      createHistogram(name: string, options?: Record<string, unknown>) {
        histograms.push(name);
        histogramOptions.set(name, options);
        return { name, record() {} };
      },
      createUpDownCounter() {
        return { add() {} };
      },
      createObservableGauge() {
        return { addCallback() {} };
      },
    } as unknown as Meter;

    const instruments = createStreamLifecycleInstruments(meter, {
      prefix: "veryfront",
    } as MetricsConfig);

    assertEquals(counters, [
      "veryfront.stream.lifecycle.outcomes",
      "veryfront.stream.lifecycle.deadlines",
      "veryfront.stream.lifecycle.telemetry",
      "veryfront.stream.lifecycle.repairs",
      "veryfront.stream.lifecycle.shadow.divergences",
    ]);
    assertEquals(histograms, [
      "veryfront.stream.lifecycle.attempt.duration",
      "veryfront.stream.lifecycle.first_progress.duration",
      "veryfront.stream.lifecycle.semantic_idle.duration",
      "veryfront.stream.lifecycle.tool_input.duration",
      "veryfront.stream.lifecycle.tool_execution.duration",
    ]);

    assertEquals(
      Object.fromEntries(
        Object.entries(instruments).map(([field, instrument]) => [
          field,
          (instrument as { name?: string } | null)?.name ?? null,
        ]),
      ),
      {
        streamLifecycleOutcomeCounter: "veryfront.stream.lifecycle.outcomes",
        streamLifecycleDeadlineCounter: "veryfront.stream.lifecycle.deadlines",
        streamLifecycleTelemetryCounter: "veryfront.stream.lifecycle.telemetry",
        streamLifecycleRepairCounter: "veryfront.stream.lifecycle.repairs",
        streamLifecycleShadowDivergenceCounter: "veryfront.stream.lifecycle.shadow.divergences",
        streamLifecycleAttemptDuration: "veryfront.stream.lifecycle.attempt.duration",
        streamLifecycleFirstProgressDuration: "veryfront.stream.lifecycle.first_progress.duration",
        streamLifecycleSemanticIdleDuration: "veryfront.stream.lifecycle.semantic_idle.duration",
        streamLifecycleToolInputDuration: "veryfront.stream.lifecycle.tool_input.duration",
        streamLifecycleToolExecutionDuration: "veryfront.stream.lifecycle.tool_execution.duration",
      },
      "every returned field is wired to the instrument created under its own name",
    );

    for (const name of histograms) {
      const options = histogramOptions.get(name);
      assertEquals(options?.unit, "ms", `${name} must be recorded in milliseconds`);
      assertEquals(
        (options?.advice as { explicitBucketBoundaries?: number[] } | undefined)
          ?.explicitBucketBoundaries,
        [...DURATION_HISTOGRAM_BOUNDARIES_MS],
        `${name} must use the shared duration bucket boundaries`,
      );
    }
  });
});
